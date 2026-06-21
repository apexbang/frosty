// envelope-schema.test.ts — the ClipboardNarrator INPUT trust boundary (NARR-02/03).
//
// envelope-schema.ts is the runtime shape-validator that stands between an UNTRUSTED
// pasted string (from any AI) and the engine's typed MoveEnvelope. This suite locks:
//   - NARR-02 — the valibot MoveEnvelopeSchema ACCEPTS the §5.4 worked example, and
//     extractAndValidate() of its JSON string returns { ok: true }.
//   - NARR-03 — malformed JSON, non-JSON prose, and a strictObject extra-field reject
//     all return { ok: false } with a string error (recoverable UX, never a throw).
//   - NARR-03 (fenced) — a §5.4 envelope wrapped in prose + a ```json fence still
//     validates, and extractFencedJson pulls the inner block out verbatim.
//
// RED until src/lib/engine/envelope-schema.ts is written (Waves 2-4). It MUST fail
// because that module cannot be resolved — not because of a fixture or syntax error.
//
// PURITY: imports only the schema module, valibot, and the shared §5.4 fixture.

import { describe, test, expect } from 'vitest';
import * as v from 'valibot';
import {
	extractAndValidate,
	extractFencedJson,
	MoveEnvelopeSchema
} from '../../src/lib/engine/envelope-schema';
import { envelope_5_4 } from './fixtures/worked-example-5.4';

// ── NARR-02: the schema accepts the canonical §5.4 envelope ───────────────────
describe('NARR-02 — accepts §5.4', () => {
	test('v.safeParse(MoveEnvelopeSchema, envelope_5_4) succeeds', () => {
		const result = v.safeParse(MoveEnvelopeSchema, envelope_5_4);
		expect(result.success).toBe(true);
	});

	test('extractAndValidate of the §5.4 JSON string returns ok', () => {
		const out = extractAndValidate(JSON.stringify(envelope_5_4));
		expect(out.ok).toBe(true);
		if (out.ok) {
			expect(out.value.playerActions).toHaveLength(2);
			expect(out.value.enemyActions[0].actor).toBe('DEF');
		}
	});
});

// ── NARR-03: malformed / partial / extra-field input is rejected (never thrown) ─
describe('NARR-03 — rejects', () => {
	test('a fenced object with a wrong-typed field (narrative:5) is rejected with a string error', () => {
		const out = extractAndValidate('Sure! ```json\n{ "narrative": 5 }\n```');
		expect(out.ok).toBe(false);
		if (!out.ok) {
			expect(typeof out.error).toBe('string');
			expect(out.error.length).toBeGreaterThan(0);
		}
	});

	test('non-JSON prose is rejected, not parsed', () => {
		const out = extractAndValidate('I think the squad should advance carefully.');
		expect(out.ok).toBe(false);
		if (!out.ok) expect(typeof out.error).toBe('string');
	});

	test('an envelope carrying an extra hallucinated top-level key is rejected (strictObject)', () => {
		const polluted = { ...structuredClone(envelope_5_4), extraField: 'hallucinated' };
		const out = extractAndValidate(JSON.stringify(polluted));
		expect(out.ok).toBe(false);
		// And the schema itself rejects the extra key directly.
		expect(v.safeParse(MoveEnvelopeSchema, polluted).success).toBe(false);
	});
});

// ── NARR-03: forgiving fenced-block extraction across prose-wrapping models ─────
describe('NARR-03 — fenced', () => {
	const wrapped = 'Here you go:\n```json\n' + JSON.stringify(envelope_5_4) + '\n```\nGood luck!';

	test('a §5.4 envelope wrapped in prose + a json fence still validates', () => {
		const out = extractAndValidate(wrapped);
		expect(out.ok).toBe(true);
		if (out.ok) expect(out.value.playerActions).toHaveLength(2);
	});

	test('extractFencedJson returns the inner JSON block, parseable to the envelope', () => {
		const inner = extractFencedJson(wrapped);
		expect(typeof inner).toBe('string');
		expect(JSON.parse(inner)).toEqual(envelope_5_4);
	});
});
