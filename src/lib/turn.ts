// turn.ts — pure DI turn orchestrator (spec §6.1). PURE: no Svelte import (CORE-02 by discipline).
//
// `runTurn` sequences the §6.1 pipeline from injected dependencies only — it owns no
// state, no transport, no storage, and no entropy of its own. Every collaborator is a
// `TurnDeps` field, so the orchestrator is unit-testable with mocked deps (turn.test.ts)
// and the Svelte bridge (game.svelte.ts) is the only thing that supplies real ones.
//
// The pipeline, in order (RESEARCH Pattern 2):
//   onPrompt(buildPrompt) → narrator.run → validate → confirmDiff + awaitConfirm
//     → resolveTurn → fold → saveStore.save → TurnResult
//
// Two design seams worth naming:
//   - DEFERRED PROMISE (narrator.run): `await narrator.run(payload)` does NOT settle
//     until the UI later calls `narrator.submitPaste(raw)` with the AI's reply — a bad
//     paste keeps it pending (recoverable), only `narrator.cancel()` rejects it. So a
//     rejected/abandoned turn propagates as a rejection of the awaited Promise here;
//     `runTurn` never swallows it (turn.test.ts (b)/(d) lock this).
//   - RESULT-NOT-THROW (saveStore.save): a failed durable write is the SaveResult
//     `{ ok:false }`, surfaced as `saveOk:false` — never a throw that would lose the
//     in-memory turn (mirrors submitPaste's recoverable return).
//
// PURITY: imports only `./engine/*` modules; NEVER from Svelte. The `state`/`priorEvents`
// args are plain POJOs — the CALLER snapshots them ($state.snapshot in game.svelte.ts);
// turn.ts neither snapshots nor mutates them.

import type { Narrator, TurnPayload } from './engine/narrator';
import type { SaveStore } from './engine/save-store';
import type { MoveEnvelope, PlayerOrder, ResolvedActionProposal } from './engine/envelope';
import type { GameState } from './engine/state';
import type { GameEvent } from './engine/events';
import type { ConfirmRow } from './engine/confirm';
import { roll } from './engine/dice';
import { buildPrompt } from './engine/prompt';
import { validate } from './engine/validate';
import { confirmDiff } from './engine/confirm';
import { resolveTurn } from './engine/resolve';
import { fold } from './engine/state';
import { sizeTurn } from './engine/size-turn';
import { selectModules } from './engine/rules/registry';

/**
 * Everything the orchestrator needs, injected. `narrator`/`saveStore`/`awaitConfirm`/
 * `onPrompt` are REQUIRED (no real defaults — the bridge or a test supplies them);
 * `roller` MAY default to the real Web Crypto `roll` so production dice stay neutral.
 *
 *   - narrator      — the transport seam (ClipboardNarrator in v1); `run()` is deferred.
 *   - saveStore     — the persistence seam; `save()` returns a recoverable SaveResult.
 *   - roller        — the determinism seam threaded into resolveTurn (default real roll).
 *   - awaitConfirm  — the confirm-gate callback: rows in, a boolean out (false = abort).
 *   - onPrompt      — surfaces the copyable prompt string to the UI (testability seam).
 *
 * Phase 6 (DEPTH-02): the inline `rules` string dependency is GONE — `sizeTurn` +
 * `selectModules` now SOURCE the rules per turn from the modular registry, so the
 * orchestrator no longer needs a caller-supplied ruleset literal.
 */
export interface TurnDeps {
	narrator: Narrator;
	saveStore: SaveStore;
	roller?: typeof roll;
	awaitConfirm: (_rows: ConfirmRow[]) => Promise<boolean>;
	onPrompt: (_prompt: string) => void;
}

/** The orchestrator's output: the folded state-after, this turn's events, the surfaced
 *  rejections, and the non-blocking save signal. */
export interface TurnResult {
	state: GameState;
	events: GameEvent[];
	rejections: GameEvent[];
	saveOk: boolean;
	/** The accepted envelope's narrative prose (the bridge appends it to game.log).
	 *  An aborted turn never reaches a resolution, so a resolved TurnResult always
	 *  carries the accepted envelope's narrative. */
	narrative: string;
}

/**
 * `runTurn(deps, state, priorEvents, order, campaignId, turn)` — drive ONE turn through
 * the §6.1 pipeline from injected deps. Returns a TurnResult; the only path that REJECTS
 * the returned Promise is `narrator.cancel()` (it rejects the awaited `narrator.run`),
 * never a bad paste (recoverable, leaves the run pending) and never a failed save.
 *
 * Pure orchestration: reads the POJO `state`/`priorEvents` (the caller already snapshotted
 * them), mutates neither, and routes all entropy through `deps.roller`.
 */
