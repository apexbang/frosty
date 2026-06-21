// game.svelte.ts — THE singleton reactive bridge between the pure engine and the UI.
//
// This is the ONLY place Svelte runes meet the framework-free engine. It holds the live
// `$state` GameState POJO, derives `remaining` (never stores it), owns the transport
// (ClipboardNarrator) + persistence (IdbSaveStore) instances, and drives `runTurn`
// supplying the `awaitConfirm`/`onPrompt` callbacks. The UI imports `game` and reads its
// reactive fields; the engine sees only POJOs ($state.snapshot at every boundary).
//
// CLAUDE.md "#1 Hazard" — the load-bearing runes discipline observed here:
//   - SINGLETON, MUTATE-NEVER-REASSIGN: `export const game = new Game()`; the UI and tests
//     mutate `game.*` properties. The instance reference never changes (a reassigned
//     cross-module `$state` export loses reactivity).
//   - `remaining` is `$derived.by(...)`, NEVER a `$state` you keep in sync — it recomputes
//     from `this.events` via the audited `ledgerRemaining`, so no panel can hold a stale
//     count (UI-03 / the eslint prefer-writable-derived guardrail).
//   - `$state.snapshot(this.state/this.events)` at EVERY call into the pure engine — a
//     reactive proxy must never reach `runTurn`/`fold`/`resolveTurn` (Pitfall 1, T-05-06).
//   - ARROW class fields for handlers so `this` binds to the instance regardless of how
//     the UI wires the callback.
//   - Pastes route through `narrator.submitPaste` ONLY — no raw deserialization here (V5,
//     T-05-03); a bad paste is a recoverable inline `pasteError`, the run stays pending.
//
// PURITY ASYMMETRY: this file MAY import Svelte + the non-engine idb store; the engine
// (src/lib/engine/**) must never import THIS. The seam is one-directional.

import { ClipboardNarrator } from './engine/narrator';
import { buildPrompt } from './engine/prompt';
import { CONFIRM_DEFAULT_ON, type ConfirmRow } from './engine/confirm';
import { remaining as ledgerRemaining } from './engine/ledger';
import { fold } from './engine/state';
import { roll } from './engine/dice';
import { loadGameState } from './engine';
import { extractFencedJson, validateSaveEnvelope } from './engine';
import type { GameState, Side } from './engine/state';
import type { OrderAction, PlayerOrder } from './engine/envelope';
import type { GameEvent, OutcomeBand } from './engine/events';
import type { Modifier } from './engine/dice';
import type { CampaignRow, SaveStore } from './engine/save-store';
import type { PersistedGame, CatalogEntry } from './engine';
import { IdbSaveStore } from './idb-save-store';
import { randomId } from './seed';
import { starterScenario } from './scenarios/starter';
import { ScenarioStore } from './scenarios';
import { runTurn } from './turn';

/** The turn state machine — the literal union the UI reads to gate its controls. */
export type TurnMachine =
	| 'idle'
	| 'composing'
	| 'awaitingPaste'
	| 'confirming'
	| 'resolving'
	| 'rendered';

/** A turn's narrative scrollback entry (escaped text only — NEVER {@html}, T-05-04). */
export interface LogEntry {
	turn: number;
	narrative: string;
}

/** The "show your work" projection the DiceConfirmPanel reads (UI-04). */
export interface LastResolution {
	roll: [number, number];
	modifiers: { label: string; value: number }[];
	net: number;
	band: OutcomeBand;
}

/** A surfaced validation rejection (visible inline, never silent — VALID-04). */
export interface RejectionView {
	actor: string;
	reason: string;
}

/**
 * Read the test-only deterministic roller seam (Option A, LOCKED in PLAN.md Task 2). The
 * §5.4 e2e installs `window.__frostyRoller` via `addInitScript` BEFORE goto; `startTurn`
 * reads it here and threads it into `runTurn` as `deps.roller`. In PRODUCTION the global is
 * absent so this returns `undefined` and `runTurn`/`resolveTurn` fall back to the real Web
 * Crypto `roll` — production dice stay neutral (DICE-01) and no engine code changes
 * (CORE-02). The cast mirrors the e2e's own `(window as unknown as {...})` idiom rather
 * than a `declare global` augmentation (which would carry an "unused" ambient interface).
 */
function testRoller(): typeof roll | undefined {
	if (typeof window === 'undefined') return undefined;
	return (window as unknown as { __frostyRoller?: typeof roll }).__frostyRoller;
}

/**
 * Invert a state's materialized consumable views back into GameEvents — the single A4
 * reload mechanism. Walks every side and flattens each ExpendEntry into a side-scoped
 * `expend` event AND each ResupplyEntry into a side-scoped `resupply` event, so
 * `ledgerRemaining` (which sums BOTH expend decrements and resupply raises) derives
 * identically to the live stream. Without the resupply arm, a save→load round-trip would
 * silently drop a logged resupply increment (CR-03). Module-level so both `boot()` (to seed
 * `this.events`) and the `remaining` derive use the one inversion.
 */
function eventsFromExpended(state: GameState): GameEvent[] {
	const events: GameEvent[] = [];
	for (const side of state.sides as Side[]) {
		for (const x of side.consumables.expended) {
			events.push({
				kind: 'expend',
				side: side.id,
				actor: x.actor,
				item: x.item,
				qty: x.qty,
				reason: x.reason,
				turn: x.turn
			});
		}
		for (const r of side.consumables.resupplied) {
			events.push({
				kind: 'resupply',
				side: side.id,
				item: r.item,
				from: r.from,
				to: r.to,
				source: r.source,
				turn: r.turn
			});
		}
	}
	return events;
}

/** Stable identity of an `expend` event for dedup across the reconstruction + live stream. */
function expendKey(e: Extract<GameEvent, { kind: 'expend' }>): string {
	return `${e.turn}|${e.side}|${e.actor}|${e.item}|${e.qty}|${e.reason ?? ''}`;
}

/** Stable identity of a `resupply` event for dedup across the reconstruction + live stream. */
function resupplyKey(e: Extract<GameEvent, { kind: 'resupply' }>): string {
	return `${e.turn}|${e.side}|${e.item}|${e.from}|${e.to}|${e.source}`;
}

/**
 * Merge the reconstructed-from-state events with the live `this.events`, counting an identical
 * ledger event ONCE. Both `expend` (decrements) and `resupply` (raises) are materialized into
 * state (`consumables.expended` / `consumables.resupplied`) AND re-emitted by `eventsFromExpended`,
 * so a `boot()` that populated `this.events` from that reconstruction would otherwise sum each
 * such event twice — inflating a count above its logged truth (a ledger-authority breach for
 * resupply in particular). Dedup BOTH kinds by stable identity; a manually-set live stream still
 * composes over the state floor. Non-ledger events pass through unchanged.
 */
function mergeExpendStreams(reconstructed: GameEvent[], live: GameEvent[]): GameEvent[] {
	// A plain object as the seen-set: this is a transient local in a pure helper, not
	// reactive state — `svelte/prefer-svelte-reactivity` (which wants SvelteSet) does not
	// apply, so a Record keeps it a leaf with no reactivity coupling.
	const seen: Record<string, true> = {};
	const out: GameEvent[] = [];
	for (const e of [...reconstructed, ...live]) {
		if (e.kind === 'expend' || e.kind === 'resupply') {
			const key = e.kind === 'expend' ? `e:${expendKey(e)}` : `r:${resupplyKey(e)}`;
			if (seen[key]) continue;
			seen[key] = true;
		}
		out.push(e);
	}
	return out;
}

// Phase 6 (DEPTH-02): the M1 inline ruleset literal is GONE — `sizeTurn`/`selectModules`
// (in turn.ts) now SOURCE the rules per turn from the modular registry, sized to the
// turn's stakes. The bridge no longer threads a `rules` string into runTurn.

/**
 * Serialize the tapped `OrderAction[]` into a human-readable block (RESEARCH Pattern 3 /
 * Pitfall 5). OPEN QUESTION #1 is RESOLVED: `buildPrompt` renders ONLY `order.raw` (verified
 * prompt.ts:124) — it does NOT template `order.actions`. So the merged order's `raw` MUST
 * carry a serialization of the tapped proposals or the AI never sees them. One terse line per
 * action: `- {actor} {actionType}[ (expend {item} ×{qty}[, …])]`. Empty in → '' (no suffix).
 * Pure (no entropy, no mutation); the structured `actions` still travel separately for the
 * resolver — this suffix is the AI-visible mirror, not a replacement.
 */
function serializeTappedActions(actions: OrderAction[]): string {
	if (actions.length === 0) return '';
	const lines = actions.map((a) => {
		const expend = (a.expend ?? [])
			.filter((e) => e.qty > 0)
			.map((e) => `${e.item} ×${e.qty}`)
			.join(', ');
		const suffix = expend ? ` (expend ${expend})` : '';
		return `- ${a.actor} ${a.actionType}${suffix}`;
	});
	return ['Tapped orders:', ...lines].join('\n');
}

/**
 * `mergeOrder(pendingActions, raw)` (ORDER-06 / D-02, RESEARCH Pattern 3) — combine the tapped
 * structured proposals with the typed free override into ONE `PlayerOrder`. BOTH channels are
 * carried, NEITHER dropped: `actions` = the tapped `OrderAction[]` (for the resolver via
 * validate.ts), `raw` = the typed override verbatim PLUS a human-readable serialization of the
 * tapped actions appended as a clearly-delimited suffix (so `buildPrompt`, which renders only
 * `raw`, surfaces the proposals to the AI — OQ#1). The override is ADDITIVE: a non-empty typed
 * raw never blows away queued actions. A PROPOSAL only — still routed through narrator → dice →
 * rules, zero ledger authority (authority rule). Pure: returns a fresh object, no mutation.
 */
