// size-turn.test.ts — stakes-to-payload sizing (DEPTH-02).
//
// `sizeTurn(state, order)` returns `{ ruleModules, detail, stateSlice }` sized from
// code-known stakes (contesting actions, live unconfirmed reports, engagement phase,
// high enemy strength). The §5.4 engagement sizes to 'deep'; a quiet patrol on a
// non-engagement state sizes to 'light'; a single-contact engagement sizes to
// 'standard'. The slice NEVER ships `narrativeLog` or `graveyard` (the §8 ceiling),
// and the deep slice DOES carry both sides + intel (Pitfall 3 — enough to reproduce
// the §5.4 golden). Thresholds are TUNABLE; floor/ceiling discipline is the invariant.
//
// RED until src/lib/engine/size-turn.ts exists. It MUST fail because the module cannot
// be resolved — not because of a fixture/syntax error.
//
// PURITY: imports only size-turn + the shared §5.4 fixture.

import { describe, test, expect } from 'vitest';
import { sizeTurn } from '../../src/lib/engine/size-turn';
import type { GameState } from '../../src/lib/engine/state';
import type { PlayerOrder, OrderAction } from '../../src/lib/engine/envelope';
import { stateBefore_5_4 } from './fixtures/worked-example-5.4';

function order(...actionTypes: string[]): PlayerOrder {
	const actions: OrderAction[] = actionTypes.map((actionType) => ({
		actor: '1-1',
		actionType,
		capabilitiesUsed: []
	}));
	return { raw: actionTypes.join(', '), actions };
}

/** The §5.4 player order: 1-1 assault (opposes DEF) + MTR fire_support — two contesting actions. */
const order_5_4: PlayerOrder = order('assault', 'fire_support');

/** A quiet patrol on a non-engagement state: no contact, no reports, low enemy strength. */
function quietState(): GameState {
	const s = stateBefore_5_4();
	s.meta.phase = 'planning';
	s.intel.unconfirmedReports = [];
	// Drop enemy strength below the high-strength threshold so nothing escalates to deep.
	for (const side of s.sides) if (side.commander === 'ai') for (const u of side.units) u.strength = 25;
	for (const side of s.sides) for (const u of side.units) u.posture = 'staged';
	return s;
}

describe('DEPTH-02 — sizeTurn detail tiers', () => {
	test('the §5.4 engagement sizes to deep', () => {
		expect(sizeTurn(stateBefore_5_4(), order_5_4).detail).toBe('deep');
	});

	test('a quiet patrol on a non-engagement state sizes to light', () => {
		expect(sizeTurn(quietState(), order('patrol')).detail).toBe('light');
	});

	test('a single-contact engagement (one contesting action, no other deep signal) sizes to standard', () => {
		const s = quietState();
		s.meta.phase = 'engagement';
		expect(sizeTurn(s, order('assault')).detail).toBe('standard');
	});
});

describe('DEPTH-02 — sizeTurn ruleModules surface the firing module ids', () => {
	test('the §5.4 deep turn loads at least one relevant rule module', () => {
		const sized = sizeTurn(stateBefore_5_4(), order_5_4);
		expect(Array.isArray(sized.ruleModules)).toBe(true);
		expect(sized.ruleModules.length).toBeGreaterThan(0);
	});

	test('a quiet patrol loads few/no modules (the §8 floor)', () => {
		const sized = sizeTurn(quietState(), order('patrol'));
		expect(sized.ruleModules).toEqual([]);
	});
});

describe('DEPTH-02 — the slice never ships the whole campaign log (the §8 ceiling)', () => {
	test('no slice contains narrativeLog or graveyard, at any tier', () => {
		for (const sized of [
			sizeTurn(stateBefore_5_4(), order_5_4), // deep
			sizeTurn((() => { const s = quietState(); s.meta.phase = 'engagement'; return s; })(), order('assault')), // standard
			sizeTurn(quietState(), order('patrol')) // light
		]) {
			const keys = Object.keys(sized.stateSlice);
			expect(keys).not.toContain('narrativeLog');
			expect(keys).not.toContain('graveyard');
		}
	});

	test('the deep slice carries both sides + intel (enough to reproduce §5.4)', () => {
		const sized = sizeTurn(stateBefore_5_4(), order_5_4);
		expect(sized.stateSlice.sides).toBeDefined();
		expect(sized.stateSlice.sides?.length).toBe(2);
		expect(sized.stateSlice.intel).toBeDefined();
		expect(sized.stateSlice.meta).toBeDefined();
	});
});
