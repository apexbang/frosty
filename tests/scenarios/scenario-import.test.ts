// scenario-import.test.ts — the AI-generation IMPORT round-trip at the ENGINE level (SCEN-02).
//
// This drives the pure functions the `game.importScenarioFromPaste` bridge composes — NOT the
// Svelte bridge itself — so the validated round-trip is proven without a DOM:
//   extractFencedJson → JSON.parse → validateSaveEnvelope → loadGameState (which runs the
//   Plan-01 validateSeed domain gate inside it). It locks:
//   - HAPPY PATH (SCEN-02) — a clean turn-0 seed wrapped in a prose-padded ```json fence
//     extracts, shape-validates, and imports `ok:true` to a folded turn-0 state.
//   - NON-JSON paste (T-09C-01) — a recoverable failure at JSON.parse, never a throw.
//   - SHAPE-INVALID paste (T-09C-02) — validateSaveEnvelope hard-rejects extra keys / type drift.
//   - ILLEGAL-SEED paste (T-09C-03 / SCEN-03) — a shape-valid seed with a capability in BOTH the
//     allow-set and prohibited is rejected by loadGameState as `illegal-seed` BEFORE fold.
//   - TERSE-BRIEF PROMPT (SCEN-05) — the clean-starter exemplar buildScenarioPrompt embeds is
//     itself a shape-valid PersistedGame when parsed, proving the worked example the model
//     mirrors imports cleanly ("imports cleanly is won at the prompt").
//
// Each input returns a Result / LoadResult; NONE throws — a bad paste is recoverable UX.
//
// PURITY: imports the engine boundary functions + the scenario factory + the prompt builder;
// no Svelte/idb in the test body (this is the engine-level round-trip, not the bridge).

import { describe, test, expect } from 'vitest';
import { extractFencedJson } from '../../src/lib/engine/envelope-schema';
import { validateSaveEnvelope } from '../../src/lib/engine/save-schema';
import { loadGameState } from '../../src/lib/engine/load';
import { buildScenarioPrompt } from '../../src/lib/engine/scenario-prompt';
import { starterScenario } from '../../src/lib/scenarios/starter';
import type { PersistedGame } from '../../src/lib/engine';

/**
 * The full engine-level import path the bridge composes, as a single TOTAL function returning
 * a discriminated result (it NEVER throws — every rejection is recoverable, mirroring
 * importScenarioFromPaste). Used by the cases below to assert each paste shape's outcome.
 */
type ImportOutcome =
	| { ok: true; turn: number }
	| { ok: false; stage: 'parse' | 'shape' | 'load'; reason: string };

function importRoundTrip(raw: string): ImportOutcome {
	const candidate = extractFencedJson(raw);

	let parsed: unknown;
	try {
		parsed = JSON.parse(candidate);
	} catch {
		return { ok: false, stage: 'parse', reason: 'not valid JSON' };
	}

	const shape = validateSaveEnvelope(parsed);
	if (!shape.ok) {
		return { ok: false, stage: 'shape', reason: shape.error };
	}

	const result = loadGameState(shape.value);
	if (!result.ok) {
		return { ok: false, stage: 'load', reason: result.reason };
	}

	return { ok: true, turn: result.state.meta.turn };
}

/** Wrap a value as the kind of prose-padded fenced block a chatty model emits. */
function fencedWithProse(value: unknown): string {
	return [
		'Sure! Here is the turn-0 scenario you asked for:',
		'',
		'```json',
		JSON.stringify(value, null, 2),
		'```',
		'',
		'Let me know if you want any changes.'
	].join('\n');
}

describe('SCEN-02 — happy-path import round-trip', () => {
	test('a clean turn-0 seed in a prose-wrapped ```json fence imports ok:true at turn 0', () => {
		const raw = fencedWithProse(starterScenario());
		const outcome = importRoundTrip(raw);
		expect(outcome.ok).toBe(true);
		if (outcome.ok) {
			expect(outcome.turn).toBe(0);
		}
	});

	test('extractFencedJson pulls the inner block out of the prose padding verbatim', () => {
		const seed = starterScenario();
		const inner = extractFencedJson(fencedWithProse(seed));
		// The extracted block round-trips back to the same envelope (no prose leaked in).
		expect(JSON.parse(inner)).toEqual(seed);
	});
});