export function mergeOrder(pendingActions: OrderAction[], raw: string): PlayerOrder {
	const typed = raw.trim();
	const tapped = serializeTappedActions(pendingActions);
	// Join the typed override and the tapped-action suffix with a blank-line delimiter; either
	// side may be empty (pure-prose order, or tapped-only order with no typed text).
	const mergedRaw = [typed, tapped].filter((s) => s.length > 0).join('\n\n');
	return { raw: mergedRaw, actions: pendingActions };
}

/** A stable DB name so reload reconstructs the same store (the §5.4 reload round-trip). */
const DB_NAME = 'frosty';

/**
 * `BOOT_LOAD_TIMEOUT_MS` (T-s02-01) — the bounded budget `boot()` gives `SaveStore.load()`
 * before it stops waiting and seeds a fresh in-memory campaign. The PROVEN device failure
 * (S23 Ultra Firefox Nightly) is a `load()` that never settles (neither resolves NOR rejects),
 * so the try/catch — which only fires on a throw/reject — never runs and boot leaves `state`
 * null forever. This timeout makes boot ALWAYS land on usable state within a bounded time.
 * 3s is generous for a real IndexedDB open+fold yet short enough that a true hang is felt as a
 * brief delay, not a dead app.
 */
const BOOT_LOAD_TIMEOUT_MS = 3000;

/** Race sentinel: the timeout fired (a HANG) — distinct from a real `null` (no-data). */
const BOOT_TIMEOUT = Symbol('boot-timeout');
/** Race sentinel: the load arm REJECTED — mapped into the race so it never escapes it. */
const BOOT_LOAD_FAILED = Symbol('boot-load-failed');

/**
 * The reactive bridge. One instance is exported as `game`; everything mutates its
 * properties. Handlers are arrow fields so `this` stays bound to the instance.
 */
class Game {
	// ── Live reactive state (the UI reads these; the engine sees snapshots) ────────
	state = $state<GameState | null>(null);
	events = $state<GameEvent[]>([]);
	log = $state<LogEntry[]>([]);
	machine = $state<TurnMachine>('idle');
	confirmRows = $state<ConfirmRow[]>([]);
	confirmEnabled = $state(CONFIRM_DEFAULT_ON);
	lastResolution = $state<LastResolution | null>(null);
	pasteError = $state<string | null>(null);
	/**
	 * `flushError` (UI-08 / D-05) — the recoverable autosave-flush-failed notice. Set when a
	 * `pagehide`/`visibilitychange:hidden` flush's `save()` returns a not-ok `SaveResult`
	 * (quota / io) so the player sees the warning-amber "Couldn't save before backgrounding —
	 * export your campaign" hint on return (UI-SPEC line 147). Distinct from `pasteError` (a
	 * turn-flow save failure) so the two surfaces never clobber each other. Null = no failure.
	 * The flush carries ZERO new ledger authority — it re-persists current folded state only.
	 */
	flushError = $state<string | null>(null);
	/**
	 * `saveUnavailable` (T-r7j-01) — the recoverable IN-MEMORY-ONLY mode flag. Set true when
	 * IndexedDB is BLOCKED/UNAVAILABLE (Firefox private / strict tracking protection / tunneled
	 * origin) so a store open REJECTS rather than resolving: `boot()`'s `load()`, `flushSave()`'s
	 * `save()`, and `exportCampaign()`'s `export()` can all throw at the `openDB` boundary. When
	 * that happens play CONTINUES on a seeded in-memory campaign, saves are simply off, and Export
	 * is the escape hatch. Distinct from `flushError` (a single recoverable not-ok write that
	 * signals possible data loss) so the two notices never clobber: `saveUnavailable` is a quiet,
	 * non-blocking "storage is off" status, aria-live polite — NOT assertive. The fallback carries
	 * ZERO new ledger authority: the catch only seeds a fresh starter, it fabricates no deltas.
	 */
	saveUnavailable = $state(false);
	/**
	 * `loadNotice` (LOAD-03 / D-03) — the recoverable, NON-DESTRUCTIVE notice surfaced when a
	 * locally-resumed save is forward-incompatible (a `newer-version` `LoadResult`) or
	 * shape-invalid. boot() does NOT delete or overwrite the rejected campaign's rows; it mounts
	 * a FRESH starter under a NEW campaignId and sets this message so the player sees "this save
	 * was made by a newer version of Frosty — your campaign is preserved" rather than a crash or
	 * a silent data loss. Distinct from `flushError`/`pasteError` so the load-reject surface never
	 * clobbers a turn-flow surface. Null = no reject (the common case). The reject path fabricates
	 * ZERO ledger deltas — it only seeds a clean starter (authority rule untouched). "Never
	 * overwrite a campaign you couldn't read."
	 */
	loadNotice = $state<string | null>(null);
	rejections = $state<RejectionView[]>([]);
	prompt = $state('');
	campaignId = $state('');
	/**
	 * `#switchEpoch` (CAMP-07 / D-02) — the monotonic generation token that makes a background
	 * `flushSave` captured under the PRIOR campaign safe across a `switchCampaign`. It generalizes
	 * the `flushSave` `const id` idempotency capture (8f23f0e): `flushSave` reads BOTH `id` and this
	 * epoch at write start, and DISCARDS its write on resolve if either changed. `switchCampaign`
	 * increments it FIRST (so any flush already in flight fails its resolve-time guard) and then
	 * settles the pending flush before swapping the atomic quartet. NOT reactive — no UI renders the
	 * epoch; a plain private counter is sufficient for the discard contract (CONTEXT discretion: a
	 * monotonic number over a symbol). Strengthens, never weakens, the 8f23f0e idempotency guard.
	 */
	#switchEpoch = 0;
	/**
	 * `#deletedActiveId` (CR-01 / CAMP-04) — the one-shot "this active id was JUST cascade-deleted,
	 * do NOT resurrect it" marker. `deleteCampaign` sets it to the deleted id BEFORE driving the
	 * active-delete fallback `switchCampaign`, whose step-2 `flushSave` would otherwise re-write the
	 * deleted campaign's base+events+campaigns-row back to disk (IdbSaveStore.save's isFirstSave path
	 * re-creates the row), silently undoing the irreversible cascade for the most common case —
	 * deleting the campaign you are playing. `flushSave` checks this marker and drops its write when
	 * the flush is for the deleted id, then clears it. This is strictly MORE precise than a
	 * row-existence probe: it fires ONLY on a genuine just-deleted active id and never on the
	 * legitimate "behind"(null) write the undo seam relies on (a never-saved campaign with no marker).
	 * NOT reactive — no UI renders it; a plain private nullable suffices for the one-shot discard.
	 */
	#deletedActiveId: string | null = null;
	/**
	 * `pickerOpen` (SCEN-08) — the scenario-picker visibility flag. The picker is an ADDITIONAL
	 * surface reached via a "New game" action, NOT the global boot entry point: boot() still
	 * auto-resumes / mounts the starter, and opening the picker never changes that. A plain
	 * `$state` boolean (Svelte 5 runes) toggled by `openPicker()` / `closePicker()` — never a
	 * store, never derived. Scope guard (Phase 10 owns campaign lifecycle): the picker only
	 * STARTS new games from scenarios; it lists/resumes/renames/deletes nothing.
	 */
	pickerOpen = $state(false);
	/**
	 * `campaignsOpen` (CAMP-08 / D-05) — the Campaigns "shelf" visibility flag. The shelf is the
	 * always-reachable home surface: an empty store boots straight onto it (the empty state, see
	 * `boot()`'s no-campaign branch), and a live game opens it via the persistent `← Campaigns`
	 * affordance WITHOUT losing the in-flight campaign (the live campaign keeps autosaving; opening
	 * the shelf is non-destructive — tap a row or close to return). A plain `$state` boolean toggled
	 * by `openCampaigns()` / `closeCampaigns()` — never derived, never a store. Distinct from
	 * `pickerOpen`: the shelf LISTS/resumes/renames/deletes campaigns; the picker only STARTS new
	 * ones (the shelf's `New game` dispatches into it).
	 */
	campaignsOpen = $state(false);
	/**
	 * `campaignsDismissible` (D-05) — is the shelf currently dismissible back to a live game? TRUE
	 * only when the shelf was opened OVER an in-progress game via `openCampaigns()` (the footer
	 * `← Campaigns` affordance, which renders only when a campaign is live). FALSE on the empty-store
	 * boot LANDING: there is no started game to go back to, so the landing offers only `New game` /
	 * `Import` (per D-05 — boot must not drop the player into a silent starter, and a `← Back to game`
	 * that revealed that hidden starter would do exactly that). The route gates the `← Back to game`
	 * button on this flag. Reset to false whenever the shelf closes or a real game mounts from it.
	 */
	campaignsDismissible = $state(false);
	/**
	 * `scenarioImportError` (SCEN-02) — the recoverable "Create new via AI" import-paste error.
	 * Set when a pasted AI scenario seed fails to import (not valid JSON, shape-invalid, illegal
	 * seed, or load-reject); the picker surfaces it inline and keeps the paste box OPEN and
	 * re-pasteable. `importScenarioFromPaste` NEVER throws — every failure sets this and RETURNS
	 * (mirrors `pasteError`'s recoverable-paste discipline, NARR-03). Distinct from `pasteError`
	 * (the turn round-trip) so the two paste surfaces never clobber. Null = no error / cleared on
	 * a successful import. The import fabricates ZERO ledger deltas — it loads a turn-0 seed only.
	 */
	scenarioImportError = $state<string | null>(null);

