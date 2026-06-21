// scenario-prompt.test.ts — the AI scenario-GENERATION prompt builder (SCEN-01/05).
//
// scenario-prompt.ts is the engine-pure sibling of prompt.ts: given a player's brief of
// ANY specificity it assembles the single self-contained string the player copies into any
// external model to author a turn-0 PersistedGame seed. This suite locks:
//   - SCEN-01 — the prompt embeds the player's brief VERBATIM, a zero-authority instruction,
//     an annotated turn-0 PersistedGame skeleton, the clean starter exemplar, and the single
//     fenced-```json-block ask (the same block extractFencedJson then pulls back).
//   - SCEN-05 — the D-04 "fully complete EVERY required field" directive is present, so even a
//     terse brief instructs the model to invent a cleanly-importing full seed.
//   - the model-mirror guard — the annotated skeleton seeds NO qty:0 / deltaBand:0 literal a
//     weak model would copy (the prompt.ts:38-51 lesson carried to the seed skeleton).
//   - totality — terse, empty, and elaborate briefs all yield a non-empty prompt, no throw.
//
// RED until src/lib/engine/scenario-prompt.ts is written. It MUST fail because that module
// cannot be resolved — not because of a fixture or syntax error.
//
// PURITY: imports only the prompt-builder module + vitest. No Svelte/idb/valibot.

import { describe, test, expect } from 'vitest';
import { buildScenarioPrompt } from '../../src/lib/engine/scenario-prompt';

const BRIEF = 'usmc squad on patrol in kandahar';

describe('SCEN-01 — buildScenarioPrompt assembles a complete generation prompt', () => {
	test('embeds the player brief VERBATIM', () => {
		const prompt = buildScenarioPrompt(BRIEF);
		expect(prompt).toContain(BRIEF);
	});

	test('front-loads a zero-authority instruction (code owns the ledger)', () => {
		const prompt = buildScenarioPrompt(BRIEF).toLowerCase();
		// The same zero-authority discipline buildPrompt front-loads.
		expect(prompt).toContain('zero authority');
	});

	test('asks for ONE fenced ```json block only — no commentary', () => {
		const prompt = buildScenarioPrompt(BRIEF);
		expect(prompt).toContain('```json');
		expect(prompt.toLowerCase()).toContain('no commentary');
	});

	test('shows the turn-0 PersistedGame skeleton shape (schemaVersion/campaignName/snapshots/events)', () => {
		const prompt = buildScenarioPrompt(BRIEF);
		expect(prompt).toContain('schemaVersion');
		expect(prompt).toContain('campaignName');
		expect(prompt).toContain('snapshots');
		expect(prompt).toContain('events');
	});

	test('the skeleton declares the turn-0 invariants (meta.turn 0, empty events/expended/resupplied)', () => {
		const prompt = buildScenarioPrompt(BRIEF);
		// A turn-0 seed: no history. The fresh-board invariants must be visible in the prompt.
		expect(prompt).toContain('expended');
		expect(prompt).toContain('resupplied');
		// Turn 0 is the only legal seed turn — the prompt must say so.
		expect(prompt).toMatch(/turn[^0-9]{0,12}0/i);
	});

	test('embeds the clean starter as a one-shot exemplar (a known-good full seed)', () => {
		const prompt = buildScenarioPrompt(BRIEF);
		// The starter exemplar carries a real loadout capability — proof the clean seed, not the
		// empty skeleton, is the worked example the model mirrors.
		expect(prompt).toContain('small_arms');
	});
});

describe('SCEN-05 — the D-04 "fully complete every field" directive (terse briefs import cleanly)', () => {
	test('instructs the model to fill EVERY required field, never blank/partial', () => {
		const prompt = buildScenarioPrompt(BRIEF).toLowerCase();
		expect(prompt).toContain('every required field');
		expect(prompt).toContain('never leave');
	});

	test('instructs the model to invent reasonable forces / terrain / objectives', () => {
		const prompt = buildScenarioPrompt(BRIEF).toLowerCase();
		expect(prompt).toContain('invent');
	});
});

describe('SCEN-05 — the prompt enumerates the strict enums so terse briefs import cleanly', () => {
	// Regression for the human-verification gap: a terse brief ('usmc squad on patrol in
	// kandahar') produced a near-valid seed that hard-failed import because the model emitted
	// supply `medium` (schema allows only high|med|low|none|na). The defect was the prompt, not
	// the model: the old skeleton showed a unit as only {id,type,posture,strength} and spelled
	// out NO strict enums. These cases would all be RED against that pre-fix 4-field skeleton.

	test('shows all four supply channels and the allowed supply set (med, NOT medium)', () => {
		const prompt = buildScenarioPrompt(BRIEF);
		expect(prompt).toContain('ammo');
		expect(prompt).toContain('fuel');
		expect(prompt).toContain('rations');
		expect(prompt).toContain('medical');
		// The exact strict set the model must draw from — `med`, never `medium`.
		expect(prompt).toContain('high | med | low | none | na');
		// And the explicit callout that the synonym `medium` is rejected.
		expect(prompt).toContain('medium');
	});

	test('shows the morale allowed set', () => {
		const prompt = buildScenarioPrompt(BRIEF);
		expect(prompt).toContain('steady | shaken | broken | routed');
	});

	test('shows the strength band allowed set', () => {
		const prompt = buildScenarioPrompt(BRIEF);
		expect(prompt).toContain('0 | 25 | 50 | 75 | 100');
	});

	test('names the required unit fields the old 4-field skeleton omitted (morale/supply/position/status)', () => {
		const prompt = buildScenarioPrompt(BRIEF);
		// A regression that drops these back to {id,type,posture,strength} fails here.
		expect(prompt).toContain('morale');
		expect(prompt).toContain('supply');
		expect(prompt).toContain('position');
		expect(prompt).toContain('status');
	});
});

describe('model-mirror guard — no zero/no-op literal a weak model would copy', () => {
	test('the prompt seeds NO `qty: 0` literal', () => {
		const prompt = buildScenarioPrompt(BRIEF);
		expect(prompt).not.toMatch(/qty"?\s*:\s*0\b/);
	});

	test('the prompt seeds NO `deltaBand: 0` literal', () => {
		const prompt = buildScenarioPrompt(BRIEF);
		expect(prompt).not.toMatch(/deltaBand"?\s*:\s*0\b/);
	});
});

describe('totality — any brief yields a non-empty prompt, no throw', () => {
	test('a terse brief produces a complete prompt', () => {
		const prompt = buildScenarioPrompt('squad in a town');
		expect(prompt.length).toBeGreaterThan(200);
		expect(prompt).toContain('squad in a town');
	});

	test('an empty brief does NOT throw and still produces the scaffold', () => {
		expect(() => buildScenarioPrompt('')).not.toThrow();
		const prompt = buildScenarioPrompt('');
		expect(prompt).toContain('```json');
		expect(prompt).toContain('schemaVersion');
	});

	test('an elaborate brief is embedded verbatim and produces a complete prompt', () => {
		const elaborate =
			'A reinforced USMC rifle platoon, dawn, light rain, conducting a deliberate attack ' +
			'across a canal against a dug-in Taliban defense with RPGs and a single technical.';
		const prompt = buildScenarioPrompt(elaborate);
		expect(prompt).toContain(elaborate);
		expect(prompt).toContain('```json');
	});
});
