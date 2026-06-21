// ledger.test.ts — the LEDGER gate for Phase 1 (LEDGER-01..04).
//
// This file LOCKS the structural answer to the spec's two named bugs:
//   - smoke-swept-with-frags: an item in no `expend` entry CANNOT change.
//   - phantom mortar: a count moves only with a logged `expend` event.
//
// It asserts the §5.4 derivations exactly (frag=2, smoke=4 UNCHANGED, mortar=10,
// rpg=7 — the canary, M1 acceptance #5), that `remaining` is the ONLY path to a
// count (no stored field), that the expended projection is append-only and
// ordered, that narrative-only events leave counts unmoved (no AI path), and the
// ledger-monotonicity property: an item in zero expend entries never changes and
// counts only ever decrease via expend (rise only via resupply).
//
// Tests the SHARED §5.4 fixture (tests/engine/fixtures/worked-example-5.4.ts) —
// the contract of record that every later phase keeps passing.

import { describe, test, expect } from 'vitest';
import { remaining, expendedProjection } from '../../src/lib/engine/ledger';
import type { GameEvent } from '../../src/lib/engine/events';
import type { Consumables, Side } from '../../src/lib/engine/state';
import {
	stateBefore_5_4,
	events_5_4,
	fullStream_5_4,
	priorEvents_5_4,
	remaining_after_5_4
} from './fixtures/worked-example-5.4';

// ── Helpers ──────────────────────────────────────────────────────────────────
const sideById = (id: string): Side =>
	stateBefore_5_4().sides.find((s) => s.id === id)!;

const BLUE_LOADOUT = sideById('BLUE').consumables.loadout;
const RED_LOADOUT = sideById('RED').consumables.loadout;

