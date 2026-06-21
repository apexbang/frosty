// fold.test.ts — the truth-model gate for Phase 1.
//
// This file LOCKS the correctness properties the whole rebuild exists to
// guarantee: the §5.4 golden (fold reproduces the canonical state-after
// exactly), replay-equality (fold is pure — reduce === fold AND base is never
// mutated), band-snapping exactness, strength monotonicity-except-resupply, the
// per-event turn boundary, the snapshot cadence constant, and immutable unit ids.
//
// Per the plan note, this file INLINES its own copy of the §5.4 event list and a
// minimal-but-complete type-valid GameState base (the canonical shared fixture
// in tests/engine/fixtures/worked-example-5.4.ts is authored by plan 01-04, which
// owns the LEDGER `remaining()` assertions against it; both must agree with
// spec §5.4). We assert here only the fold/replay/band/turn/id properties — NOT
// the ledger `remaining()` derivations (plan 01-04 owns those).

import { describe, test, expect } from 'vitest';
import {
	fold,
	applyEvent,
	applyDeltaBand,
	BANDS,
	type GameState,
	type Unit
} from '../../src/lib/engine/state';
import type { GameEvent } from '../../src/lib/engine/events';
import { SNAPSHOT_CADENCE_N } from '../../src/lib/engine/save';

// ── §5.4 "state before": a minimal but COMPLETE, type-valid GameState ─────────
// Only the §5.4-relevant fields are asserted below; the rest are valid defaults.
// BLUE.consumables.expended already carries the prior turn-2 frag expend so a
// derived remaining('frag') would be 2 after turn 4 (asserted in plan 01-04).

function makeUnit(over: Partial<Unit> & Pick<Unit, 'id' | 'type'>): Unit {
	return {
		strength: 100,
		morale: 'steady',
		supply: { ammo: 'high', fuel: 'high', rations: 'high', medical: 'high' },
		position: 'unknown',
		posture: 'staged',
		status: [],
		...over
	};
}

function stateBefore_5_4(): GameState {
	return {
		meta: {
			campaignName: 'worked-example-5.4',
			turn: 3,
			clock: 'D1 0700',
			weather: 'clear',
			terrain: 'urban',
			phase: 'engagement'
		},
		sides: [
			{
				id: 'BLUE',
				commander: 'player',
				objectives: ['seize objective ALPHA'],
				manifest: {
					doctrine: 'combined-arms',
					echelon: 'platoon',
					// spec §5.4: organicAssets hold CAPABILITIES, not unit IDs (aligned with
					// the shared fixture). fold.test.ts asserts strengths/clock/phase/turn — never
					// the manifest — so this change is assertion-neutral and the suite stays green.
					organicAssets: ['small_arms', 'frag', 'smoke', 'mortar_60mm', 'at4', 'm240'],
					supportingAssets: ['60mm support'],
					prohibited: ['cas', 'artillery_beyond_60mm']
				},
				consumables: {
					loadout: { frag: 6, smoke: 4, mortar_60mm: 12 },
					// Prior turn-2 frag expend (so remaining('frag') derives to 2 after
					// turn 4: 6 − 2(turn2) − 2(turn4) = 2). LEDGER assertion is plan 01-04.
					expended: [
						{ turn: 2, item: 'frag', qty: 2, actor: '1-1', reason: 'turn-2 contact' }
					],
					resupplied: []
				},
				units: [
					makeUnit({ id: '1-1', type: 'rifle-squad', posture: 'staged' }),
					makeUnit({ id: 'MTR', type: 'mortar-section', posture: 'staged' })
				]
			},
			{
				id: 'RED',
				commander: 'ai',
				objectives: ['hold the strongpoint'],
				manifest: {
					doctrine: 'positional-defense',
					echelon: 'platoon',
					// spec §5.4: RED capabilities, not the unit ID 'DEF'.
					organicAssets: ['small_arms', 'rpg', 'pkm'],
					supportingAssets: [],
					prohibited: ['heavy_weapons']
				},
				consumables: {
					loadout: { rpg: 8 },
					expended: [],
					resupplied: []
				},
				units: [makeUnit({ id: 'DEF', type: 'defenders', posture: 'prepared' })]
			}
		],
		intel: { knows: {}, unconfirmedReports: [] },
		graveyard: [],
		// Phase 6 Slice A: display-only narrative scrollback (mirrors graveyard, ZERO ledger
		// authority). In lock-step with the shared fixture (Pitfall 1) so the §5.4 golden
		// whole-state purity asserts agree on the field.
		narrativeLog: []
	};
}