	/**
	 * `lifecycleWarning` (CAMP-01 / UI-SPEC) — the recoverable warning-amber notice the Campaigns
	 * shelf surfaces when a lifecycle bridge action fails at the durable boundary (a `!ok`
	 * `Result` from `deleteCampaign`/`rename`/`importCampaignFile`, or a blocked-store reject). The
	 * route renders it `aria-live="assertive"` (possible data loss). Each message pairs the problem
	 * with the next step (UI-SPEC copy). NULL = no warning; cleared on a successful action. Distinct
	 * from `flushError` (turn autosave) and `scenarioImportError` (the AI-paste picker) so the
	 * lifecycle surface never clobbers a turn-flow or scenario-import surface. The bridge NEVER
	 * throws out of a click/change handler — every failure sets this and RETURNS (T-r7j-01 / D-06).
	 */
	lifecycleWarning = $state<string | null>(null);

	/**
	 * `duplicateToast` (CAMP-06 / UI-SPEC) — the polite, transient confirmation signal set when a
	 * `duplicate` succeeds (`Duplicated as "<name>"`). The route renders it `aria-live="polite"`
	 * (informational). A plain `$state` string the Campaigns shelf reads + clears; the new row
	 * itself appears when the screen re-reads `listCampaigns()` (the re-read-after-mutate contract).
	 * NULL = no toast. Escaped text only — NEVER `{@html}` (the duplicated name is user-supplied).
	 */
	duplicateToast = $state<string | null>(null);

	/**
	 * `pendingActions` (ORDER-06 / D-02) — the tapped-order accumulator. The ActionMenu
	 * pushes/removes structured `OrderAction` PROPOSALS here as the player taps verbs; the
	 * override valve (`+page.svelte` textarea) supplies the free typed `raw`. `mergeOrder`
	 * (a module fn below) combines BOTH into the one `PlayerOrder` `startTurn` sends — neither
	 * dropped. A PROPOSAL only: the resolver owns every delta (authority rule). Reassigned by
	 * the UI (mutate-then-reassign) so runes reactivity holds; cleared after a turn starts.
	 */
	pendingActions = $state<OrderAction[]>([]);

	/**
	 * `remaining` — the SINGLE derived consumable view, a per-side/per-item count map
	 * `{ [sideId]: { [item]: qty } }`, recomputed via the audited `ledgerRemaining`.
	 * NEVER a stored field: every panel that renders a count reads THIS, so a mutation
	 * of `this.events` repaints them all with no stale copy (UI-03).
	 *
	 * The query stream is the UNION of (a) the events reconstructed from the live state's
	 * materialized `expended` view and (b) `this.events`, DEDUPLICATED by identity. This
	 * is the A4 invariant made resilient: `state.consumables.expended` is the floor a
	 * folded/loaded state always carries (loadout − Σexpended === remaining), and live
	 * turn events add to it — but an event already present in the reconstruction (because
	 * `boot()` populated `this.events` FROM `expended`) is counted once, never twice. So
	 * the pre-turn count derives to 4 even with `this.events === []` (the state still
	 * carries the prior turn-2 expend), and a full live stream derives to 2.
	 */
	remaining = $derived.by<Record<string, Record<string, number>>>(() => {
		const out: Record<string, Record<string, number>> = {};
		if (!this.state) return out;
		const stream = mergeExpendStreams(eventsFromExpended(this.state), this.events);
		for (const side of this.state.sides) {
			const perItem: Record<string, number> = {};
			for (const item of Object.keys(side.consumables.loadout)) {
				perItem[item] = ledgerRemaining(side.consumables.loadout, stream, item, side.id);
			}
			out[side.id] = perItem;
		}
		return out;
	});

	/**
	 * `contactBeat` (FOG-03) — the SINGLE derived "did THIS turn reveal?" signal the
	 * ContactBeat banner stages from. It is `$derived` over the live event stream's
	 * `reveal` events, NEVER a stored `$state` boolean (CLAUDE.md #1 hazard; the
	 * eslint prefer-writable-derived guardrail) — so the beat can never desync from the
	 * truth of the resolved turn. `count` = the number of reveals in the most-recent
	 * turn; `first` = that turn's first reveal `resolvesTo` sub-line (the rest live in
	 * the CampaignLog). On a no-reveal turn `count === 0` / `first === null` so the
	 * banner renders nothing. The signal scopes to the LAST turn's reveals: a turn that
	 * reveals nothing must not re-stage a prior turn's contact, so we take the reveals
	 * whose `turn` equals the max reveal turn — but only if that is also the latest
	 * turn that produced events, so an older reveal never re-fires after a quiet turn.
	 */
	contactBeat = $derived.by<{ count: number; first: string | null }>(() => {
		const reveals = this.events.filter(
			(e): e is Extract<GameEvent, { kind: 'reveal' }> => e.kind === 'reveal'
		);
		if (reveals.length === 0) return { count: 0, first: null };
		// Scope to THIS turn: the latest turn present in the whole event stream. If the
		// most-recent event turn carries no reveal, the beat stays silent (count 0).
		const latestTurn = this.events.reduce((m, e) => Math.max(m, e.turn), -Infinity);
		const thisTurn = reveals.filter((r) => r.turn === latestTurn);
		if (thisTurn.length === 0) return { count: 0, first: null };
		return { count: thisTurn.length, first: thisTurn[0].resolvesTo };
	});

	// ── Owned collaborators (the store OWNS the transport + persistence instances) ──
	#narrator = new ClipboardNarrator(buildPrompt);
	// Typed as the SaveStore CONTRACT (IdbSaveStore implements it) so the test seam can swap in a
	// stub store without widening the production type's surface — production always holds the idb impl.
	#saveStore: SaveStore = new IdbSaveStore(DB_NAME);
	/**
	 * The bundled-scenario read seam (SCEN-06/07/08) — a `GameSource` over the
	 * `import.meta.glob`-enumerated scenario data files. The bridge OWNS it (mirroring how it
	 * owns `#saveStore`). `newGameFromScenario(id)` loads through it; the picker lists through it
	 * (`listScenarios()`). NOT the boot entry point — boot() still auto-resumes / mounts starter.
	 */
	#scenarioStore = new ScenarioStore();

	/** The captured confirm-gate resolver — settled by `confirm()`/`adjust()` from the UI. */
	#confirmResolve: ((_ok: boolean) => void) | null = null;

	/**
	 * TEST-ONLY injectable boot-load timeout (T-s02-01) — the bounded budget `boot()` gives
	 * `load()` before it races to the seed fallback. Defaults to the production
	 * `BOOT_LOAD_TIMEOUT_MS`; a suite shrinks it via `__setBootLoadTimeoutForTest(1)` so the
	 * hang-path regression resolves in a millisecond instead of a real 3-second wait. NEVER
	 * called in production — the production timeout is the module constant.
	 */
	#bootLoadTimeoutMs = BOOT_LOAD_TIMEOUT_MS;

	// ── Lifecycle / handlers (arrow fields — `this` binds to the instance) ──────────

