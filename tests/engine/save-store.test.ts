// save-store.test.ts — the RED end-to-end persistence suite (the GREEN target for
// Plans 02 + 03). It locks the whole Phase-4 requirement + decision set against the
// §5.4 golden fixture:
//   SAVE-01  — IdbSaveStore satisfies the 5-method SaveStore interface (D-02 real list)
//   SAVE-02  — autosave appends events incrementally; snapshot on cadence N  (D-03)
//   SAVE-03  — round-trip identity: load() folds to the canonical §5.4 state-after
//   SAVE-04  — export → import creates a NEW campaign (D-04), name-collision suffixed
//   SAVE-05  — navigator.storage.persist() requested once; a false return is non-fatal
//   D-05     — schemaVersion gate: == accepted, < migrated, > recoverable {ok:false}
//   D-06     — a quota write failure is a non-blocking {ok:false,reason:'quota'} signal
//   CORE-06  — same-turn events reload in append (seq) order, not by turn, so fold is deterministic
//
// RED CONDITION: this file imports `IdbSaveStore` from `../../src/lib/idb-save-store`,
// the NON-engine implementation that lands in Plans 02/03. Until then the suite fails
// for "Cannot find module ../../src/lib/idb-save-store" — NOT a fixture/syntax error.
// The pre-existing 129-test engine suite + §5.4 golden stay GREEN; only this file is red.
//
// PURITY: imports engine modules + the shared §5.4 fixture + the (future) non-engine
// store; runs headlessly under fake-indexeddb (registered by tests/engine/setup/fake-idb.ts).

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fold } from '../../src/lib/engine/state';
import type { GameState } from '../../src/lib/engine/state';
import { SNAPSHOT_CADENCE_N } from '../../src/lib/engine/save';
import type { SaveEnvelope } from '../../src/lib/engine/save';
import {
	validateSaveEnvelope,
	SaveEnvelopeSchema,
	CURRENT_SCHEMA_VERSION,
	loadGameState
} from '../../src/lib/engine';
import type { CampaignRow, GameSource, PersistedGame } from '../../src/lib/engine';
// The NON-engine idb-backed implementation — lands in Plans 02/03. This import is
// what makes the suite RED today (Cannot find module). It implements SaveStore.
import { IdbSaveStore } from '../../src/lib/idb-save-store';
import {
	stateBefore_5_4,
	events_5_4,
	priorEvents_5_4,
	stateAfter_5_4
} from './fixtures/worked-example-5.4';

const unitById = (s: GameState, id: string) =>
	s.sides.flatMap((side) => side.units).find((u) => u.id === id);

// A fresh store per test (unique db name so fake-indexeddb cases are isolated). The
// concrete construction signature is the impl's to finalize (Plans 02/03); the tests
// only depend on the SaveStore CONTRACT — five Promise methods.
let store: IdbSaveStore;
let dbName: string;
let seq = 0;

beforeEach(() => {
	dbName = `frosty-test-${Date.now()}-${seq++}`;
	store = new IdbSaveStore(dbName);
});

// ── SAVE-01 / D-02: the interface is satisfied by a REAL store, not a stub ──────
describe('SAVE-01 — IdbSaveStore satisfies the SaveStore interface', () => {
	test('the five methods exist and return Promises; list() returns an array (D-02)', async () => {
		expect(typeof store.save).toBe('function');
		expect(typeof store.load).toBe('function');
		expect(typeof store.list).toBe('function');
		expect(typeof store.export).toBe('function');
		expect(typeof store.import).toBe('function');

		// list() on a fresh store is a real (empty) array, not a stubbed value.
		const rowsPromise = store.list();
		expect(rowsPromise).toBeInstanceOf(Promise);
		const rows = await rowsPromise;
		expect(Array.isArray(rows)).toBe(true);
		expect(rows).toHaveLength(0);
	});
});