// ── The canonical §5.4 event list (inlined; turn:4 on every event) ───────────
const events_5_4: GameEvent[] = [
	{
		kind: 'dice',
		actor: '1-1',
		roll: [3, 4],
		modifiers: [
			{ label: '60mm support', value: 2 },
			{ label: 'enemy cover', value: -1 }
		],
		net: 1,
		band: 'success_costly',
		turn: 4
	},
	{ kind: 'strength', unit: '1-1', from: 100, to: 75, reason: 'assault casualties', turn: 4 },
	{ kind: 'strength', unit: 'DEF', from: 100, to: 25, reason: 'overrun', turn: 4 },
	{ kind: 'morale', unit: 'DEF', from: 'steady', to: 'broken', turn: 4 },
	{ kind: 'posture', unit: '1-1', from: 'staged', to: 'consolidating', turn: 4 },
	{ kind: 'posture', unit: 'DEF', from: 'prepared', to: 'broken', turn: 4 },
	{ kind: 'expend', side: 'BLUE', actor: '1-1', item: 'frag', qty: 2, turn: 4 },
	{ kind: 'expend', side: 'BLUE', actor: 'MTR', item: 'mortar_60mm', qty: 2, turn: 4 },
	{ kind: 'expend', side: 'RED', actor: 'DEF', item: 'rpg', qty: 1, turn: 4 },
	{ kind: 'clock', from: 'D1 0700', to: 'D1 0720', turn: 4 },
	{ kind: 'phase', from: 'engagement', to: 'consolidation', turn: 4 }
];

// ── Helpers ──────────────────────────────────────────────────────────────────
const unitById = (s: GameState, id: string): Unit | undefined =>
	s.sides.flatMap((side) => side.units).find((u) => u.id === id);

const allUnitIds = (s: GameState): string[] =>
	s.sides.flatMap((side) => side.units.map((u) => u.id)).sort();

// ─────────────────────────────────────────────────────────────────────────────

describe('§5.4 golden — fold reproduces the canonical state-after exactly (CORE-01)', () => {
	const after = fold(stateBefore_5_4(), events_5_4);

	test('1-1: strength 75, posture consolidating', () => {
		const u = unitById(after, '1-1')!;
		expect(u.strength).toBe(75);
		expect(u.posture).toBe('consolidating');
	});

	test('MTR: strength 100 unchanged (no strength event)', () => {
		expect(unitById(after, 'MTR')!.strength).toBe(100);
	});

	test('DEF: strength 25, morale broken, posture broken', () => {
		const u = unitById(after, 'DEF')!;
		expect(u.strength).toBe(25);
		expect(u.morale).toBe('broken');
		expect(u.posture).toBe('broken');
	});

	test('meta: turn 4, clock "D1 0720", phase consolidation', () => {
		expect(after.meta.turn).toBe(4);
		expect(after.meta.clock).toBe('D1 0720');
		expect(after.meta.phase).toBe('consolidation');
	});
});

describe('replay-equality — fold is pure (CORE-03)', () => {
	test('events.reduce(applyEvent) deep-equals fold(base, events)', () => {
		const base = stateBefore_5_4();
		const live = events_5_4.reduce(applyEvent, base);
		const replayed = fold(stateBefore_5_4(), events_5_4);
		expect(replayed).toEqual(live);
	});

	test('fold does NOT mutate the input snapshot', () => {
		const base = stateBefore_5_4();
		const pristine = structuredClone(base);
		fold(base, events_5_4);
		expect(base).toEqual(pristine); // byte-identical after fold
	});
});

describe('banded strength — applyDeltaBand snaps + clamps (STATE-02)', () => {
	test('§5.4 exactness: 100→75 at −1, 100→25 at −3', () => {
		expect(applyDeltaBand(100, -1)).toBe(75);
		expect(applyDeltaBand(100, -3)).toBe(25);
	});

	test('clamps to 0, never negative: 25→0 at −3, 75→0 at −10', () => {
		expect(applyDeltaBand(25, -3)).toBe(0);
		expect(applyDeltaBand(75, -10)).toBe(0);
	});

	test('every post-fold strength is a band ∈ {0,25,50,75,100}', () => {
		const after = fold(stateBefore_5_4(), events_5_4);
		for (const u of after.sides.flatMap((s) => s.units)) {
			expect(BANDS).toContain(u.strength);
		}
	});
});