describe('T-09C-01 — non-JSON paste is a recoverable parse failure (never throws)', () => {
	test('pure prose with no JSON returns {ok:false, stage:"parse"}', () => {
		expect(() => importRoundTrip('I could not generate that, sorry!')).not.toThrow();
		const outcome = importRoundTrip('I could not generate that, sorry!');
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) {
			expect(outcome.stage).toBe('parse');
		}
	});

	test('an empty paste returns {ok:false} without throwing', () => {
		expect(() => importRoundTrip('')).not.toThrow();
		expect(importRoundTrip('').ok).toBe(false);
	});

	test('a truncated/half ```json block returns {ok:false, stage:"parse"}', () => {
		const truncated = '```json\n{ "schemaVersion": 1, "campaignName": "Half"';
		const outcome = importRoundTrip(truncated);
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) {
			expect(outcome.stage).toBe('parse');
		}
	});
});

describe('T-09C-02 — shape-invalid paste hard-rejects at validateSaveEnvelope', () => {
	test('an extra top-level key returns {ok:false, stage:"shape"} with a readable error', () => {
		const tampered = { ...starterScenario(), hacked: true } as unknown;
		const outcome = importRoundTrip(fencedWithProse(tampered));
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) {
			expect(outcome.stage).toBe('shape');
			expect(outcome.reason.length).toBeGreaterThan(0);
		}
	});

	test('a wrong-typed field (campaignName as a number) returns {ok:false, stage:"shape"}', () => {
		const wrongType = { ...starterScenario(), campaignName: 42 } as unknown;
		const outcome = importRoundTrip(fencedWithProse(wrongType));
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) {
			expect(outcome.stage).toBe('shape');
		}
	});

	test('a top-level __proto__ key is rejected by the strictObject allow-list', () => {
		// A raw-JSON __proto__ is an OWN data property (JSON.parse does not set the prototype);
		// the strictObject allow-list admits ONLY the four known keys, so it shape-rejects.
		const raw = '```json\n{ "__proto__": { "polluted": true }, "schemaVersion": 1 }\n```';
		const outcome = importRoundTrip(raw);
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) {
			expect(outcome.stage).toBe('shape');
		}
	});
});

describe('T-09C-03 / SCEN-03 — shape-valid but illegal seed rejects at load', () => {
	test('a capability in BOTH the allow-set and prohibited returns illegal-seed (before fold)', () => {
		// Craft a shape-valid seed that is DOMAIN-illegal: BLUE fields `frag` (organicAssets)
		// AND forbids it (prohibited). validateSeed must reject this inside loadGameState.
		const seed = starterScenario();
		const blue = seed.snapshots[0].state.sides.find((s) => s.id === 'BLUE');
		expect(blue).toBeDefined();
		if (blue) {
			blue.manifest.prohibited = [...blue.manifest.prohibited, 'frag'];
		}

		// It is STILL shape-valid (only categorical, not structural — proves the domain gate
		// is what catches it, not the shape gate).
		const shape = validateSaveEnvelope(seed);
		expect(shape.ok).toBe(true);

		const result = loadGameState(seed as PersistedGame);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('illegal-seed');
			expect(result.error).toContain('frag');
		}
	});

	test('the same illegal seed pasted through the full round-trip returns {ok:false, stage:"load"}', () => {
		const seed = starterScenario();
		const blue = seed.snapshots[0].state.sides.find((s) => s.id === 'BLUE');
		if (blue) {
			blue.manifest.prohibited = [...blue.manifest.prohibited, 'frag'];
		}
		const outcome = importRoundTrip(fencedWithProse(seed));
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) {
			expect(outcome.stage).toBe('load');
			expect(outcome.reason).toBe('illegal-seed');
		}
	});
});

describe('SCEN-05 — the prompt’s clean-starter exemplar is itself a cleanly-importing seed', () => {
	test('the worked example embedded in buildScenarioPrompt parses as a shape-valid PersistedGame', () => {
		// "imports cleanly is won at the prompt": the model mirrors the worked example, so the
		// example MUST itself shape-validate AND import ok. Extract the SECOND fenced block (the
		// exemplar) — the first is the placeholder skeleton (intentionally <angle-bracket> strings).
		const prompt = buildScenarioPrompt('usmc squad in kandahar');
		const blocks = [...prompt.matchAll(/```json\s*([\s\S]*?)```/gi)].map((m) => m[1]);
		// The skeleton block + the worked-example block — at least two fenced json blocks.
		expect(blocks.length).toBeGreaterThanOrEqual(2);

		// The LAST fenced json block is the clean-starter worked example (placeholder skeleton
		// is first). It must parse, shape-validate, and import ok at turn 0.
		const exemplar = blocks[blocks.length - 1];
		const parsed = JSON.parse(exemplar);
		const shape = validateSaveEnvelope(parsed);
		expect(shape.ok).toBe(true);

		const result = loadGameState(parsed);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.state.meta.turn).toBe(0);
		}
	});
});
