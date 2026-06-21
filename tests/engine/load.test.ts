// load.test.ts — the RED suite locking the unified validated load path (LOAD-01/02/03/05).
//
// `loadGameState(persisted)` is the ONE entry point every source (resumed save, scenario,
// canary) crosses: validate → migrate → fold → a discriminated `LoadResult`. This suite
// has one test per `LoadResult` branch plus the §5.4 canary fold-through:
//   - ok turn-0   — a clean turn-0 envelope folds to its turn-0 state (LOAD-01 / LOAD-05)
//   - ok turn-N   — a snapshot@K + events folds to fold(snapshot.state, events) (LOAD-01)
//   - newer-version — schemaVersion > CURRENT is a recoverable reject, never a throw (LOAD-03)
//   - shape-invalid — a bad / version-less shape is a recoverable reject, never a throw
//   - shape-invalid — snapshots:[] (no base) is rejected (Open Question 2 phantom-state guard)
//   - §5.4 canary  — canary5_4Persisted() folds through loadGameState to frag→2, smoke→4
//
// RED CONDITION: it imports `loadGameState`/`LoadResult` from `../../src/lib/engine/load`,
// which lands in Task 3. Until then the suite fails for "Cannot find module
// ../../src/lib/engine/load" — NOT a fixture/syntax error. The pre-existing engine suite +
// the §5.4 golden stay green.
//
// PURITY: imports engine modules + the shared §5.4 / canary fixtures only. No Svelte / idb.

import { describe, test, expect } from 'vitest';
import { loadGameState } from '../../src/lib/engine/load';
import type { LoadResult } from '../../src/lib/engine/load';
import { fold } from '../../src/lib/engine/state';
import type { GameState } from '../../src/lib/engine/state';
import type { GameEvent } from '../../src/lib/engine/events';
import { remaining } from '../../src/lib/engine/ledger';
import { CURRENT_SCHEMA_VERSION } from '../../src/lib/engine/save-schema';
import type { SaveEnvelope } from '../../src/lib/engine/save';
import { stateBefore_5_4, remaining_after_5_4 } from './fixtures/worked-example-5.4';
import { canary5_4Persisted } from './fixtures/canary-5.4-persisted';

// A minimal, type-valid clean turn-0 GameState — empty board, empty ledger. Enough to
// satisfy validateSaveEnvelope's strictObject + fold's structural reads (LOAD-05 clean seed).
function cleanTurn0State(): GameState {
	return {
		meta: {
			campaignName: 'clean-turn-0',
			turn: 0,
			clock: 'D1 0600',
			weather: 'clear',
			terrain: 'open',
			phase: 'planning'
		},
		sides: [
			{
				id: 'BLUE',
				commander: 'player',
				objectives: [],
				manifest: {
					doctrine: 'combined-arms',
					echelon: 'platoon',
					organicAssets: ['small_arms'],
					supportingAssets: [],
					prohibited: []
				},
				consumables: { loadout: {}, expended: [], resupplied: [] },
				units: []
			}
		],
		intel: { knows: {}, unconfirmedReports: [] },
		graveyard: [],
		narrativeLog: []
	};
}

/** A clean turn-0 PersistedGame: snapshot@0 + events:[] (a scenario IS a save at turn 0). */
function cleanTurn0Envelope(): SaveEnvelope {
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		campaignName: 'clean-turn-0',
		snapshots: [{ turn: 0, state: cleanTurn0State() }],
		events: []
	};
}

describe('loadGameState — ok branches (LOAD-01 / LOAD-05)', () => {
	test('a clean turn-0 envelope folds to its turn-0 state with events:[]', () => {
		const result: LoadResult = loadGameState(cleanTurn0Envelope());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.state.meta.turn).toBe(0);
		expect(result.events).toEqual([]);
	});

	test('a turn-N envelope (snapshot@K + events) folds to fold(snapshot.state, events)', () => {
		// snapshot @ turn 3 (the §5.4 base), a couple of events after it.
		const base = stateBefore_5_4();
		const events: GameEvent[] = [
			{ kind: 'clock', from: 'D1 0700', to: 'D1 0720', turn: 4 },
			{ kind: 'phase', from: 'engagement', to: 'consolidation', turn: 4 }
		];
		const env: SaveEnvelope = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			campaignName: 'turn-n',
			snapshots: [{ turn: 3, state: stateBefore_5_4() }],
			events
		};
		const result = loadGameState(env);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.state).toEqual(fold(base, events));
		expect(result.events).toEqual(events);
	});
});

describe('loadGameState — recoverable reject branches (LOAD-03) — NEVER throws', () => {
	test('schemaVersion > CURRENT → { ok:false, reason:"newer-version" }, no throw', () => {
		const env = { ...cleanTurn0Envelope(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
		let result!: LoadResult;
		expect(() => {
			result = loadGameState(env);
		}).not.toThrow();
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('newer-version');
		expect(result.error.length).toBeGreaterThan(0);
	});

	test('a shape-invalid input (missing schemaVersion) → { ok:false, reason:"shape-invalid" }, no throw', () => {
		const bad = { campaignName: 'no-version', snapshots: [], events: [] };
		let result!: LoadResult;
		expect(() => {
			result = loadGameState(bad);
		}).not.toThrow();
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('shape-invalid');
		expect(result.error.length).toBeGreaterThan(0);
	});

	test('an empty object {} is shape-invalid, not a throw', () => {
		let result!: LoadResult;
		expect(() => {
			result = loadGameState({});
		}).not.toThrow();
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('shape-invalid');
	});

	test('snapshots:[] (no base to fold) → { ok:false, reason:"shape-invalid" } (phantom-state guard)', () => {
		const env = { ...cleanTurn0Envelope(), snapshots: [] };
		let result!: LoadResult;
		expect(() => {
			result = loadGameState(env);
		}).not.toThrow();
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('shape-invalid');
	});
});

describe('loadGameState — §5.4 canary folds THROUGH the unified path (LOAD-01)', () => {
	test('canary5_4Persisted() loads ok and derives remaining frag→2, smoke→4', () => {
		const result = loadGameState(canary5_4Persisted());
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const blue = result.state.sides.find((s) => s.id === 'BLUE')!;
		// The §5.4 frag derive (→2) spans BOTH the turn-2 expend (baked into the snapshot's
		// materialized `consumables.expended`) and the turn-4 expend (in result.events). The
		// canonical `remaining` query folds over the FULL stream, so reconstruct the prior
		// expends from the folded state's append-only `expended` view and prepend them to the
		// live events — exactly the boot-time A4 reconstruction (LEDGER-01: expended is the
		// materialized event view). smoke is in no expend entry, so it stays 4 (the canary).
		const expendedAsEvents: Extract<GameEvent, { kind: 'expend' }>[] =
			blue.consumables.expended.map((e) => ({
				kind: 'expend',
				side: 'BLUE',
				actor: e.actor,
				item: e.item,
				qty: e.qty,
				reason: e.reason,
				turn: e.turn
			}));
		const liveExpends = result.events.filter(
			(e): e is Extract<GameEvent, { kind: 'expend' }> => e.kind === 'expend'
		);
		const fullStream = [
			...expendedAsEvents.filter((p) => !liveExpends.some((l) => l.turn === p.turn && l.item === p.item)),
			...result.events
		];
		expect(remaining(blue.consumables.loadout, fullStream, 'frag', 'BLUE')).toBe(
			remaining_after_5_4.frag
		);
		expect(remaining(blue.consumables.loadout, fullStream, 'smoke', 'BLUE')).toBe(
			remaining_after_5_4.smoke
		);
	});
});