describe('strength monotonicity-except-resupply (STATE-03)', () => {
	// A non-resupply 'strength' event with to > from is invalid: only a resupply
	// (or reinforcement source) may raise a count/strength. Phase 1 asserts the
	// invariant over the event stream (the Phase 2 resolver only ever emits
	// monotonic-decreasing strength events).
	const isIllegalStrengthIncrease = (e: GameEvent): boolean =>
		e.kind === 'strength' && e.to > e.from;

	test('the §5.4 stream contains no illegal strength increase', () => {
		expect(events_5_4.some(isIllegalStrengthIncrease)).toBe(false);
	});

	test('a non-resupply strength event with to>from is detected as invalid', () => {
		const illegal: GameEvent = {
			kind: 'strength',
			unit: 'DEF',
			from: 25,
			to: 100, // free healing — forbidden outside a resupply
			reason: 'should never happen',
			turn: 5
		};
		expect(isIllegalStrengthIncrease(illegal)).toBe(true);
	});

	test('resupply is the only event kind allowed to raise a count', () => {
		const resupply: GameEvent = {
			kind: 'resupply',
			side: 'RED',
			item: 'rpg',
			from: 7,
			to: 8,
			source: 'logistics',
			turn: 5
		};
		// resupply is a different discriminant — it is NOT a 'strength' increase and
		// is the sanctioned raising path.
		expect(isIllegalStrengthIncrease(resupply)).toBe(false);
		expect(resupply.to).toBeGreaterThan(resupply.from);
	});
});

describe('per-event turn boundary (CORE-06)', () => {
	test('every §5.4 event carries turn:4', () => {
		expect(events_5_4.every((e) => e.turn === 4)).toBe(true);
	});

	test('events are segmentable by turn', () => {
		const turn4 = events_5_4.filter((e) => e.turn === 4);
		expect(turn4.length).toBe(events_5_4.length);
	});
});

describe('snapshot cadence (CORE-04)', () => {
	test('SNAPSHOT_CADENCE_N === 10', () => {
		expect(SNAPSHOT_CADENCE_N).toBe(10);
	});
});

describe('immutable unit ids (STATE-05)', () => {
	test('the set of unit ids is identical before and after fold', () => {
		const base = stateBefore_5_4();
		const before = allUnitIds(base);
		const after = allUnitIds(fold(base, events_5_4));
		expect(after).toEqual(before);
	});
});

describe('seed / empty-fold identity (STATE-01)', () => {
	test('a starter GameState folds the empty event list to itself', () => {
		const base = stateBefore_5_4();
		const folded = fold(base, []);
		expect(folded).toEqual(base);
	});
});

describe('destroyed collapses the unit into the graveyard (STATE-04)', () => {
	const destroyDEF: GameEvent = { kind: 'destroyed', unit: 'DEF', turn: 4 };

	test('DEF is removed from RED.units and one graveyard line names it', () => {
		const after = fold(stateBefore_5_4(), [destroyDEF]);
		const red = after.sides.find((s) => s.id === 'RED')!;
		expect(red.units.some((u) => u.id === 'DEF')).toBe(false);
		expect(unitById(after, 'DEF')).toBeUndefined();
		const defLines = after.graveyard.filter((line) => line.includes('DEF'));
		expect(defLines).toHaveLength(1);
		expect(defLines[0]).toContain('RED');
	});

	test('the input snapshot is not mutated — DEF survives in a fresh base (purity)', () => {
		const base = stateBefore_5_4();
		const pristine = structuredClone(base);
		fold(base, [destroyDEF]);
		expect(base).toEqual(pristine);
		expect(unitById(base, 'DEF')).toBeDefined();
	});

	test('a follow-on event referencing a destroyed unit no-ops (unit gone)', () => {
		const after = fold(stateBefore_5_4(), [
			destroyDEF,
			{ kind: 'strength', unit: 'DEF', from: 100, to: 25, reason: 'too late', turn: 4 }
		]);
		// DEF stays gone; exactly one graveyard line; no resurrection.
		expect(unitById(after, 'DEF')).toBeUndefined();
		expect(after.graveyard.filter((line) => line.includes('DEF'))).toHaveLength(1);
	});

	test('re-folding a destroyed event is idempotent (no duplicate graveyard line, no throw)', () => {
		const after = fold(stateBefore_5_4(), [destroyDEF, destroyDEF]);
		expect(after.graveyard.filter((line) => line.includes('DEF'))).toHaveLength(1);
	});
});