	/**
	 * Boot on app start through the UNIFIED validated load path (LOAD-01/02/03/05). EVERY arm —
	 * a resumed save, the fresh-starter fallback, a rejected forward-incompatible save — resolves
	 * its state through the ONE `loadGameState(persisted)` (validate → migrate → fold). The
	 * `load | seed` fork is GONE: the starter is itself a `PersistedGame` (`starterScenario()`)
	 * crossed through the same gate, so "a scenario IS a save at turn 0" is literally one code path.
	 *
	 * The proven device-hardening SCAFFOLDING is preserved verbatim (Pitfall 3): the
	 * `loadEnvelope`-vs-timeout race (one promise captured ONCE), the BOOT_TIMEOUT/BOOT_LOAD_FAILED
	 * sentinels, the belt-and-braces try/catch with a last-resort starter, and the fire-and-forget
	 * late-resolution adoption. The new `loadGameState` call goes INSIDE this structure.
	 *
	 * A4 RESOLUTION (Open Question 1 / Pitfall 2): on the resume / starter arms the live
	 * `this.events` is set DIRECTLY from `result.events` (the envelope carries the real stream) —
	 * we do NOT re-reconstruct via `eventsFromExpended` on these arms (that double-count risk is
	 * gone). The `remaining` derive still does its OWN reconstruction-with-dedup over the folded
	 * state, so the §5.4 canary reachability is untouched. `undoLastTurn` keeps its reconstruction
	 * (no envelope events there — out of this phase's scope).
	 *
	 * campaignId DECOUPLING (LOAD-04 / D-05): `campaignId` is the STABLE ROW id, NEVER derived from
	 * `meta.campaignName`. On resume it is the id the row was loaded under (resolved via `list()`
	 * most-recent before `loadEnvelope(id)`); on a fresh/rejected starter it is a one-time
	 * `randomId()` reused for every subsequent save (Pitfall 4 / CR-04 — keying differently forks a
	 * second campaigns row).
	 */
	boot = async (): Promise<void> => {
		// T-r7j-01 + T-s02-01: boot must ALWAYS land on usable state within a bounded time,
		// regardless of whether storage answers, rejects, or HANGS. The original try/catch only
		// covered a throw/reject; the PROVEN device bug is a load that never settles (forever
		// pending), so the catch never fired and boot left `state` null + a permanent skeleton.
		// Fix: RACE the load against a timeout. Capture the load promise ONCE (the late-resolution
		// guard re-awaits this same promise — never resolve the source twice). Map a rejection INTO
		// the race (BOOT_LOAD_FAILED) so it routes to the same fallback rather than escaping it.
		//
		// The load arm now resolves the GameSource read (LOAD-04 id decoupling): first the
		// most-recent campaign id via list() (mirrors the store's by_updatedAt 'prev' resume), then
		// loadEnvelope(id) so the bridge KNOWS the stable row id. It returns a { persisted, resumeId }
		// pair (or null when there is no campaign to resume) — never the bare envelope, so the loaded
		// arm can set campaignId to the row id, not meta.campaignName.
		const loadPromise = this.#resolveResume();

		let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<typeof BOOT_TIMEOUT>((resolve) => {
			timeoutTimer = setTimeout(() => resolve(BOOT_TIMEOUT), this.#bootLoadTimeoutMs);
		});

		const raced = await Promise.race([
			// Wrap the load arm so a REJECTION maps to a sentinel instead of escaping the race.
			loadPromise.then(
				(v) => v,
				() => BOOT_LOAD_FAILED
			),
			timeoutPromise
		]);
		// Clear the timer the moment the race is decided (load may have won; let the timeout GC).
		if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);

		// Did the race end on the bounded-time fallback (a HANG or a reject)? That single branch
		// takes the fresh-starter path (a clean turn-0 in-memory campaign — no fabricated ledger
		// deltas, ledger authority untouched) and flips saveUnavailable so the route surfaces the
		// quiet "storage is off, Export to keep progress" notice.
		const timedOut = raced === BOOT_TIMEOUT || raced === BOOT_LOAD_FAILED;

		// BELT-AND-BRACES (quick-260620-sgg): wrap the ENTIRE state-resolution block + shared
		// mirror-rebuild tail in a try/catch. ANY throw in here would otherwise leave `this.state`
		// null and a permanent skeleton — the denial-of-service this phase is closing. On catch we
		// re-seed a usable in-memory starter and flip saveUnavailable, so boot ALWAYS lands on
		// non-null state at machine 'idle'. NO fabricated ledger deltas — the catch only seeds a
		// fresh starter (authority rule untouched). The fire-and-forget late-adoption block stays.
		try {
			if (timedOut) {
				// HANG / reject fallback: a fresh clean starter through the unified path, in-memory only.
				this.#mountStarter(randomId());
				this.saveUnavailable = true;
			} else if (raced) {
				// load won with a real campaign — RESUME through loadGameState (LOAD-01/02/03).
				const { persisted, resumeId } = raced as { persisted: PersistedGame; resumeId: string };
				const result = loadGameState(persisted);
				if (result.ok) {
					// A4 (Open Question 1): adopt the FOLDED state + the envelope's event stream DIRECTLY.
					// Do NOT call eventsFromExpended on the resume arm — the envelope carries the real
					// stream; reconstructing again risks the Pitfall-2 double-count. campaignId = the
					// stable ROW id (LOAD-04 / D-05), never meta.campaignName.
					this.state = result.state;
					this.campaignId = resumeId;
					this.events = result.events;
					this.#rebuildMirrorTail();
				} else {
					// LOAD-03 / D-03: a forward-incompatible (or shape-invalid) save. NEVER overwrite or
					// delete the rejected campaign's rows — surface a recoverable notice and mount a FRESH
					// starter under a NEW campaignId so the rejected campaign survives on disk untouched.
					this.loadNotice = this.#rejectNotice(result);
					this.#mountStarter(randomId());
				}
			} else {
				// load won with `null` (no campaign to resume — an EMPTY store). A fresh clean starter
				// still mounts through the unified path (state safety; device-hardening structure
				// untouched), under a freshly-minted stable campaignId (LOAD-04 / CR-04) — BUT per D-05
				// boot LANDS on the Campaigns empty state rather than dropping the player straight into a
				// silent starter. Opening the shelf is the ONLY change to this branch (the landing
				// surface), not the seed/timeout structure: `New game` from the empty state then routes
				// to the ScenarioPicker. This open is skipped on the timeout/reject and resume arms.
				this.#mountStarter(randomId());
				this.campaignsOpen = true;
			}
		} catch {
			// LAST-RESORT starter: any throw above must still land a non-null, usable in-memory state
			// rather than a stuck skeleton. Mount a fresh starter through the unified path, flag
			// in-memory-only mode. ZERO fabricated ledger deltas — starterScenario is the clean board.
			this.#mountStarter(randomId());
			this.saveUnavailable = true;
		}

		// REGRESSION GUARD (slow-but-working storage, T-s02-01): only when we seeded a fallback
		// because the timeout FIRED. A storage that is merely slow (resolves a REAL campaign AFTER
		// the timeout) should still be adopted — but ONLY while the user is still idle on the seeded
		// state. CRITICAL: this is FIRE-AND-FORGET (not awaited) so boot() RETURNS now on the seeded
		// state — a TRUE hang (loadPromise never settles, the proven device bug) would otherwise wedge
		// boot here forever on the very await meant to rescue it. Re-await the SAME loadPromise (never
		// re-resolve the source); capture the seeded reference BEFORE awaiting so an identity check
		// proves no turn has replaced the live state.
		if (raced === BOOT_TIMEOUT) {
			const seededState = this.state;
			void loadPromise
				.then((late) => {
					// Adopt only if the user has not moved on: machine still idle AND the live state is
					// still the exact seeded object (no turn / undo swapped it). A late null, a late
					// reject (caught below), or any interaction ⇒ do NOTHING (never swap mid-turn).
					if (late && this.machine === 'idle' && this.state === seededState) {
						const result = loadGameState(late.persisted);
						if (result.ok) {
							this.state = result.state;
							this.campaignId = late.resumeId;
							this.events = result.events;
							this.#rebuildMirrorTail();
							this.saveUnavailable = false;
						}
						// A late reject after a hang-timeout: stay on the seeded in-memory starter (the
						// rejected rows survive; the user is already playing — no disruptive swap).
					}
				})
				.catch(() => {
					// A later reject after a hang-timeout: ignore — stay on the seeded in-memory campaign.
				});
		}
	};