// ── SAVE-02 / D-03: autosave appends; snapshot only on cadence N ────────────────
describe('SAVE-02 — autosave appends incrementally; snapshot on cadence N (D-03)', () => {
	test('events accrete each turn; a snapshot row exists only at turn % N === 0', async () => {
		const id = 'campaign-cadence';
		let state = stateBefore_5_4();

		// Save turns 1..N. Each turn appends one (synthetic) event; the store snapshots
		// only when turn % SNAPSHOT_CADENCE_N === 0 (do NOT hardcode 10 — import the const).
		for (let turn = 1; turn <= SNAPSHOT_CADENCE_N; turn++) {
			const newEvents = [
				{ kind: 'clock' as const, from: 'x', to: `t${turn}`, turn }
			];
			state = fold(state, newEvents);
			const res = await store.save(id, turn, newEvents, state);
			expect(res.ok).toBe(true);
		}

		// The store exposes its snapshot rows for the cadence assertion (impl detail
		// finalized in Plan 02; the contract is: a snapshot exists at turn N, not before).
		const snapTurns = await store.snapshotTurns(id);
		expect(snapTurns).toContain(SNAPSHOT_CADENCE_N);
		expect(snapTurns).not.toContain(SNAPSHOT_CADENCE_N - 1);
		expect(snapTurns).not.toContain(1);

		// All N turns' events accreted (incremental append, not overwrite).
		const events = await store.events(id);
		expect(events).toHaveLength(SNAPSHOT_CADENCE_N);
	});
});

// ── SAVE-03: round-trip identity against the §5.4 categorical state-after ───────
describe('SAVE-03 — round-trip: load() folds to stateAfter_5_4', () => {
	test('save base + append §5.4 events, then load deep-equals the canonical state-after', async () => {
		const id = 'campaign-5-4';
		const base = stateBefore_5_4();

		// Persist the base snapshot, then append the 11 turn-4 events as one autosave.
		await store.save(id, 3, priorEvents_5_4, fold(base, priorEvents_5_4));
		const afterEvents = fold(fold(base, priorEvents_5_4), events_5_4);
		await store.save(id, 4, events_5_4, afterEvents);

		const loaded = await store.load(id);
		expect(loaded).not.toBeNull();
		if (!loaded) return;

		// Categorical state matches the §5.4 state-after (mirror round-trip.test.ts).
		expect(loaded.meta.turn).toBe(stateAfter_5_4.meta.turn);
		expect(loaded.meta.clock).toBe(stateAfter_5_4.meta.clock);
		expect(loaded.meta.phase).toBe(stateAfter_5_4.meta.phase);
		expect(unitById(loaded, '1-1')!.strength).toBe(stateAfter_5_4.units['1-1'].strength);
		expect(unitById(loaded, '1-1')!.posture).toBe(stateAfter_5_4.units['1-1'].posture);
		expect(unitById(loaded, 'MTR')!.strength).toBe(stateAfter_5_4.units.MTR.strength);
		expect(unitById(loaded, 'DEF')!.strength).toBe(stateAfter_5_4.units.DEF.strength);
		expect(unitById(loaded, 'DEF')!.morale).toBe(stateAfter_5_4.units.DEF.morale);
		expect(unitById(loaded, 'DEF')!.posture).toBe(stateAfter_5_4.units.DEF.posture);

		// The graveyard (DEF overrun would be a destroyed event in a full stream) and
		// derived state come straight from fold — load must not reimplement replay.
		const expected = fold(fold(stateBefore_5_4(), priorEvents_5_4), events_5_4);
		expect(loaded).toEqual(expected);
	});
});

// ── CORE-06: same-turn events reload by seq, not turn (deterministic fold) ──────
describe('CORE-06 — same-turn events reload in append (seq) order', () => {
	test('the 11 turn:4 §5.4 events reload in append order so fold is deterministic', async () => {
		const id = 'campaign-order';
		const base = fold(stateBefore_5_4(), priorEvents_5_4);
		await store.save(id, 4, events_5_4, fold(base, events_5_4));

		const reloaded = await store.events(id);
		// All 11 share turn:4 — only a monotonic seq can give a total order. Append order
		// must be preserved exactly (a turn-keyed sort would scramble it).
		expect(reloaded).toEqual(events_5_4);
		// Re-folding the reloaded stream equals folding the original (determinism).
		expect(fold(base, reloaded)).toEqual(fold(base, events_5_4));
	});
});

