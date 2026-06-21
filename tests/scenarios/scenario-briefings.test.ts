// scenario-briefings.test.ts — both hand-authored scenarios carry a complete briefing, and the
// seed validator accepts an optional briefing (including absent) with no new reject (Phase 13,
// OBJ-04 / OBJ-05).
//
// A briefing is DISPLAY-ONLY prose (situation / victory / defeat / hints) with zero ledger
// authority — exactly the "objectives prose the seed validator does NOT parse" category. These
// tests assert:
//   (1) starterScenario() and holdTheCrossingScenario() each carry a non-empty briefing with
//       non-empty situation/victory/defeat; objectives remain on Side.objectives[] (NOT
//       duplicated into briefing — single source of truth, CONTEXT D-01);
//   (2) validateSeed accepts both briefing-carrying scenario states ({ ok: true });
//   (3) a turn-0 state with Side.objectives[] but NO briefing still validates ({ ok: true }) —
//       briefing is optional, the validator adds no new reject arm.
//
// PURITY: imports the (non-engine) scenario factories + the pure engine validateSeed only.

import { describe, test, expect } from 'vitest';
import { starterScenario } from '../../src/lib/scenarios/starter';
import { holdTheCrossingScenario } from '../../src/lib/scenarios/second';
import { validateSeed } from '../../src/lib/engine/validate-seed';

const scenarios = [
	['Starter', starterScenario] as const,
	['Hold the Crossing', holdTheCrossingScenario] as const
];

describe('hand-authored scenario briefings [OBJ-05]', () => {
	test.each(scenarios)('"%s" carries a complete, non-empty briefing', (_name, factory) => {
		const state = factory().snapshots[0].state;
		const briefing = state.briefing;
		expect(briefing, 'scenario must carry a briefing').toBeDefined();
		if (!briefing) return;
		expect(briefing.situation.trim().length).toBeGreaterThan(0);
		expect(briefing.victory.trim().length).toBeGreaterThan(0);
		expect(briefing.defeat.trim().length).toBeGreaterThan(0);
	});

	test.each(scenarios)(
		'"%s" keeps objectives on Side.objectives[], not duplicated into briefing',
		(_name, factory) => {
			const state = factory().snapshots[0].state;
			// Objectives are the single source of truth on each side.
			const player = state.sides.find((s) => s.commander === 'player');
			expect(player?.objectives.length).toBeGreaterThan(0);
			// briefing carries prose, not an objectives array.
			expect(state.briefing).not.toHaveProperty('objectives');
		}
	);

	test.each(scenarios)('"%s" validates to { ok: true } (seed gate)', (_name, factory) => {
		const result = validateSeed(factory().snapshots[0].state);
		expect(result.ok, result.ok ? '' : result.reason).toBe(true);
	});

	test('a turn-0 state with objectives but NO briefing still validates to { ok: true }', () => {
		const state = starterScenario().snapshots[0].state;
		delete state.briefing;
		const result = validateSeed(state);
		expect(result.ok, result.ok ? '' : result.reason).toBe(true);
	});
});
