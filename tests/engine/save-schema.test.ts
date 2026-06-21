// save-schema.test.ts — the briefing-admit round-trip gate (Phase 13, OBJ-04).
//
// `GameState.briefing` is an additive, OPTIONAL, display-only field (the third member of the
// zero-authority family after `graveyard` / `narrativeLog`). The save boundary must admit it via
// `v.optional` so:
//   (1) a save WITH a full briefing round-trips through validateSaveEnvelope without stripping it,
//   (2) a save WITHOUT a briefing still passes (the field is absent, not a reject),
//   (3) a briefing with `hints` omitted passes (hints is itself v.optional).
//
// Mirrors the narrativeLog round-trip discipline: build a shape-valid SaveEnvelope (the clean
// turn-0 starter), attach a briefing to its base snapshot state, validate, and assert the parsed
// value retains the briefing identical to input.
//
// PURITY: imports the engine save-schema + the (non-engine) starter fixture only. No Svelte / idb.

import { describe, test, expect } from 'vitest';
import { validateSaveEnvelope } from '../../src/lib/engine/save-schema';
import { starterScenario } from '../../src/lib/scenarios/starter';
import type { GameState } from '../../src/lib/engine/state';

type Briefing = NonNullable<GameState['briefing']>;

const FULL_BRIEFING: Briefing = {
	situation: 'A reinforced platoon must seize the urban strongpoint at ALPHA before dawn.',
	victory: 'ALPHA falls and the enemy garrison is broken or driven out.',
	defeat: 'Your assault stalls in the open and your squads are bled white short of ALPHA.',
	hints: ['Smoke the approach before you cross the open ground.', 'Suppress before you assault.']
};

/**
 * A fresh, shape-valid turn-0 SaveEnvelope with `briefing` attached to (or removed from) its base
 * snapshot state. `validateSaveEnvelope` takes `unknown`, so the helper returns the (untyped) raw
 * envelope after mutating the briefing field through it — no unsafe `SaveEnvelope` cast needed.
 */
function envelopeWithBriefing(briefing: Briefing | undefined): unknown {
	const env = starterScenario();
	const state = env.snapshots[0].state;
	if (briefing === undefined) {
		// briefing-less: ensure the key is truly absent so v.optional parses it to undefined.
		delete state.briefing;
	} else {
		state.briefing = briefing;
	}
	return env;
}

describe('save-schema briefing admit — round-trip identity [OBJ-04]', () => {
	test('a SaveEnvelope carrying a full briefing validates and retains it identically', () => {
		const env = envelopeWithBriefing(FULL_BRIEFING);
		const result = validateSaveEnvelope(env);
		expect(result.ok, result.ok ? '' : result.error).toBe(true);
		if (!result.ok) return;
		// Round-trip identity: the parsed briefing deep-equals the input briefing (mirrors the
		// narrativeLog round-trip assertion — the import boundary does not strip the prose).
		expect(result.value.snapshots[0].state.briefing).toEqual(FULL_BRIEFING);
	});

	test('a SaveEnvelope with NO briefing key still passes (v.optional — absent, not rejected)', () => {
		const env = envelopeWithBriefing(undefined);
		const result = validateSaveEnvelope(env);
		expect(result.ok, result.ok ? '' : result.error).toBe(true);
		if (!result.ok) return;
		// Absent stays absent — briefing-less saves load cleanly with no schemaVersion bump.
		expect(result.value.snapshots[0].state.briefing).toBeUndefined();
	});

	test('a briefing with hints omitted passes (hints is v.optional(v.array(v.string())))', () => {
		const briefingNoHints = {
			situation: FULL_BRIEFING.situation,
			victory: FULL_BRIEFING.victory,
			defeat: FULL_BRIEFING.defeat
		};
		const env = envelopeWithBriefing(briefingNoHints);
		const result = validateSaveEnvelope(env);
		expect(result.ok, result.ok ? '' : result.error).toBe(true);
		if (!result.ok) return;
		expect(result.value.snapshots[0].state.briefing).toEqual(briefingNoHints);
	});
});