// ── SAVE-04 / D-04: export → import creates a NEW campaign, name-collision suffixed
describe('SAVE-04 — export/import round-trip creates a NEW campaign (D-04)', () => {
	test('import produces a new id, folds to the SAME state, and suffixes a name collision', async () => {
		const id = 'campaign-export';
		const base = stateBefore_5_4();
		await store.save(id, 3, priorEvents_5_4, fold(base, priorEvents_5_4));
		await store.save(id, 4, events_5_4, fold(fold(base, priorEvents_5_4), events_5_4));

		// export() builds the .frosty.json bytes the impl exposes for the round-trip.
		const envelopeJson = await store.exportToString(id);
		const file = new File([envelopeJson], 'campaign.frosty.json', { type: 'application/json' });

		const before = await store.list();
		const result = await store.import(file);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const newId = result.value;
		expect(newId).not.toBe(id); // D-04: NEVER overwrite — a fresh campaign id.

		const after = await store.list();
		expect(after.length).toBe(before.length + 1);

		// The imported campaign folds to the SAME categorical state as the source.
		const sourceState = await store.load(id);
		const importedState = await store.load(newId);
		expect(importedState).toEqual(sourceState);

		// A name collision (same campaignName) is suffixed, not silently merged.
		const collision = await store.import(file);
		expect(collision.ok).toBe(true);
		if (!collision.ok) return;
		const rows = await store.list();
		const names = rows.map((r: CampaignRow) => r.name);
		// At least one imported row carries a disambiguating suffix.
		expect(new Set(names).size).toBe(names.length);
	});
});

// ── D-05 / V5: schemaVersion gate (== accepted, < migrate, > recoverable) ──────
describe('D-05 — schemaVersion gate + shape validation (V5)', () => {
	function wellFormed(over: Partial<SaveEnvelope> = {}): SaveEnvelope {
		const base = stateBefore_5_4();
		return {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			campaignName: 'gate-test',
			snapshots: [{ turn: 3, state: base }],
			events: [...priorEvents_5_4],
			...over
		};
	}

	test('an equal-version save validates (D-05 accept path)', () => {
		const res = validateSaveEnvelope(wellFormed());
		expect(res.ok).toBe(true);
	});

	test('an older-version save still shape-validates (migrate is downstream, Plan 03)', () => {
		const res = validateSaveEnvelope(wellFormed({ schemaVersion: 0 }));
		expect(res.ok).toBe(true);
	});

	test('a newer-version save imported through the store is a recoverable {ok:false}', async () => {
		const future = wellFormed({ schemaVersion: CURRENT_SCHEMA_VERSION + 99 });
		const file = new File([JSON.stringify(future)], 'future.frosty.json', {
			type: 'application/json'
		});
		const res = await store.import(file);
		expect(res.ok).toBe(false); // a save from a newer build cannot be loaded — recoverable, not a throw.
	});

	test('an extra top-level key fails validateSaveEnvelope (strictObject, T-04-02)', () => {
		const tampered = { ...wellFormed(), hacked: true };
		const res = validateSaveEnvelope(tampered);
		expect(res.ok).toBe(false);
	});

	test('a missing schemaVersion fails validateSaveEnvelope (T-04-03)', () => {
		const { schemaVersion: _drop, ...noVersion } = wellFormed();
		void _drop;
		const res = validateSaveEnvelope(noVersion);
		expect(res.ok).toBe(false);
	});

	test('a non-object / garbage value fails validateSaveEnvelope without throwing (T-04-01)', () => {
		expect(validateSaveEnvelope(null).ok).toBe(false);
		expect(validateSaveEnvelope('not an object').ok).toBe(false);
		expect(validateSaveEnvelope(42).ok).toBe(false);
		// SaveEnvelopeSchema is the allow-list these route through.
		expect(SaveEnvelopeSchema).toBeDefined();
	});
});