describe('reveal moves a confirmed report into knows (FOG-02)', () => {
	function stateWithReport(): GameState {
		const base = stateBefore_5_4();
		base.intel = { knows: {}, unconfirmedReports: ['contact east ridge'] };
		return base;
	}

	const revealEvent: GameEvent = {
		kind: 'reveal',
		report: 'contact east ridge',
		resolvesTo: 'enemy MG nest, east ridge',
		confirmedBy: 'BLUE',
		turn: 4
	};

	test('the report leaves unconfirmedReports and the fact lands in knows[confirmedBy]', () => {
		const after = fold(stateWithReport(), [revealEvent]);
		expect(after.intel.unconfirmedReports).not.toContain('contact east ridge');
		expect(after.intel.knows['BLUE']).toContain('enemy MG nest, east ridge');
	});

	test('knows[BLUE] is created from absent (it was {} before)', () => {
		const base = stateWithReport();
		expect(base.intel.knows['BLUE']).toBeUndefined();
		const after = fold(base, [revealEvent]);
		expect(Array.isArray(after.intel.knows['BLUE'])).toBe(true);
		expect(after.intel.knows['BLUE']).toEqual(['enemy MG nest, east ridge']);
	});

	test('the input snapshot is not mutated by the reveal fold (purity)', () => {
		const base = stateWithReport();
		const pristine = structuredClone(base);
		fold(base, [revealEvent]);
		expect(base).toEqual(pristine);
	});

	test('re-folding a reveal does not duplicate the known fact', () => {
		const after = fold(stateWithReport(), [revealEvent, revealEvent]);
		expect(after.intel.knows['BLUE']).toEqual(['enemy MG nest, east ridge']);
	});
});

describe('narrative folds into narrativeLog (display-only, UI-06 substrate)', () => {
	const narrativeEvent: GameEvent = {
		kind: 'narrative',
		text: '1st squad pushes off the line of departure...',
		turn: 4
	};

	test('a narrative event appends { turn, text } to narrativeLog', () => {
		const after = fold(stateBefore_5_4(), [narrativeEvent]);
		expect(after.narrativeLog).toEqual([
			{ turn: 4, text: '1st squad pushes off the line of departure...' }
		]);
	});

	test('the input snapshot is not mutated by the narrative fold (purity)', () => {
		const base = stateBefore_5_4();
		const pristine = structuredClone(base);
		fold(base, [narrativeEvent]);
		expect(base).toEqual(pristine);
		expect(base.narrativeLog).toEqual([]);
	});

	test('fold is replay-equal — folding the same event twice yields equal narrativeLog', () => {
		const live = [narrativeEvent].reduce(applyEvent, stateBefore_5_4());
		const replayed = fold(stateBefore_5_4(), [narrativeEvent]);
		expect(replayed.narrativeLog).toEqual(live.narrativeLog);
	});

	test('narrative has ZERO ledger authority — it touches no side/unit/intel/graveyard', () => {
		const base = stateBefore_5_4();
		const after = fold(base, [narrativeEvent]);
		// Everything but narrativeLog + meta.turn is byte-identical (display-only push).
		expect(after.sides).toEqual(base.sides);
		expect(after.intel).toEqual(base.intel);
		expect(after.graveyard).toEqual(base.graveyard);
	});
});

describe('fold fails loud on an unhandled event kind (CR-02 regression, CORE-03)', () => {
	// Compile-time exhaustiveness is a `never` guard, but at RUNTIME an unknown kind
	// is reachable once schemaVersion folds an older/newer stream forward (Phase 4
	// migration). It MUST throw rather than return the event object as "state" and
	// silently build corrupt state on top of it.
	test('applyEvent throws on an unknown kind instead of returning a non-GameState', () => {
		const base = stateBefore_5_4();
		// A forged event whose kind is not in the union (as a future-stream would carry).
		const unknown = { kind: 'teleport', turn: 99 } as unknown as GameEvent;
		expect(() => applyEvent(base, unknown)).toThrow(/unhandled GameEvent kind: teleport/);
	});

	test('fold propagates the throw — corrupt streams never fold to a usable state', () => {
		const base = stateBefore_5_4();
		const stream = [
			{ kind: 'clock', from: 'D1 0700', to: 'D1 0720', turn: 1 },
			{ kind: 'teleport', turn: 2 }
		] as unknown as GameEvent[];
		expect(() => fold(base, stream)).toThrow(/unhandled GameEvent kind/);
	});
});