	/**
	 * Resolve the resume target as a `{ persisted, resumeId }` pair (LOAD-04 id decoupling) or
	 * null when there is no campaign to resume. First reads the most-recent campaign id via
	 * `list()` (mirroring the store's by_updatedAt 'prev' resume order), then `loadEnvelope(id)`
	 * so the bridge learns the STABLE ROW id the envelope was stored under — `campaignId` is set
	 * to THAT id on the resume arm, never to `meta.campaignName`. Returns null when there are no
	 * rows OR the envelope is absent (a degenerate row); boot then mounts a fresh starter.
	 */
	#resolveResume = async (): Promise<{ persisted: PersistedGame; resumeId: string } | null> => {
		const rows = await this.#saveStore.list();
		if (rows.length === 0) return null;
		// Most-recent by updatedAt — the same campaign loadEnvelope() would auto-resolve, but we
		// resolve the id HERE so the bridge can key its campaignId to the stable row id (LOAD-04).
		const resumeId = rows.reduce((best, r) => (r.updatedAt >= best.updatedAt ? r : best)).id;
		const persisted = await this.#saveStore.loadEnvelope(resumeId);
		if (!persisted) return null;
		return { persisted, resumeId };
	};

	/**
	 * Mount a FRESH clean turn-0 player starter through the unified path (LOAD-05). The starter is
	 * a `PersistedGame` validated by `loadGameState` exactly like a save — the seed fallback is
	 * validated too. `starterScenario()` is always shape-valid so the result is always ok (the
	 * `!ok` branch is unreachable for the starter but kept total for safety). campaignId is the
	 * caller-supplied stable id (a one-time `randomId()`), NEVER `meta.campaignName` (D-05).
	 */
	#mountStarter = (campaignId: string): void => {
		const result = loadGameState(starterScenario());
		// starterScenario() is authored clean + shape-valid, so result.ok is always true here; the
		// guard keeps #mountStarter total even if the starter were ever to drift out of shape.
		this.state = result.ok ? result.state : starterScenario().snapshots[0].state;
		this.campaignId = campaignId;
		this.events = result.ok ? result.events : [];
		this.#rebuildMirrorTail();
	};

	/**
	 * `listScenarios()` (SCEN-08) — the picker's data source: the bundled-scenario rows with
	 * extended card metadata (terrain · weather · per-side objectives + starting forces). A thin
	 * pass-through to the owned `ScenarioStore` so the render-only picker never imports the store.
	 */
	listScenarios = (): Promise<CatalogEntry[]> => this.#scenarioStore.list();

	/** Open the scenario picker (SCEN-08) — an additional surface, never the boot entry point. */
	openPicker = (): void => {
		this.pickerOpen = true;
	};

	/** Close the scenario picker without starting a game. */
	closePicker = (): void => {
		this.pickerOpen = false;
	};

	/**
	 * Open the Campaigns shelf (CAMP-08). NON-DESTRUCTIVE: it never touches `state`/`events`/
	 * `campaignId`/`machine`, so the in-flight campaign keeps autosaving and is restored by simply
	 * closing the shelf or tapping a row. Clears any stale toast so a fresh open starts clean.
	 */
	openCampaigns = (): void => {
		this.duplicateToast = null;
		// WR-02: a failed delete/rename/export/import sets the assertive amber lifecycleWarning; if
		// it is never followed by a successful action of the same kind it lingers across shelf
		// closes/reopens (CampaignsScreen renders it unconditionally while non-null). Clear it here so
		// each shelf open starts clean — an `aria-live="assertive"` "possible data loss" surface must
		// not show a stale notice.
		this.lifecycleWarning = null;
		this.campaignsOpen = true;
		// This entry is ONLY reachable from the footer `← Campaigns` button, which renders solely when
		// a campaign is live — so the shelf is dismissible back to that game (D-05). The empty-store
		// boot landing opens the shelf directly (not through here) and leaves this false.
		this.campaignsDismissible = true;
	};

	/** Close the Campaigns shelf and return to the (preserved) live game view. */
	closeCampaigns = (): void => {
		this.campaignsOpen = false;
		this.campaignsDismissible = false;
	};

	/**
	 * `newGameFromScenario(id)` (SCEN-06) — materialize a chosen shipped scenario as a NEW,
	 * INDEPENDENT turn-0 campaign through the unified path. EXACTLY the import-creates-new pattern
	 * `#mountStarter` uses: `scenarioStore.load(id)` → `loadGameState(persisted)` → on `ok` adopt
	 * the folded state/events under a FRESHLY-minted `randomId()` campaignId (D-05/LOAD-04 — the
	 * id is NEVER derived from `meta.campaignName`), then `#rebuildMirrorTail()`. The new campaign
	 * is persisted via the existing flush seam so it survives a reload.
	 *
	 * A shipped scenario always loads `ok` (it passed the store/CI gates), but the branch stays
	 * TOTAL: a `!ok` `LoadResult` surfaces through the existing `#rejectNotice`/`loadNotice` surface
	 * rather than crashing (the generated-scenario import flow in Plan 03 leans on the same arm).
	 * Closes the picker on success.
	 */
	newGameFromScenario = async (id: string): Promise<void> => {
		const persisted = await this.#scenarioStore.load(id);
		if (!persisted) {
			this.loadNotice = `Couldn’t start that scenario — it wasn’t found. Your campaign is preserved.`;
			return;
		}
		const result = loadGameState(persisted);
		if (!result.ok) {
			// A shipped scenario should always be ok; keep the branch total (Plan 03's import flow
			// reuses this surface for a bad AI-generated paste).
			this.loadNotice = this.#rejectNotice(result);
			return;
		}
		// Import-creates-new (SCEN-06 / D-05): a fresh stable id, NEVER from meta.campaignName.
		this.loadNotice = null;
		this.state = result.state;
		this.events = result.events;
		this.campaignId = randomId();
		this.#rebuildMirrorTail();
		this.pickerOpen = false;
		// A real game is now mounted — close the shelf too (the picker may have been opened FROM the
		// Campaigns shelf), so the player lands in the new game rather than back on the shelf which
		// (same z-plane, later in the DOM) would otherwise re-cover it.
		this.campaignsOpen = false;
		this.campaignsDismissible = false;
		await this.#persistTurnZeroBase();
	};

	/**
	 * `switchCampaign(id)` (CAMP-07 / D-02) — THE phase correctness seam: swap the live campaign to
	 * an existing on-disk one, reassigning `state` + `campaignId` + `events` ATOMICALLY through the
	 * ONE `loadGameState` materialize path, so the UI never observes a half-switched state AND a
	 * background `flushSave` captured under the prior campaign can never write into the switched-to
	 * one. The four-step guard contract:
	 *
	 *   1. `#switchEpoch++` FIRST — any flush whose epoch was captured before this point fails its
	 *      resolve-time discard guard, so an in-flight prior-campaign flush is dropped, not mis-written.
	 *   2. `await flushSave()` — settle any pending flush BEFORE swapping so no write straddles the
	 *      swap (D-02). The bumped epoch already discards a mid-resolve flush; this awaits the settle.
	 *   3. `loadEnvelope(id)` — a falsy result is a recoverable degenerate row: RETURN without swapping
	 *      (campaignId unchanged, the live campaign stays mounted), never a throw.
	 *   4. `loadGameState(persisted)` — the ONE validate→migrate→fold path. On `ok`, reassign the
	 *      atomic quartet TOGETHER (no await between the four reassignments — mirrors the boot resume
	 *      arm L472-475). On `!ok`, surface a recoverable `loadNotice` and leave the current campaign
	 *      mounted (the rejected campaign's rows survive on disk untouched).
	 *
	 * This is a SEPARATE entry from boot() — it does NOT run inside boot()'s device-hardening timeout
	 * race, so the S23-Ultra hang fix is untouched. Arrow field for `this` binding (runes discipline).
	 */
	switchCampaign = async (id: string): Promise<void> => {
		// (1) Bump the epoch FIRST so any flush captured before this resolves to a discard.
		this.#switchEpoch++;
		// (2) Settle any in-flight flush before swapping so no write straddles the swap.
		await this.flushSave();
		// (3) Resolve the target through the unfolded read; a missing/degenerate row is recoverable.
		const persisted = await this.#saveStore.loadEnvelope(id);
		if (!persisted) return; // degenerate row — leave the live campaign mounted, no swap.
		// (4) The ONE materialize path (validate→migrate→fold).
		const result = loadGameState(persisted);
		if (!result.ok) {
			// LOAD-03 / D-03: a forward-incompatible / shape-invalid target. NEVER overwrite or delete
			// its rows — surface a recoverable notice and stay on the current campaign.
			this.loadNotice = this.#rejectNotice(result);
			return;
		}
		// Atomic quartet — reassigned TOGETHER, no await between them (boot resume arm L472-475). The
		// UI can never observe campaignId === id while events/state still read the prior campaign.
		this.loadNotice = null;
		this.state = result.state;
		this.campaignId = id;
		this.events = result.events;
		this.#rebuildMirrorTail();
	};

	/**
	 * `importScenarioFromPaste(raw)` (SCEN-02) — the "Create new via AI" paste-back bridge: an
	 * UNTRUSTED AI-authored scenario seed crosses the SAME fenced-extract → shape-validate path
	 * the turn round-trip uses, then the SAME `loadGameState` domain gate every source crosses,
	 * and on success materializes a NEW independent campaign exactly like `newGameFromScenario`.
	 *
	 * TOTAL and NON-THROWING (NARR-03 / T-09C-01): every failure sets `scenarioImportError` and
	 * RETURNS — the picker keeps the paste box open and re-pasteable, never a crash. The four
	 * recoverable rejections, in order:
	 *   1. extractFencedJson → JSON.parse in try/catch — a non-JSON paste is a recoverable error.
	 *   2. validateSaveEnvelope — a maliciously/wrongly-shaped paste (extra keys, wrong types,
	 *      forged schemaVersion) is hard-rejected by the valibot strictObject allow-list
	 *      (T-09C-02) BEFORE any field is read.
	 *   3. loadGameState — runs the Plan-01 `validateSeed` DOMAIN gate inside the load boundary;
	 *      a shape-valid-but-illegal seed (capability ∈ prohibited, off-manifest) is rejected at
	 *      load with a clear reason (T-09C-03 / SCEN-03), never three turns later.
	 *   4. on `ok` — adopt the folded state/events under a FRESH `randomId()` campaignId (D-05:
	 *      never from `meta.campaignName`), rebuild the mirror, clear the error, close the picker,
	 *      and persist (the import-creates-new contract — SCEN-06, a new independent campaign).
	 */
	importScenarioFromPaste = async (raw: string): Promise<void> => {
		// 1. Forgiving fenced extraction (the SAME step turns use) → JSON.parse in try/catch. A
		//    malformed/non-JSON paste is recoverable — set the error and RETURN, never throw
		//    (T-09C-01 DoS mitigation: an arbitrary paste can never crash or hang the import).
		const candidate = extractFencedJson(raw);
		let parsed: unknown;
		try {
			parsed = JSON.parse(candidate);
		} catch {
			this.scenarioImportError =
				'That paste was not valid JSON. Copy the AI’s ```json block and paste again.';
			return;
		}

		// 2. The SAME valibot strictObject shape gate the save-import path uses (PersistedGame =
		//    SaveEnvelope). Extra/hallucinated top-level keys and type drift hard-reject here
		//    BEFORE any field is read (T-09C-02 / T-09C-04 — the allow-list admits only the four
		//    known keys, so a top-level __proto__/constructor fails the gate).
		const shape = validateSaveEnvelope(parsed);
		if (!shape.ok) {
			this.scenarioImportError = shape.error;
			return;
		}

		// 3. The ONE load boundary — validate (incl. the Plan-01 seed DOMAIN gate) → migrate →
		//    fold. An illegal-but-shape-valid seed surfaces as `illegal-seed` here (T-09C-03).
		const result = loadGameState(shape.value);
		if (!result.ok) {
			this.scenarioImportError = this.#rejectNotice(result);
			return;
		}

		// 4. Import-creates-new (SCEN-06 / D-05): adopt the folded state/events under a FRESHLY
		//    minted stable id (NEVER from meta.campaignName), rebuild the mirror, clear the error,
		//    close the picker, then write the turn-0 base directly so the new campaign survives a
		//    reload BEFORE turn 1 (an explicit `#saveStore.save(id, 0, [], base)` — see
		//    `#persistTurnZeroBase`; flushSave's `currentTurn < 1` guard would no-op here).
		this.scenarioImportError = null;
		this.loadNotice = null;
		this.state = result.state;
		this.events = result.events;
		this.campaignId = randomId();
		this.#rebuildMirrorTail();
		this.pickerOpen = false;
		// A real game is now mounted — close the shelf too (the picker may have been opened FROM the
		// Campaigns shelf), so the player lands in the new game rather than back on the shelf which
		// (same z-plane, later in the DOM) would otherwise re-cover it.
		this.campaignsOpen = false;
		this.campaignsDismissible = false;
		await this.#persistTurnZeroBase();
	};

	/**
	 * SCEN-06 durability: persist the just-adopted turn-0 campaign NOW so it survives a reload
	 * BEFORE turn 1. `flushSave()` is a no-op at turn 0 — its `currentTurn < 1` guard protects the
	 * mid-turn tail-split path, not a fresh seed — so a turn-0 scenario/AI-import held only in
	 * reactive memory was silently lost on a reload-before-turn-1 (CR-01). The new campaign is a
	 * fresh foldable base: `IdbSaveStore.save`'s `isFirstSave` path writes a base snapshot on the
	 * first save of a campaign regardless of snapshot cadence, so `save(id, 0, [], base)` is a
	 * valid, replayable turn-0 base. `$state.snapshot(...)` crosses the engine boundary off the
	 * reactive proxy (Pitfall 1, matching flushSave). A blocked/unavailable IndexedDB REJECTS at
	 * the openDB boundary (T-09E-02 / T-r7j-01) — caught here to degrade to in-memory-only
	 * (`saveUnavailable`), never an unhandled rejection, never a crash. TOTAL / non-throwing.
	 */
	#persistTurnZeroBase = async (): Promise<void> => {
		if (!this.state) return;
		try {
			const base = $state.snapshot(this.state) as GameState;
			await this.#saveStore.save(this.campaignId, 0, [], base);
		} catch {
			this.saveUnavailable = true;
		}
	};

	/**
	 * Map a non-ok `LoadResult` to a recoverable, non-destructive player notice (LOAD-03 / D-03).
	 * Both reject reasons carry the `error` from the engine; we frame the newer-version case
	 * explicitly so the player understands their campaign is preserved, not lost.
	 */
	// Accepts the full LoadResult reject union. The `illegal-seed` reason (Phase 9 SCEN-03)
	// is surfaced properly by the scenario-picker import flow in Plan 03; on the resume/starter
	// boot arms it is unreachable (a shipped/resumed seed never fails the domain gate), so it
	// safely falls through to the generic "couldn’t read this save" branch here.
	#rejectNotice = (result: {
		reason: 'shape-invalid' | 'newer-version' | 'illegal-seed';
		error: string;
	}): string => {
		if (result.reason === 'newer-version') {
			return 'This save was made by a newer version of Frosty — your campaign is preserved; update to open it.';
		}
		return `Couldn’t read this save — your campaign is preserved. (${result.error})`;
	};

	/**
	 * The shared mirror-rebuild tail (runs on EVERY boot arm). Defaults `narrativeLog` to [] for a
	 * pre-Phase-6 save (additive display-only field, NO schemaVersion bump — Pitfall 5), rebuilds
	 * the turn-tagged prose scrollback from the persisted `narrativeLog` (bridging
	 * narrativeLog.text → LogEntry.narrative), and lands the machine at 'idle'. It does NOT touch
	 * `this.events` — the A4 decision sets that per-arm (from the envelope, not reconstructed).
	 */
	#rebuildMirrorTail = (): void => {
		if (!this.state) return;
		this.state.narrativeLog ??= [];
		this.log = this.state.narrativeLog.map((n) => ({ turn: n.turn, narrative: n.text }));
		this.machine = 'idle';
	};

	/**
	 * Begin a turn from the player's raw prose order. Snapshots state/events at the engine
	 * boundary (Pitfall 1), reads the TEST-ONLY roller seam (undefined in production), and
	 * drives `runTurn` — supplying the confirm + prompt callbacks the orchestrator awaits.
	 */
	startTurn = (orderRaw: string): void => {
		if (!this.state) return;
		this.machine = 'composing';
		this.pasteError = null;
		this.rejections = [];

		const roller = testRoller();

		runTurn(
			{
				narrator: this.#narrator,
				saveStore: this.#saveStore,
				roller,
				awaitConfirm: this.#awaitConfirm,
				onPrompt: (p: string) => {
					this.prompt = p;
					// Clear any stale confirm rows so a post-adjust re-entry to awaitingPaste
					// shows no leftover gate (the loop re-fires this callback on re-paste).
					this.confirmRows = [];
					this.machine = 'awaitingPaste';
				}
			},
			$state.snapshot(this.state),
			$state.snapshot(this.events),
			// ORDER-06 / D-02: merge the tapped structured proposals with the typed override into
			// ONE PlayerOrder — both carried, neither dropped (mergeOrder). `$state.snapshot` strips
			// the reactive proxy off pendingActions so a plain POJO reaches the pure engine (Pitfall 1).
			mergeOrder($state.snapshot(this.pendingActions), orderRaw),
			this.campaignId,
			this.state.meta.turn + 1
		)
			.then(this.#applyResult)
			.catch(this.#onCancelled);

		// Clear the tapped accumulator so the NEXT turn starts empty (the order is now in flight,
		// carried by the merged PlayerOrder above). Reassign for runes reactivity.
		this.pendingActions = [];
	};

	/**
	 * Settle a pasted AI reply through the narrator ONLY (no raw deserialize — V5/T-05-03).
	 * A bad paste sets a recoverable inline `pasteError` and RETURNS; the turn Promise stays
	 * pending (re-pasteable, NARR-03) — it is NEVER thrown/rejected. A good paste clears the
	 * error and lets `runTurn` resume into the confirm gate.
	 */
	submitPaste = (raw: string): void => {
		const r = this.#narrator.submitPaste(raw);
		if (!r.ok) {
			this.pasteError = r.error;
			return;
		}
		this.pasteError = null;
	};

	/**
	 * Approve the confirm gate → resolve true; the turn proceeds into resolution. A
	 * dead SECOND click (after the turn already resolved, so `#confirmResolve` is null)
	 * is a harmless no-op: we only flip the machine to 'resolving' when there is a
	 * pending resolver to settle, so a stale Confirm button can never wedge the machine
	 * at 'resolving' (A — defense-in-depth alongside #applyResult clearing confirmRows).
	 */
	confirm = (): void => {
		if (this.#confirmResolve === null) return;
		this.machine = 'resolving';
		this.#settleConfirm(true);
	};

	/**
	 * Decline the confirm gate → resolve false. The orchestrator's loop (CR-02 / Design A)
	 * re-arms the narrator and re-fires onPrompt, which sets machine='awaitingPaste' through
	 * the SAME path a fresh turn takes — so we deliberately do NOT assign the machine here
	 * (a synchronous assignment was the value #applyResult clobbered to idle). The declined
	 * run Promise stays pending, so #applyResult never fires on the aborted iteration.
	 */
	adjust = (): void => {
		this.#settleConfirm(false);
	};

	/** The ONLY abandon path — rejects the in-flight narrator Promise (#onCancelled resets). */
	cancel = (): void => {
		this.#narrator.cancel('player cancelled the turn');
	};

	/**
	 * Public read-only seam over the store's campaign rows — delegates to the existing
	 * public `IdbSaveStore.list()`. The CR-04 continuity test asserts through THIS (a public
	 * seam) rather than the private `#saveStore`, proving the bridge keyed its own store
	 * consistently (exactly one row across seed→save→reload→save). Arrow field so `this`
	 * stays bound per the runes discipline.
	 */
	listCampaigns = (): Promise<CampaignRow[]> => this.#saveStore.list();

	/**
	 * `deleteCampaign(id)` (CAMP-01 / CAMP-04 / D-03) — the render-only shelf's delete bridge: an
	 * IRREVERSIBLE cascade through the Plan-01 store verb. Thin arrow-field so the component never
	 * imports the store. Recoverable + non-throwing: a `!ok` Result surfaces a warning, a blocked
	 * store reject degrades to `saveUnavailable` (never escapes the click handler).
	 *
	 * D-03 active-delete fallback: if the deleted id is the LIVE campaign, after the cascade fall to
	 * the NEXT-most-recent (`list()` reduce by updatedAt) via `switchCampaign(nextId)`; if none
	 * remain, open the picker / land on empty state (D-05). A non-active delete leaves the live
	 * campaign mounted. The component re-reads `listCampaigns()` after the mutation (UI contract).
	 */
	deleteCampaign = async (id: string): Promise<void> => {
		try {
			const result = await this.#saveStore.deleteCampaign(id);
			if (!result.ok) {
				this.lifecycleWarning =
					'Couldn’t delete this campaign. Check device storage and try again.';
				return;
			}
			this.lifecycleWarning = null;
			// D-03: deleting the ACTIVE campaign must fall to the next-most-recent, never leave the
			// UI pointed at a now-deleted id. A non-active delete leaves the live campaign untouched.
			if (id === this.campaignId) {
				const rows = await this.#saveStore.list();
				if (rows.length === 0) {
					// D-05: no campaigns remain — open the picker so the player can start a new game. The
					// shelf is no longer dismissible to a game (the one we were on is gone); the picker
					// (higher z-plane) covers it and a successful New game closes both surfaces.
					this.campaignsDismissible = false;
					this.openPicker();
					return;
				}
				const nextId = rows.reduce((best, r) => (r.updatedAt >= best.updatedAt ? r : best)).id;
				// CR-01 / CAMP-04: mark the just-deleted active id so switchCampaign's step-2 flushSave
				// drops its (otherwise-resurrecting) "behind"(null) write for this dead campaign rather
				// than re-creating its row. Set BEFORE the switch so the in-line flush sees the marker.
				this.#deletedActiveId = id;
				await this.switchCampaign(nextId);
			}
		} catch {
			// Blocked storage (openDB rejects): never let a reject escape the handler (T-r7j-01).
			this.saveUnavailable = true;
		}
	};

	/**
	 * `rename(id, name)` (CAMP-01 / CAMP-03 / D-07) — display-name-only rename bridge through the
	 * Plan-01 store verb. An empty/whitespace name is the store's authoritative recoverable reject
	 * (`!ok`) surfaced here as a muted warning; no switch, the row name is unchanged. A blocked
	 * store reject degrades to `saveUnavailable`. The component re-reads `listCampaigns()` after.
	 */
	rename = async (id: string, name: string): Promise<void> => {
		try {
			const result = await this.#saveStore.rename(id, name);
			if (!result.ok) {
				this.lifecycleWarning = 'Name can’t be empty.';
				return;
			}
			this.lifecycleWarning = null;
		} catch {
			this.saveUnavailable = true;
		}
	};

	/**
	 * `duplicate(id)` (CAMP-01 / CAMP-06 / D-04 / D-08) — fork a full-history clone through the
	 * Plan-01 store verb. On `ok` it surfaces a polite `Duplicated as "<name>"` toast signal (read
	 * the new row's name back from `list()` so the toast names the suffixed `(copy)` title the store
	 * actually wrote); the new row appears when the screen re-reads `listCampaigns()`. A `!ok` /
	 * blocked store degrades to a warning / `saveUnavailable`. Never throws out of the click handler.
	 */
	duplicate = async (id: string): Promise<void> => {
		try {
			const result = await this.#saveStore.duplicate(id);
			if (!result.ok) {
				// WR-03: a failed duplicate must not leave a stale "Duplicated as …" toast pinned at the
				// page level alongside the fresh "Couldn’t duplicate" warning. Clear the toast here.
				this.duplicateToast = null;
				this.lifecycleWarning =
					'Couldn’t duplicate this campaign. Check device storage and try again.';
				return;
			}
			this.lifecycleWarning = null;
			// Name the toast after the row the store actually wrote (the non-colliding `(copy)` title).
			const rows = await this.#saveStore.list();
			const made = rows.find((r) => r.id === result.value);
			this.duplicateToast = made ? `Duplicated as “${made.name}”` : 'Campaign duplicated';
			// WR-03: auto-dismiss the toast (it renders page-level, outside the shelf) so it does not
			// stay pinned after returning to the game. Mirrors the `copied` setTimeout idiom in
			// +page.svelte. Capture the message we set so a later duplicate's toast is never cleared by
			// an earlier timer — only clear if this exact toast is still the one showing.
			const shown = this.duplicateToast;
			setTimeout(() => {
				if (this.duplicateToast === shown) this.duplicateToast = null;
			}, 4000);
		} catch {
			this.saveUnavailable = true;
		}
	};

	/**
	 * `importCampaignFile(file)` (CAMP-01 / D-08 / T-10-05) — the NEW import-file seam: read an
	 * uploaded `.frosty.json` through the Plan-01 store `import()` (which validate→migrate→creates a
	 * NEW campaign under a fresh id — NEVER overwrites an existing one). On `ok` open the imported
	 * campaign via `switchCampaign(newId)`; on `!ok` (bad JSON / wrong shape / newer-version) set a
	 * recoverable warning and leave the import entry re-tryable (mirrors `scenarioImportError`
	 * discipline). NEVER throws out of the file-input change handler — a blocked store degrades to
	 * `saveUnavailable`. The import is creates-new, so an existing campaign is never at risk.
	 */
	importCampaignFile = async (file: File): Promise<void> => {
		try {
			const result = await this.#saveStore.import(file);
			if (!result.ok) {
				this.lifecycleWarning =
					'Couldn’t import — the file isn’t a valid Frosty save, or it’s from a newer version. Export a fresh save and try again.';
				return;
			}
			this.lifecycleWarning = null;
			// Open the freshly-imported campaign through the atomic switch seam.
			await this.switchCampaign(result.value);
			// The imported campaign is now live — close the shelf so the player lands in it.
			this.campaignsOpen = false;
			this.campaignsDismissible = false;
		} catch {
			this.saveUnavailable = true;
		}
	};

	/**
	 * TEST-ONLY seam (mirrors the `__frostyRoller` / `__failNextWriteWith` idiom) — swap the
	 * private store reference so a suite can inject a stub `SaveStore` whose `load()` rejects,
	 * exercising the boot-catch / blocked-storage path without a real blocked IndexedDB
	 * (T-r7j-01). Tiny by design: it only re-points `#saveStore`. Never called in production.
	 */
	__setSaveStoreForTest = (store: SaveStore): void => {
		this.#saveStore = store;
	};

	/**
	 * TEST-ONLY seam (mirrors `__setSaveStoreForTest`) — shrink the boot-load timeout so the
	 * hang-path regression (`load()` never settles) races to the seed fallback in a millisecond
	 * rather than waiting the production 3s. Restore it to `BOOT_LOAD_TIMEOUT_MS` in afterEach so
	 * the shrunk value never leaks to sibling suites importing the singleton. Never called in
	 * production (T-s02-01).
	 */
	__setBootLoadTimeoutForTest = (ms: number): void => {
		this.#bootLoadTimeoutMs = ms;
	};

	/**
	 * Public seam over the store's `export()` (SAVE-04) — the recoverable escape hatch the
	 * flush-failed notice offers (UI-08 / UI-SPEC line 147: "export your campaign"). Writes the
	 * campaign out as a downloadable `.frosty.json` so a turn that couldn't autosave before
	 * backgrounding is never lost. Clears the flush notice on a successful export. Arrow field
	 * so `this` stays bound per the runes discipline.
	 */
	exportCampaign = async (): Promise<void> => {
		if (!this.campaignId) return;
		try {
			await this.#saveStore.export(this.campaignId);
			this.flushError = null;
		} catch {
			// Blocked storage (openDB rejects): a rejection must never escape out of a click
			// handler. Surface the in-memory-only mode instead of throwing (T-r7j-01).
			this.saveUnavailable = true;
		}
	};

	/**
	 * `exportCampaignById(id)` (CAMP-05 / D-08) — the per-ROW export seam the Campaigns shelf needs.
	 * `exportCampaign()` above exports the ACTIVE campaign only (keyed off `this.campaignId`); a
	 * row's `↥ Export` action must write out THAT campaign even when it is not the live one. The
	 * store's `export(id)` already accepts any campaign id, so this delegates straight to it with the
	 * same recoverable discipline: a blocked-storage / write fault is a warning-amber
	 * `lifecycleWarning` (UI-SPEC "Couldn't export…"), never a thrown rejection escaping a click
	 * handler. Render-only-component-safe: the row dispatches this, never touches the store.
	 */
	exportCampaignById = async (id: string): Promise<void> => {
		try {
			await this.#saveStore.export(id);
			this.lifecycleWarning = null;
		} catch {
			this.lifecycleWarning = 'Couldn’t export this campaign. Check device storage and try again.';
		}
	};

	/**
	 * Persist the live mirror's current turn into the store so a subsequent `undoLastTurn`
	 * has a tail to drop (UI-07). This is the test-driving seam (`undo.svelte.test.ts` calls
	 * it after mutating the in-memory mirror, since it seeds the singleton directly and never
	 * boots the real DB). In production the orchestrator (`runTurn`) already persists each
	 * resolved turn, so this is a no-op when there is nothing new to flush.
	 *
	 * It reconstructs the historical pre-turn base (the live `this.state` reverted to
	 * `currentTurn - 1` — the live state does NOT carry the tail's materialized ledger, that
	 * lives only in `this.events`), saves it as the base, then saves the tail turn's events
	 * folded forward. After this the store holds: base snapshot at currentTurn-1 + the tail
	 * events at currentTurn — exactly what `undoLastTurn(id, currentTurn)` drops back through.
	 *
	 * IDEMPOTENCY (the flushsave-event-duplication fix): `IdbSaveStore.save()` is a pure APPEND
	 * (events.add with an autoIncrement seq, no dedup). In production `runTurn` already persisted
	 * every turn — including the current one — incrementally, so replaying `prior` + `tail` here
	 * re-appended the WHOLE history on every background flush (pagehide / visibilitychange fires
	 * this repeatedly), duplicating the event stream and corrupting the folded narrativeLog
	 * (each_key_duplicate). The guard below makes flushSave a true NO-OP once the current turn is
	 * already on disk: it only writes when the store is genuinely BEHIND the live turn (the undo
	 * test seam, which seeds the mirror in-memory and never per-turn-saves; or a turn whose
	 * per-turn autosave returned not-ok). The write path is otherwise unchanged.
	 */
	flushSave = async (): Promise<void> => {
		if (!this.state) return;
		const currentTurn = this.state.meta.turn;
		if (currentTurn < 1) return;
		// LOAD-04 / D-05: campaignId is the STABLE row id, NEVER derived from meta.campaignName. By
		// the time flushSave runs, boot() has already set a stable id; if it is somehow empty,
		// generate a fresh randomId() (never the display name — a rename must not fork the rows).
		if (!this.campaignId) this.campaignId = randomId();
		const id = this.campaignId;
		// CAMP-07 / D-02: capture the switch-generation token alongside `id` at write START. If a
		// `switchCampaign` bumps the epoch (or the active id changes) while this flush is in flight,
		// the resolve-time guard below DISCARDS the write — a late prior-campaign flush can never land
		// in the switched-to campaign nor re-append into the prior one. Generalizes the 8f23f0e
		// `const id` idempotency capture into an explicit generation token (STRENGTHEN, never weaken).
		const epoch = this.#switchEpoch;

		// T-r7j-01: a blocked/unavailable IndexedDB makes `save()`/`load()` REJECT at the openDB
		// boundary (BEFORE save()'s internal not-ok SaveResult try/catch). flushSave runs on
		// pagehide/visibilitychange-hidden, so an escaping rejection would surface as an unhandled
		// rejection. Catch it and flag in-memory-only mode instead. The recoverable not-ok
		// `{ok:false}` path (quota / io) still sets flushError below exactly as before.
		try {
			// IDEMPOTENCY GUARD: read what the store already holds for this campaign. If its folded
			// turn is already at (or beyond) the live turn, `runTurn` persisted the tail incrementally
			// and there is NOTHING new to flush — re-appending here is exactly the duplicating write.
			// No-op (and clear any stale flush notice, since the campaign IS durable). Only when the
			// store is BEHIND (null = nothing persisted, e.g. the undo seam; or turn < currentTurn =
			// an unsaved tail) do we write the base + tail below.
			// CR-01 / CAMP-04: NEVER resurrect a JUST-DELETED active campaign. The active-delete
			// fallback (`deleteCampaign`) cascades the live campaign off disk, then drives
			// `switchCampaign` over the still-mounted (now-deleted) id; switchCampaign's step-2 flush
			// would otherwise hit the "behind"(null) branch below and re-write the deleted
			// base+events+campaigns-row back to disk (IdbSaveStore.save's isFirstSave path re-creates
			// the row), silently undoing the irreversible cascade — for exactly the most common case
			// (deleting the campaign you are playing). `deleteCampaign` records the deleted id in
			// `#deletedActiveId` BEFORE the fallback switch; if THIS flush is for that id, drop it
			// without writing and consume the marker. This precisely targets the cascade case and never
			// touches the legitimate "behind"(null) write the undo seam relies on (a never-saved
			// campaign carries no marker). Nulling `campaignId` alone is insufficient — flushSave mints
			// a fresh id when it is empty (above) and would persist the dead state under that new id.
			// This removes a write; it fabricates none (authority rule untouched).
			if (this.#deletedActiveId === id) {
				this.#deletedActiveId = null;
				this.flushError = null;
				return;
			}

			const persisted = await this.#saveStore.load(id);
			if (persisted && persisted.meta.turn >= currentTurn) {
				this.flushError = null;
				return;
			}

			// CAMP-07 / D-02 DISCARD GUARD: between the captures above and HERE we awaited a store
			// read; a `switchCampaign` may have run in that gap (bumping `#switchEpoch` and reassigning
			// `campaignId`). If so, this flush belongs to a campaign the player has switched OUT of —
			// DROP it without writing, so a late prior-campaign flush never re-appends into the prior
			// stream nor lands in the switched-to one. Do NOT set flushError for the discarded stale
			// write (the live campaign owns its own notice). The captured `id` already scoped the writes
			// to the prior campaign's rows; this guard adds the resolve-time DISCARD for an in-flight flush.
			if (this.#switchEpoch !== epoch || this.campaignId !== id) return;

			// Snapshot off the reactive proxy at the engine boundary (Pitfall 1). Split the live
			// stream into the prior history (turn < currentTurn) and the tail (turn === currentTurn).
			const allEvents = $state.snapshot(this.events) as GameEvent[];
			const tail = allEvents.filter((e) => e.turn === currentTurn);
			const prior = allEvents.filter((e) => e.turn < currentTurn);

			// The historical base: the live state reverted to the prior turn. The tail's ledger is
			// not folded into `this.state` (it lives in `this.events`), so reverting meta.turn yields
			// the pre-turn historical content. Persist it as the fold base, then the tail forward.
			const snap = $state.snapshot(this.state) as GameState;
			const historicalBase: GameState = { ...snap, meta: { ...snap.meta, turn: currentTurn - 1 } };

			const baseResult = await this.#saveStore.save(id, currentTurn - 1, prior, historicalBase);
			const postTurn = fold(historicalBase, tail);
			const tailResult = await this.#saveStore.save(id, currentTurn, tail, postTurn);

			// UI-08 / D-05: surface the recoverable flush-failed hint when either write returns a
			// not-ok SaveResult (quota / io). The flush owns no ledger authority — this is the
			// existing recoverable SaveResult made visible (UI-SPEC line 147), nothing more. A
			// successful flush clears any stale notice so the warning never lingers past recovery.
			if (!baseResult.ok || !tailResult.ok) {
				this.flushError = 'Couldn’t save before backgrounding — export your campaign.';
			} else {
				this.flushError = null;
			}
		} catch {
			this.saveUnavailable = true;
		}
	};

	/**
	 * Undo the last resolved turn (UI-07 / D-03). Drops the tail turn from the store (the
	 * audited tail-delete + fold-forward in `IdbSaveStore.undoLastTurn`) and rolls the LIVE
	 * reactive mirror back to the returned historical state — EXACTLY as `boot()` rebuilds
	 * the mirror from a reloaded state (RESEARCH Pattern 5). `this.events` is REBUILT via the
	 * A4 `eventsFromExpended` reconstruction, NEVER an in-place splice of `this.events`
	 * (RESEARCH Anti-Pattern). `lastResolution` clears to null (OQ#2 — the banner empties).
	 * Mutates the singleton's properties; never reassigns `game`.
	 */
	undoLastTurn = async (): Promise<void> => {
		if (!this.state) return;
		const droppedTurn = this.state.meta.turn;
		if (droppedTurn < 1) return; // nothing to undo at the turn-0 base

		const prior = await this.#saveStore.undoLastTurn(this.campaignId, droppedTurn);
		if (!prior) return;

		// Roll back the live mirror EXACTLY as boot does: re-proxify the historical state on
		// assign, default + rebuild the prose scrollback, and reconstruct this.events from the
		// reloaded state's materialized ledger floor (A4) — NOT a splice of the live stream.
		this.state = prior;
		this.state.narrativeLog ??= [];
		this.log = this.state.narrativeLog.map((n) => ({ turn: n.turn, narrative: n.text }));
		this.events = eventsFromExpended(this.state);
		this.lastResolution = null; // OQ#2 — the show-your-work banner derives to empty
		this.rejections = [];
		this.confirmRows = [];
		this.machine = 'idle';
	};

	// ── Private seams ───────────────────────────────────────────────────────────

	/**
	 * The confirm-gate callback handed to `runTurn`. The gate is SKIPPED (resolves true
	 * immediately, auto-proceeding the turn) when EITHER:
	 *   - the gate is disabled (ORDER-03 — `confirmEnabled === false`), or
	 *   - there is nothing to confirm (`rows.length === 0`): a recon / hold / observe turn
	 *     whose actions carry no positive-qty expend and no casualties (FOG-03). With no
	 *     rows the DiceConfirmPanel renders no Confirm control, so parking at 'confirming'
	 *     would strand the machine with no way to advance or abort — the soft-lock this
	 *     guard prevents. Nothing to gate ⇒ nothing to wedge on.
	 * Otherwise (a materiel turn, `rows.length > 0`) it surfaces the rows and returns a
	 * Promise the UI settles via `confirm()`/`adjust()` — the gate is unchanged for the
	 * case it exists to protect.
	 */
	#awaitConfirm = (rows: ConfirmRow[]): Promise<boolean> => {
		if (!this.confirmEnabled || rows.length === 0) return Promise.resolve(true);
		this.confirmRows = rows;
		this.machine = 'confirming';
		return new Promise<boolean>((resolve) => {
			this.#confirmResolve = resolve;
		});
	};

	#settleConfirm = (ok: boolean): void => {
		const resolve = this.#confirmResolve;
		this.#confirmResolve = null;
		resolve?.(ok);
	};

	/**
	 * Apply a completed turn: re-proxify the folded state on assign, append this turn's
	 * events to the live stream (so `remaining` rederives), push the narrative, surface the
	 * dice "show your work" + rejections, and flag a save failure. Returns to idle.
	 */
	#applyResult = (res: {
		state: GameState;
		events: GameEvent[];
		rejections: GameEvent[];
		saveOk: boolean;
		narrative: string;
	}): void => {
		this.state = res.state;
		this.events = [...this.events, ...res.events];

		// Append the AI's prose to the turn-tagged scrollback (escaped-text only — the
		// panel never uses {@html}). Skip an empty narrative so an aborted turn writes
		// no log entry. Reassign the array (mutate-then-reassign) to keep runes reactivity.
		if (res.narrative) {
			this.log = [...this.log, { turn: res.state.meta.turn, narrative: res.narrative }];
		}

		const dice = res.events.find((e): e is Extract<GameEvent, { kind: 'dice' }> => e.kind === 'dice');
		if (dice) {
			this.lastResolution = {
				roll: dice.roll,
				modifiers: dice.modifiers,
				net: dice.net,
				band: dice.band
			};
		}

		this.rejections = res.rejections
			.filter((e): e is Extract<GameEvent, { kind: 'rejected' }> => e.kind === 'rejected')
			.map((e) => ({ actor: e.actor, reason: e.reason }));

		if (this.#narrator.prompt) this.prompt = this.#narrator.prompt;
		if (!res.saveOk) this.pasteError = 'Could not save — export your campaign to be safe.';

		// Clear the confirm gate's rows on resolution (symmetric with #onCancelled) so
		// the DiceConfirmPanel's Confirm/Adjust/Cancel block disappears — no dead controls
		// persist after a turn resolves (A — UI-04). Reassign to keep runes reactivity.
		this.confirmRows = [];
		this.machine = 'idle';
	};

	/** A cancelled / abandoned turn resets the machine without touching state. */
	#onCancelled = (): void => {
		this.confirmRows = [];
		this.#confirmResolve = null;
		this.machine = 'idle';
	};
}

/** THE singleton — mutate `game.*`, never reassign the binding (CLAUDE.md cross-module rule). */
export const game = new Game();

// Silence the unused-import lint for the type-only Modifier re-export consumers may want;
// `roll`'s type is referenced via `typeof roll` above. Modifier is part of the documented
// surface but not directly referenced — drop it if a future reader prefers.
export type { Modifier };