// ── CR-01: save-import rejects forged ledger numerics (authority rule) ─────────
//
// THE authority-rule boundary anchor (08-REVIEW CR-01 BLOCKER, confirmed live in
// 08-HUMAN-UAT item 2). `SaveEnvelopeSchema` is the security control at the SECOND
// untrusted boundary (an uploaded `.frosty.json`). It must enforce the ledger-authority
// numeric invariants the project treats as hard: a consumable count can ONLY decrease
// via an `expend` (CLAUDE.md authority rule), so `remaining()` (ledger.ts:
// `loadout − Σqty + Σ(to−from)`) must be unable to be RAISED at the import boundary.
//
// A hand-edited save with `expend qty:-5` RAISES a consumable (UAT proved
// `remaining(frag) → 11` vs loadout 6) — an unlogged mint. This block forges those
// numerics and proves the import boundary now REJECTS them before `fold` runs.
//
// RED until 08-04 Task 2 hardens the five ledger-bearing numeric sites in save-schema.ts
// (expend.qty, resupply.from/to, ExpendEntry/ResupplyEntry, loadout) — until then the
// import SUCCEEDS on `expend qty:-5` and these cases fail.
describe('CR-01 — save-import rejects forged ledger numerics (authority rule)', () => {
	// MIRROR the D-05 block's `wellFormed` helper so the forged cases are spread-overrides
	// of a known-valid §5.4 envelope (only the forged value differs, never the rest).
	function wellFormed(over: Partial<SaveEnvelope> = {}): SaveEnvelope {
		const base = stateBefore_5_4();
		return {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			campaignName: 'cr01-test',
			snapshots: [{ turn: 3, state: base }],
			events: [...priorEvents_5_4],
			...over
		};
	}

	// THE END-TO-END ANCHOR: a forged `expend qty:-5` crossing the REAL store.import()
	// must return {ok:false} and materialize NO campaign (the live UAT breach closed).
	test('store.import() of a forged expend qty:-5 envelope is rejected; no campaign materialized', async () => {
		const id = 'campaign-cr01-import';
		const base = stateBefore_5_4();
		// Persist a real campaign carrying the prior turn-2 frag expend, then export it.
		await store.save(id, 3, priorEvents_5_4, fold(base, priorEvents_5_4));
		const envelopeJson = await store.exportToString(id);

		// Tamper: set the first `expend` event's qty to -5 (the UAT breach value).
		const parsed = JSON.parse(envelopeJson) as SaveEnvelope;
		const firstExpend = parsed.events.find((e) => e.kind === 'expend');
		expect(firstExpend).toBeDefined(); // the §5.4 history carries a turn-2 frag expend
		if (firstExpend && firstExpend.kind === 'expend') firstExpend.qty = -5; // expend qty:-5
		const file = new File([JSON.stringify(parsed)], 'tampered.frosty.json', {
			type: 'application/json'
		});

		const before = (await store.list()).length;
		const result = await store.import(file);

		// REJECTED at the shape gate — a forged numeric never reaches fold/remaining().
		expect(result.ok).toBe(false);

		// No campaign materialized — list() did not grow.
		const after = (await store.list()).length;
		expect(after).toBe(before);
	});

	// Unit: validateSaveEnvelope rejects a negative expend.qty (the same -5 breach, direct).
	test('validateSaveEnvelope rejects a negative expend.qty (event variant)', () => {
		const env = wellFormed();
		const events = env.events.map((e) =>
			e.kind === 'expend' ? { ...e, qty: -5 } : e
		);
		const res = validateSaveEnvelope({ ...env, events });
		expect(res.ok).toBe(false);
	});

	// Unit: a fractional expend.qty is malformed shape (a real expend is an integer decrement).
	test('validateSaveEnvelope rejects a fractional / zero expend.qty', () => {
		const env = wellFormed();
		const fractional = env.events.map((e) =>
			e.kind === 'expend' ? { ...e, qty: 1.5 } : e
		);
		expect(validateSaveEnvelope({ ...env, events: fractional }).ok).toBe(false);
		const zero = env.events.map((e) => (e.kind === 'expend' ? { ...e, qty: 0 } : e));
		expect(validateSaveEnvelope({ ...env, events: zero }).ok).toBe(false);
	});

	// Unit: a resupply with to < from is a negative raise = an unlogged decrement disguised.
	test('validateSaveEnvelope rejects a resupply with to < from', () => {
		const env = wellFormed();
		const events = [
			...env.events,
			{
				kind: 'resupply' as const,
				side: 'BLUE',
				item: 'frag',
				from: 5,
				to: 0,
				source: 'forged',
				turn: 3
			}
		];
		const res = validateSaveEnvelope({ ...env, events });
		expect(res.ok).toBe(false);
	});

	// Unit: a negative resupply.from/to is malformed shape (counts are non-negative).
	test('validateSaveEnvelope rejects a negative resupply from/to value', () => {
		const env = wellFormed();
		const events = [
			...env.events,
			{
				kind: 'resupply' as const,
				side: 'BLUE',
				item: 'frag',
				from: -1,
				to: 3,
				source: 'forged',
				turn: 3
			}
		];
		expect(validateSaveEnvelope({ ...env, events }).ok).toBe(false);
	});

	// Unit: a negative loadout value is the asymmetry CR-01 flagged (bands are tightly
	// enforced; loadout was bare v.number()).
	test('validateSaveEnvelope rejects a negative loadout value', () => {
		const env = wellFormed();
		const tampered = structuredClone(env);
		// Forge the first side's loadout to carry a negative count.
		const firstItem = Object.keys(tampered.snapshots[0].state.sides[0].consumables.loadout)[0];
		tampered.snapshots[0].state.sides[0].consumables.loadout[firstItem] = -1;
		expect(validateSaveEnvelope(tampered).ok).toBe(false);
	});

	// Unit: a forged ExpendEntry (materialized snapshot view) negative qty is rejected too —
	// closing the second avenue to the same breach.
	test('validateSaveEnvelope rejects a negative qty in the materialized ExpendEntry view', () => {
		const env = wellFormed();
		const tampered = structuredClone(env);
		const expended = tampered.snapshots[0].state.sides[0].consumables.expended;
		// The §5.4 BLUE side carries a turn-2 frag ExpendEntry; forge its qty negative.
		expect(expended.length).toBeGreaterThanOrEqual(1);
		expended[0].qty = -5;
		expect(validateSaveEnvelope(tampered).ok).toBe(false);
	});

	// GREEN-MUST-STAY guard: the clean §5.4 baseline still validates ok — the new
	// constraints reject ONLY forged values, never legitimate positive-integer ones.
	test('a clean §5.4 envelope still validates ok (constraints reject only forged values)', () => {
		expect(validateSaveEnvelope(wellFormed()).ok).toBe(true);
	});
});