// A crypto-free pseudo-shuffle (deterministic, seeded) — the property test only
// needs reordering, not entropy; the engine never uses Math.random for state.
function shuffled<T>(arr: T[], seed: number): T[] {
	const out = arr.slice();
	let s = seed;
	for (let i = out.length - 1; i > 0; i--) {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		const j = s % (i + 1);
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('§5.4 derivations — remaining is computed fresh from the event stream (LEDGER-03)', () => {
	// `remaining` queries the FULL event history (prior turns + this turn). The
	// §5.4 frag=2 derivation depends on the prior turn-2 frag expend being in the
	// stream (RESEARCH §5.4 note), so these assert over fullStream_5_4.
	test('frag = 6 − (turn-2 expend 2 + turn-4 expend 2) = 2', () => {
		expect(remaining(BLUE_LOADOUT, fullStream_5_4, 'frag', 'BLUE')).toBe(2);
		expect(remaining(BLUE_LOADOUT, fullStream_5_4, 'frag', 'BLUE')).toBe(remaining_after_5_4.frag);
	});

	test('mortar_60mm = 12 − 2 = 10', () => {
		expect(remaining(BLUE_LOADOUT, fullStream_5_4, 'mortar_60mm', 'BLUE')).toBe(10);
		expect(remaining(BLUE_LOADOUT, fullStream_5_4, 'mortar_60mm', 'BLUE')).toBe(
			remaining_after_5_4.mortar_60mm
		);
	});

	test('rpg (RED) = 8 − 1 = 7', () => {
		expect(remaining(RED_LOADOUT, fullStream_5_4, 'rpg', 'RED')).toBe(7);
		expect(remaining(RED_LOADOUT, fullStream_5_4, 'rpg', 'RED')).toBe(remaining_after_5_4.rpg);
	});

	test('the turn-4 list alone derives frag=4 (the prior turn-2 expend lives in history)', () => {
		// Sanity: events_5_4 is the turn-4 segment only; without prior history frag is
		// 6 − 2 = 4. The canonical 2 requires the full stream — proving remaining is a
		// pure function of WHICH events it sees, never a stored snapshot value.
		expect(remaining(BLUE_LOADOUT, events_5_4, 'frag', 'BLUE')).toBe(4);
	});
});

describe('SIDE-SCOPED — a shared item name never crosses sides (CR-01 regression, LEDGER-02/04)', () => {
	// The latent phantom-mortar bug class: two sides holding an item of the SAME
	// name. remaining() MUST scope to the queried side so one side's loadout never
	// pays for the other side's expends, and must agree with the side-aware
	// materialized `expended` view that fold maintains.
	const sharedLoadoutBLUE: Record<string, number> = { ammo: 10 };
	const sharedLoadoutRED: Record<string, number> = { ammo: 10 };
	const crossSide: GameEvent[] = [
		{ kind: 'expend', side: 'BLUE', actor: '1-1', item: 'ammo', qty: 3, turn: 4 },
		{ kind: 'expend', side: 'RED', actor: 'DEF', item: 'ammo', qty: 5, turn: 4 }
	];

	test("BLUE 'ammo' is decremented ONLY by BLUE's expend (10 − 3 = 7), not RED's", () => {
		expect(remaining(sharedLoadoutBLUE, crossSide, 'ammo', 'BLUE')).toBe(7);
	});

	test("RED 'ammo' is decremented ONLY by RED's expend (10 − 5 = 5), not BLUE's", () => {
		expect(remaining(sharedLoadoutRED, crossSide, 'ammo', 'RED')).toBe(5);
	});

	test('the two side-scoped counts disagree — proving the count is not side-blind', () => {
		const blue = remaining(sharedLoadoutBLUE, crossSide, 'ammo', 'BLUE');
		const red = remaining(sharedLoadoutRED, crossSide, 'ammo', 'RED');
		expect(blue).not.toBe(red);
		// A side-blind sum would have wrongly returned 10 − (3 + 5) = 2 for both.
		expect(blue).not.toBe(2);
		expect(red).not.toBe(2);
	});

	test('remaining() agrees with the side-aware expended projection for that side', () => {
		const blueSpent = expendedProjection(crossSide, 'BLUE').reduce((s, e) => s + e.qty, 0);
		expect(remaining(sharedLoadoutBLUE, crossSide, 'ammo', 'BLUE')).toBe(
			(sharedLoadoutBLUE.ammo ?? 0) - blueSpent
		);
	});

	test('resupply is also side-scoped — a BLUE resupply never raises RED’s count', () => {
		const withResupply: GameEvent[] = [
			...crossSide,
			{ kind: 'resupply', side: 'BLUE', item: 'ammo', from: 7, to: 9, source: 'rearm', turn: 5 }
		];
		expect(remaining(sharedLoadoutBLUE, withResupply, 'ammo', 'BLUE')).toBe(9); // 10 − 3 + 2
		expect(remaining(sharedLoadoutRED, withResupply, 'ammo', 'RED')).toBe(5); // unmoved by BLUE resupply
	});
});

describe('THE SMOKE CANARY — an item in no expend entry CANNOT change (LEDGER-03, M1 acceptance #5)', () => {
	test('remaining(smoke) === 4 UNCHANGED — smoke appears in no expend entry', () => {
		// Holds over the full §5.4 history: smoke is in NO expend entry anywhere.
		expect(remaining(BLUE_LOADOUT, fullStream_5_4, 'smoke', 'BLUE')).toBe(4);
		expect(remaining(BLUE_LOADOUT, fullStream_5_4, 'smoke', 'BLUE')).toBe(remaining_after_5_4.smoke);
	});

	test('the smoke-swept-with-frags bug is structurally absent: expending frag does not touch smoke', () => {
		// The exact §5.4 sweep that motivated the rebuild: frag and smoke both belong
		// to BLUE; frag is expended this turn. smoke must be untouched because the ONLY
		// decrement vector is summing expend events for that EXACT item.
		const before = remaining(BLUE_LOADOUT, [], 'smoke', 'BLUE');
		const after = remaining(BLUE_LOADOUT, events_5_4, 'smoke', 'BLUE');
		expect(after).toBe(before);
		expect(after).toBe(4);
	});
});

describe('NO-STORED-FIELD — remaining is only obtainable via the query (LEDGER-02)', () => {
	test('Consumables exposes loadout + the materialized event-views only — no remaining field', () => {
		const c: Consumables = sideById('BLUE').consumables;
		// loadout + the two materialized event-views (expended decrements, resupplied
		// raises). Both are fold-rebuilt projections of events, NOT a stored count — the
		// LEDGER-02 invariant the next assertion protects.
		expect(Object.keys(c).sort()).toEqual(['expended', 'loadout', 'resupplied']);
		// 'remaining' is not a key on the snapshot's consumables object.
		expect('remaining' in c).toBe(false);
	});

	test('the only way to get a count is to call remaining() — it is a function over events', () => {
		// remaining is a derived computation; assigning it would not persist anywhere.
		expect(typeof remaining).toBe('function');
		// Same loadout, different event streams ⇒ different counts ⇒ it is derived, not stored.
		const noEvents = remaining(BLUE_LOADOUT, [], 'frag', 'BLUE'); // 6
		const withEvents = remaining(BLUE_LOADOUT, fullStream_5_4, 'frag', 'BLUE'); // 2
		expect(noEvents).toBe(6);
		expect(withEvents).toBe(2);
		expect(noEvents).not.toBe(withEvents);
	});
});

describe('APPEND-ONLY — the expended projection is ordered and nothing is edited/deleted (LEDGER-01)', () => {
	test('projection over events_5_4 contains exactly the turn-4 expend entries, in stream order', () => {
		const proj = expendedProjection(events_5_4);
		expect(proj).toEqual([
			{ turn: 4, item: 'frag', qty: 2, actor: '1-1', reason: '' },
			{ turn: 4, item: 'mortar_60mm', qty: 2, actor: 'MTR', reason: '' },
			{ turn: 4, item: 'rpg', qty: 1, actor: 'DEF', reason: '' }
		]);
	});

	test('BLUE projection over the full stream: prior turn-2 frag PRECEDES the turn-4 expends, nothing deleted', () => {
		// Projecting the full §5.4 BLUE history materializes the prior turn-2 frag
		// entry FIRST, then this turn's BLUE expends, in stream order — append-only.
		const fullLedgerView = expendedProjection(fullStream_5_4, 'BLUE');

		expect(fullLedgerView).toHaveLength(3);
		expect(fullLedgerView[0]).toMatchObject({ turn: 2, item: 'frag', qty: 2 });
		expect(fullLedgerView[1]).toMatchObject({ turn: 4, item: 'frag', qty: 2 });
		expect(fullLedgerView[2]).toMatchObject({ turn: 4, item: 'mortar_60mm', qty: 2 });
		// Strictly non-decreasing turns ⇒ append-only ordering, nothing reordered/edited.
		const turns = fullLedgerView.map((e) => e.turn);
		expect(turns).toEqual([...turns].sort((a, b) => a - b));
	});

	test('the snapshot materialized expended view matches the projection of prior events (self-describing)', () => {
		// Consumables.expended is the snapshot-time materialized view of prior expend
		// events — it must equal the projection of priorEvents_5_4 for that side.
		const materialized = sideById('BLUE').consumables.expended;
		const projected = expendedProjection(priorEvents_5_4, 'BLUE');
		expect(materialized).toEqual(projected);
	});
});

describe('CODE-DOES-SUBTRACTION — narrative has no path to a count (LEDGER-04)', () => {
	test('a dice/narrative-only event leaves remaining(smoke) unmoved', () => {
		// A turn full of prose: a dice roll mentioning a smoke screen, a posture change,
		// a clock tick — but NO smoke expend event. The count must not move.
		const narrativeOnly: GameEvent[] = [
			{
				kind: 'dice',
				actor: '1-1',
				roll: [4, 5],
				modifiers: [{ label: 'smoke screen concealment', value: 2 }],
				net: 2,
				band: 'success_clean',
				turn: 5
			},
			{ kind: 'posture', unit: '1-1', from: 'consolidating', to: 'advancing', turn: 5 },
			{ kind: 'clock', from: 'D1 0720', to: 'D1 0740', turn: 5 }
		];
		expect(remaining(BLUE_LOADOUT, narrativeOnly, 'smoke', 'BLUE')).toBe(4);
		// And a frag count is likewise unmoved by prose alone.
		expect(remaining(BLUE_LOADOUT, narrativeOnly, 'frag', 'BLUE')).toBe(6);
	});

	test('only an expend event with the exact item decrements; a different item does not', () => {
		const expendFragOnly: GameEvent[] = [
			{ kind: 'expend', side: 'BLUE', actor: '1-1', item: 'frag', qty: 3, turn: 5 }
		];
		expect(remaining(BLUE_LOADOUT, expendFragOnly, 'frag', 'BLUE')).toBe(3); // 6 − 3
		expect(remaining(BLUE_LOADOUT, expendFragOnly, 'smoke', 'BLUE')).toBe(4); // untouched
	});

	test('resupply is the ONLY event that may raise a count (to − from)', () => {
		const resupply: GameEvent[] = [
			{ kind: 'expend', side: 'RED', actor: 'DEF', item: 'rpg', qty: 1, turn: 4 },
			{ kind: 'resupply', side: 'RED', item: 'rpg', from: 7, to: 8, source: 'logistics', turn: 5 }
		];
		// 8 − 1(expend) + (8 − 7)(resupply) = 8
		expect(remaining(RED_LOADOUT, resupply, 'rpg', 'RED')).toBe(8);
	});
});

describe('PROPERTY — ledger-monotonicity (Critical Correctness Property #2)', () => {
	const items = ['frag', 'smoke', 'mortar_60mm'] as const;

	// A pool of legal events: expends for frag/mortar (never smoke), plus prose noise.
	const pool: GameEvent[] = [
		{ kind: 'expend', side: 'BLUE', actor: '1-1', item: 'frag', qty: 1, turn: 4 },
		{ kind: 'expend', side: 'BLUE', actor: '1-1', item: 'frag', qty: 1, turn: 5 },
		{ kind: 'expend', side: 'BLUE', actor: 'MTR', item: 'mortar_60mm', qty: 2, turn: 4 },
		{ kind: 'expend', side: 'BLUE', actor: 'MTR', item: 'mortar_60mm', qty: 1, turn: 6 },
		{ kind: 'dice', actor: '1-1', roll: [2, 6], modifiers: [], net: 0, band: 'stalled', turn: 4 },
		{ kind: 'posture', unit: '1-1', from: 'staged', to: 'advancing', turn: 5 },
		{ kind: 'clock', from: 'D1 0700', to: 'D1 0720', turn: 4 }
	];

	test('an item in ZERO expend entries always returns loadout[item] unchanged (smoke), over shuffled streams', () => {
		for (let seed = 1; seed <= 50; seed++) {
			const stream = shuffled(pool, seed);
			// smoke is in no expend entry in the pool ⇒ remaining must equal loadout.
			expect(remaining(BLUE_LOADOUT, stream, 'smoke', 'BLUE')).toBe(BLUE_LOADOUT.smoke);
		}
	});

	test('order-independence: remaining is invariant under event reordering (sum, not sequence)', () => {
		const baseline = remaining(BLUE_LOADOUT, pool, 'frag', 'BLUE');
		for (let seed = 1; seed <= 50; seed++) {
			expect(remaining(BLUE_LOADOUT, shuffled(pool, seed), 'frag', 'BLUE')).toBe(baseline);
		}
	});

	test('counts only ever DECREASE via expend (never rise without a resupply)', () => {
		for (const item of items) {
			const start = BLUE_LOADOUT[item] ?? 0;
			// pool has no resupply ⇒ remaining can never exceed the starting loadout.
			for (let seed = 1; seed <= 50; seed++) {
				const r = remaining(BLUE_LOADOUT, shuffled(pool, seed), item, 'BLUE');
				expect(r).toBeLessThanOrEqual(start);
			}
		}
	});

	test('adding a resupply is the ONLY way to push a count above its post-expend value', () => {
		const withoutResupply = remaining(BLUE_LOADOUT, pool, 'frag', 'BLUE');
		const withResupply = remaining(
			BLUE_LOADOUT,
			[...pool, { kind: 'resupply', side: 'BLUE', item: 'frag', from: 4, to: 6, source: 'rearm', turn: 7 }],
			'frag',
			'BLUE'
		);
		expect(withResupply).toBe(withoutResupply + 2);
		expect(withResupply).toBeGreaterThan(withoutResupply);
	});
});