export async function runTurn(
	deps: TurnDeps,
	state: GameState,
	priorEvents: GameEvent[],
	order: PlayerOrder,
	campaignId: string,
	turn: number
): Promise<TurnResult> {
	// Phase 6 (DEPTH-02): size the turn from code-known stakes. `sizeTurn` picks the firing
	// rule modules + the detail tier + a BOUNDED state slice (never the whole campaign log —
	// no narrativeLog/graveyard); `selectModules` yields the concatenated rule-module text.
	// The prompt now ships the sized slice + sized rules instead of whole-state + an inline literal.
	const sized = sizeTurn(state, order);
	const { text: rulesText } = selectModules(state, order);
	const payload: TurnPayload = {
		state: sized.stateSlice as GameState,
		rules: rulesText,
		order,
		detail: sized.detail
	};

	// The prompt → run → validate → confirm block runs INSIDE a loop so a decline at the
	// confirm gate (Adjust) RE-ENTERS through the SAME onPrompt + narrator.run path a fresh
	// turn takes — the bridge's machine returns to awaitingPaste identically, never via a
	// synchronous assignment a later #applyResult could clobber (CR-02 / Design A). The loop
	// exits ONLY on accept (break to resolution) or a cancel() rejection (propagated by the
	// awaited run). An aborted iteration runs NO resolveTurn/fold/save — nothing is logged
	// or saved on it, and #applyResult does not fire (the declined run Promise stays pending
	// while the loop arms a fresh one).
	let env: MoveEnvelope;
	let rejections: GameEvent[];
	let accepted: ResolvedActionProposal[];
	for (;;) {
		// 1. Surface the copyable prompt to the UI. buildPrompt is PURE/idempotent, and
		//    ClipboardNarrator.run() rebuilds it internally from the same builder — an
		//    intentional, byte-identical double-build (the onPrompt seam keeps the prompt
		//    testable without threading the narrator's internal copy).
		deps.onPrompt(buildPrompt(payload));

		// 2. DEFERRED: this awaits until the UI settles the narrator via submitPaste (a bad
		//    paste keeps it pending) — or rejects it via cancel() (the only abort path).
		env = await deps.narrator.run(payload);

		// 3. The categorical gate: partition the untrusted envelope into accepted proposals
		//    and surfaced rejections (validate is the SINGLE gate; resolve re-validates nothing).
		const partition = validate(state, env, priorEvents, turn);
		rejections = partition.rejections;
		accepted = partition.accepted;

		// 4. The confirm-before-commit gate (ON by default, player-disableable upstream). The
		//    rows project every expend + casualty for human approval BEFORE any ledger touch.
		//    Accept → break to resolution. Decline (Adjust) → re-arm the narrator's deferred
		//    Promise (resetForRepaste clears the in-flight guard WITHOUT settling the outer
		//    Promise — cancel() stays the only reject path) and CONTINUE the loop, re-firing
		//    onPrompt + run so the bridge returns to awaitingPaste through the same callback.
		const rows: ConfirmRow[] = confirmDiff(env);
		if (await deps.awaitConfirm(rows)) break;
		deps.narrator.resetForRepaste?.();
	}

	// 5. Adjudicate the accepted proposals into this turn's GameEvent[] — entropy enters
	//    ONLY here, via the injected roller (default real Web Crypto roll).
	const accepts: ResolvedActionProposal[] = accepted;
	const events = resolveTurn(state, accepts, env.reveals, turn, deps.roller);

	// 5b. Phase 6 Slice A (Option B — LOCKED): append the AI's prose as a STORED, display-only
	//     `narrative` GameEvent AFTER resolveTurn so the canonical events_5_4 order stays stable
	//     and resolveTurn's signature is untouched. It folds into state.narrativeLog (ZERO ledger
	//     authority — the prose persists via save and survives reload). Skip an empty narrative.
	if (env.narrative) events.push({ kind: 'narrative', text: env.narrative, turn });

	// 6. The ONE mutation path: state-after is the fold of this turn's events onto state.
	const next = fold(state, events);

	// 7. Autosave — a failed write is a RETURNED signal (saveOk:false), never a throw that
	//    would discard the resolved turn the player just watched.
	const save = await deps.saveStore.save(campaignId, turn, events, next);

	return { state: next, events, rejections, saveOk: save.ok, narrative: env.narrative };
}