// ── SAVE-05: storage.persist requested once; false is non-fatal ────────────────
describe('SAVE-05 — navigator.storage.persist requested once, false is non-fatal', () => {
	test('persist() is called once at campaign start and a false return does not throw or block', async () => {
		const persistSpy = vi.fn().mockResolvedValue(false);
		// @ts-expect-error — fake-indexeddb has no navigator.storage; inject a stub.
		globalThis.navigator = { storage: { persist: persistSpy } };

		const id = 'campaign-persist';
		const state = stateBefore_5_4();
		// A false persist() result must NOT throw or block the save.
		const res = await store.save(id, 1, [{ kind: 'clock', from: 'x', to: 'y', turn: 1 }], state);
		expect(res.ok).toBe(true);
		expect(persistSpy).toHaveBeenCalledTimes(1);

		// A second save in the same campaign does NOT re-request persistence.
		await store.save(id, 2, [{ kind: 'clock', from: 'y', to: 'z', turn: 2 }], state);
		expect(persistSpy).toHaveBeenCalledTimes(1);
	});
});

// ── UI-07 / D-03: undo last turn — tail-delete + fold-forward replay-equality ──
//
// THE Phase-7 highest-risk anchor (CONTEXT D-03, RESEARCH Pattern 5 + Pitfall 1).
// `undoLastTurn(campaignId, currentTurn)` drops every event row of the dropped turn
// (the TAIL, never a middle splice), deletes any snapshot row AT that turn (the cadence
// case), decrements the campaign row's currentTurn, then returns the UNCHANGED
// `load()` fold-forward. Replay-equality: the undone state MUST `toEqual`
// `fold(stateBefore_5_4(), priorEvents_5_4)` — the historical pre-turn-4 state.
//
// RED until `IdbSaveStore.undoLastTurn` exists (and the `SaveStore` interface declares
// it) — fails for "store.undoLastTurn is not a function". The historical/dropped split
// is the §5.4 fixture's `priorEvents_5_4` (turn-2, historical) vs `events_5_4` (turn-4,
// dropped); the grep-anchor `priorEvents_5_4` wires the contract.
describe('UI-07 — undoLastTurn drops the tail turn and folds back to the historical state (D-03)', () => {
	test('the REPLAY-EQUALITY ANCHOR: undo turn 4, reload, toEqual fold(stateBefore, priorEvents)', async () => {
		const id = 'campaign-undo-anchor';
		const base = stateBefore_5_4();

		// The historical pre-turn-4 state IS fold(stateBefore_5_4(), priorEvents_5_4) — the
		// turn-2 frag expend folded, nothing of turn 4 applied. This is the toEqual target.
		const historical = fold(base, priorEvents_5_4);

		// Persist: a base snapshot carrying the prior (turn-2) history, then the full turn-4
		// autosave (all `events_5_4`, every event turn:4 — the tail that undo drops).
		await store.save(id, 3, priorEvents_5_4, historical);
		const afterTurn4 = fold(historical, events_5_4);
		await store.save(id, 4, events_5_4, afterTurn4);

		// Pre-undo sanity: load() folds forward to the turn-4 state (NOT the historical one).
		const before = await store.load(id);
		expect(before).not.toBeNull();
		expect(before).toEqual(afterTurn4);
		expect(before).not.toEqual(historical);

		// Drop turn 4 — tail-delete every turn:4 row + decrement currentTurn, then reload.
		const undone = await store.undoLastTurn(id, 4);

		// REPLAY-EQUALITY: the undone state equals the historical pre-turn-4 state EXACTLY.
		expect(undone).not.toBeNull();
		expect(undone).toEqual(historical);
		expect(undone).toEqual(fold(stateBefore_5_4(), priorEvents_5_4));

		// And a fresh load() (no in-memory state) folds to the SAME historical state — the
		// deletion is persisted, not just returned (the idb rows for turn 4 are gone).
		const reloaded = await store.load(id);
		expect(reloaded).toEqual(historical);

		// The surviving events are exactly the prior (turn < 4) history — no turn-4 row left.
		const survivingEvents = await store.events(id);
		expect(survivingEvents.every((e) => e.turn < 4)).toBe(true);
		expect(survivingEvents).toEqual(priorEvents_5_4);
	});

	test('THE CADENCE TRAP (Pitfall 1): undo restores history at BOTH a non-cadence turn (4) AND a cadence-boundary turn', async () => {
		// Pitfall 1: a naive undo that loads "the snapshot at currentTurn-1" passes at a
		// cadence-aligned turn but FAILS at a non-cadence turn (no snapshot there). This case
		// proves undo restores the EXACT historical state at a cadence boundary too — driving
		// the campaign forward across the snapshot cadence so the dropped turn IS a cadence
		// turn (turn % SNAPSHOT_CADENCE_N === 0), which writes a snapshot row that undo must
		// delete or load() would fold the dropped turn back in.
		const id = 'campaign-undo-cadence';
		let state = stateBefore_5_4();

		// Drive turns 1 .. cadenceTurn. Each turn appends one synthetic clock event; the store
		// snapshots on cadence. Capture the historical state at exactly (cadenceTurn - 1).
		const cadenceTurn = SNAPSHOT_CADENCE_N; // e.g. 10 — a cadence boundary
		let historicalBeforeCadence: GameState | null = null;
		for (let turn = 1; turn <= cadenceTurn; turn++) {
			if (turn === cadenceTurn) historicalBeforeCadence = state; // pre-cadence-turn state
			const ev = [{ kind: 'clock' as const, from: `t${turn - 1}`, to: `t${turn}`, turn }];
			state = fold(state, ev);
			const res = await store.save(id, turn, ev, state);
			expect(res.ok).toBe(true);
		}
		expect(historicalBeforeCadence).not.toBeNull();

		// A snapshot row exists AT the cadence turn (the row undo must delete).
		const snapsBefore = await store.snapshotTurns(id);
		expect(snapsBefore).toContain(cadenceTurn);

		// Undo the cadence turn: drop its events + its snapshot row, fold back to history.
		const undone = await store.undoLastTurn(id, cadenceTurn);
		expect(undone).toEqual(historicalBeforeCadence);

		// The dropped turn's snapshot row is gone (else load() would fold the turn back in).
		const snapsAfter = await store.snapshotTurns(id);
		expect(snapsAfter).not.toContain(cadenceTurn);

		// A fresh load() folds to the SAME historical state — proving the cadence snapshot
		// was deleted AND no turn-N event survives (the non-cadence/cadence symmetry holds).
		const reloaded = await store.load(id);
		expect(reloaded).toEqual(historicalBeforeCadence);
		const surviving = await store.events(id);
		expect(surviving.every((e) => e.turn < cadenceTurn)).toBe(true);
	});

	test('undo is single-level + tail-only: it drops the LAST turn, never a middle splice', async () => {
		// Two turns of history (turns 4 and 5). Undoing turn 5 must leave turn 4 intact —
		// the tail is the only thing dropped; no middle row is touched.
		const id = 'campaign-undo-tail';
		const historical = fold(stateBefore_5_4(), priorEvents_5_4);
		await store.save(id, 3, priorEvents_5_4, historical);

		const afterTurn4 = fold(historical, events_5_4);
		await store.save(id, 4, events_5_4, afterTurn4);

		const turn5Events = [{ kind: 'clock' as const, from: 'D1 0720', to: 'D1 0740', turn: 5 }];
		const afterTurn5 = fold(afterTurn4, turn5Events);
		await store.save(id, 5, turn5Events, afterTurn5);

		// Drop only turn 5 — turn 4 must survive (load folds back to the post-turn-4 state).
		const undone = await store.undoLastTurn(id, 5);
		expect(undone).toEqual(afterTurn4);
		expect(undone).not.toEqual(historical); // turn 4 was NOT spliced out

		const surviving = await store.events(id);
		// Every surviving row is turn <= 4 (turn 5's tail gone, the turn-4 middle untouched).
		expect(surviving.every((e) => e.turn <= 4)).toBe(true);
		expect(surviving.some((e) => e.turn === 4)).toBe(true);
		expect(surviving.some((e) => e.turn === 5)).toBe(false);
	});
});

// ── D-06: quota write failure is a non-blocking signal ─────────────────────────
describe('D-06 — quota write failure is a non-blocking {ok:false,reason:quota} signal', () => {
	test('a QuotaExceededError on write returns {ok:false,reason:quota}, does not throw, prior state intact', async () => {
		const id = 'campaign-quota';
		const base = stateBefore_5_4();
		// Persist one good turn first so we can prove it survives the failed write.
		await store.save(id, 1, [{ kind: 'clock', from: 'x', to: 't1', turn: 1 }], base);
		const before = await store.load(id);

		// Force the next write to fail with a quota error (impl exposes a fault hook;
		// the contract is: a quota DOMException becomes a returned signal, never a throw).
		store.__failNextWriteWith(new DOMException('quota', 'QuotaExceededError'));

		let threw = false;
		let res: { ok: true } | { ok: false; reason: 'quota' | 'io'; detail?: string };
		try {
			res = await store.save(id, 2, [{ kind: 'clock', from: 't1', to: 't2', turn: 2 }], base);
		} catch {
			threw = true;
			res = { ok: false, reason: 'io' };
		}
		expect(threw).toBe(false); // D-06: never throw-and-lose.
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.reason).toBe('quota');

		// The prior persisted state is intact — the failed write did not corrupt it.
		const after = await store.load(id);
		expect(after).toEqual(before);
	});
});

// ── LOAD-02 / LOAD-01: inverted loadEnvelope returns an UNFOLDED PersistedGame ──
//
// Plan 08-02 inverts the store so `loadEnvelope(id)` returns an UNFOLDED
// `PersistedGame` envelope (snapshots + events + the stored schemaVersion) instead of
// a folded `GameState`. The migrate + fold move UP into `loadGameState` (Plan 08-01) —
// the store only reads rows and assembles the envelope, carrying the campaign row's
// `schemaVersion` so the migrate gate on local resume has something to gate on
// (LOAD-02 — the migration-on-resume disk fix). The thin folded `load()` wrapper stays
// so the locked SAVE suite + undoLastTurn + exportToString keep working.
//
// RED until Task 2: `store.loadEnvelope` is not yet a function.
describe('LOAD-02 — inverted loadEnvelope returns an unfolded PersistedGame envelope', () => {
	test('loadEnvelope returns a PersistedGame (snapshots + events + schemaVersion), NOT a folded GameState', async () => {
		const id = 'campaign-envelope';
		const base = stateBefore_5_4();
		await store.save(id, 3, priorEvents_5_4, fold(base, priorEvents_5_4));

		const env = await store.loadEnvelope(id);
		expect(env).not.toBeNull();
		if (!env) return;

		// It is an UNFOLDED envelope, not a folded GameState.
		expect('snapshots' in env).toBe(true);
		expect('schemaVersion' in env).toBe(true);
		expect('events' in env).toBe(true);
		expect('sides' in env).toBe(false); // a GameState would have `sides`; the envelope does not.

		expect(Array.isArray(env.snapshots)).toBe(true);
		expect(env.snapshots.length).toBeGreaterThanOrEqual(1);
		expect(Array.isArray(env.events)).toBe(true);
	});

	test('the envelope carries the stored campaignRow.schemaVersion (LOAD-02 carry mechanism)', async () => {
		// save() stamps CURRENT_SCHEMA_VERSION; loadEnvelope must carry exactly that stored
		// value into the envelope so loadGameState's migrate gate fires on resume. The
		// `< CURRENT` resume-migration assertion itself lives in the Plan 08-03 component
		// test; the CARRY (the field is present and equals the stored row value) is proven here.
		const id = 'campaign-version-carry';
		const base = stateBefore_5_4();
		await store.save(id, 3, priorEvents_5_4, fold(base, priorEvents_5_4));

		const env = await store.loadEnvelope(id);
		expect(env).not.toBeNull();
		if (!env) return;
		expect(env.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});

	test('loadEnvelope folds via loadGameState to the SAME state the folded load() returns (LOAD-01)', async () => {
		const id = 'campaign-envelope-equiv';
		const base = stateBefore_5_4();
		await store.save(id, 3, priorEvents_5_4, fold(base, priorEvents_5_4));
		const afterEvents = fold(fold(base, priorEvents_5_4), events_5_4);
		await store.save(id, 4, events_5_4, afterEvents);

		const env = await store.loadEnvelope(id);
		expect(env).not.toBeNull();
		if (!env) return;

		const result = loadGameState(env);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		// The inversion preserves load semantics: loadGameState(envelope).state deep-equals
		// the folded load() the store used to return internally.
		const foldedLoad = await store.load(id);
		expect(result.state).toEqual(foldedLoad);
		expect(result.state).toEqual(afterEvents);
	});

	test('loadEnvelope returns null when the campaign / its base does not exist', async () => {
		const env = await store.loadEnvelope('no-such-campaign');
		expect(env).toBeNull();
	});

	test('IdbSaveStore exposes the GameSource read shape via a source adapter (type-level + catalog projection)', async () => {
		// The class keeps a folded `load(): GameState` for the locked SAVE suite, so the
		// GameSource (envelope-returning `load`) is exposed through a `source()` adapter —
		// the type-level assertion `const src: GameSource = store.source()` must compile.
		const src: GameSource = store.source();
		expect(typeof src.list).toBe('function');
		expect(typeof src.load).toBe('function');

		// A real campaign so the catalog projection has a row.
		const id = 'campaign-catalog';
		const base = stateBefore_5_4();
		await store.save(id, 3, priorEvents_5_4, fold(base, priorEvents_5_4));

		// GameSource.load returns an UNFOLDED PersistedGame (not a folded GameState).
		const persisted: PersistedGame | null = await src.load(id);
		expect(persisted).not.toBeNull();
		if (persisted) {
			expect('snapshots' in persisted).toBe(true);
			expect('schemaVersion' in persisted).toBe(true);
		}

		// The catalog projection: list() → CatalogEntry-shaped rows ({ id, name, currentTurn }).
		const catalog = await src.list();
		expect(Array.isArray(catalog)).toBe(true);
		const row = catalog.find((c) => c.id === id);
		expect(row).toBeDefined();
		if (row) {
			expect(typeof row.id).toBe('string');
			expect(typeof row.name).toBe('string');
			expect(typeof row.currentTurn).toBe('number');
		}
	});
});
