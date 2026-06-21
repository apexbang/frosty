// prompt.test.ts — the copy-into-any-AI prompt builder (ORDER-01 + DEPTH-02 swap).
//
// buildPrompt(payload) renders the single self-contained string the player copies and
// pastes into any model. Per 03-RESEARCH (structured-output prompting) it embeds the
// player's raw prose order, an explicit JSON skeleton of the MoveEnvelope, and the
// §5.4 worked example as a one-shot exemplar — so weak models still emit one ```json
// block. This suite locks:
//   - ORDER-01 — the returned string is non-empty, contains order.raw verbatim, carries
//     a json skeleton marker, and carries an exemplar marker (the §5.4 actor '1-1').
//   - DEPTH-02 — buildPrompt consumes the SIZED slice (a Partial<GameState>) and the
//     concatenated rule-module text, NOT whole-state + the inline M1_RULES literal. The
//     §8 ceiling: the prompt never carries narrativeLog/graveyard, and it carries the
//     sized rules text, not 'M1_RULES'.
//
// RED until src/lib/engine/prompt.ts is written. It MUST fail because that module
// cannot be resolved — not because of a fixture or syntax error.
//
// PURITY: imports only the prompt module and the shared §5.4 fixture.

import { describe, test, expect } from 'vitest';
import { buildPrompt } from '../../src/lib/engine/prompt';
import type { TurnPayload } from '../../src/lib/engine/narrator';
import type { GameState } from '../../src/lib/engine/state';
import { stateBefore_5_4 } from './fixtures/worked-example-5.4';

const ORDER_RAW = 'Assault the compound with 1st squad, frag the door';

// A unique sentinel only present in the SIZED module text — proves buildPrompt renders
// the rules it is handed (the concatenated rule-module text), not a hard-coded literal.
const SIZED_RULES = 'AMBUSH-SENTINEL: movement into an unconfirmed report risks an ambush';

// The DEPTH-02 sized payload: `state` is a Partial<GameState> slice (the composeSlice
// output — meta + sides + intel only, NEVER narrativeLog/graveyard), and `rules` is the
// concatenated firing-module text. This is exactly what turn.ts now builds.
const payload = (): TurnPayload => {
	const full = stateBefore_5_4();
	const slice: Partial<GameState> = {
		meta: full.meta,
		sides: full.sides,
		intel: full.intel
	};
	return {
		state: slice as GameState,
		rules: SIZED_RULES,
		order: { raw: ORDER_RAW, actions: [] },
		detail: 'deep'
	} as TurnPayload;
};

describe('ORDER-01 — buildPrompt embeds order + skeleton + exemplar', () => {
	test('the prompt is a non-empty string containing the raw order verbatim', () => {
		const prompt = buildPrompt(payload());
		expect(typeof prompt).toBe('string');
		expect(prompt.length).toBeGreaterThan(0);
		expect(prompt).toContain(ORDER_RAW);
	});

	test('the prompt contains a json skeleton marker', () => {
		const prompt = buildPrompt(payload());
		expect(prompt).toContain('json');
	});

	test('the prompt contains the §5.4 exemplar (actor 1-1)', () => {
		const prompt = buildPrompt(payload());
		expect(prompt).toContain('1-1');
	});
});

// ── DEPTH-02: buildPrompt consumes the SIZED slice + module text (the §8 swap) ───
describe('DEPTH-02 — prompt consumes the sized slice + concatenated rule-module text', () => {
	test('the prompt renders the concatenated rule-module text it is handed (not a literal)', () => {
		const prompt = buildPrompt(payload());
		expect(prompt).toContain(SIZED_RULES);
	});

	test('the prompt never references the deprecated inline M1_RULES literal', () => {
		const prompt = buildPrompt(payload());
		expect(prompt).not.toContain('M1_RULES');
		expect(prompt).not.toContain('M1 RULES (inline)');
	});

	test('the prompt carries the sized slice (no whole-campaign-log fields)', () => {
		const prompt = buildPrompt(payload());
		// the §8 ceiling: a sized slice never ships narrativeLog/graveyard, so the
		// serialized state in the prompt must not contain those keys.
		expect(prompt).not.toContain('narrativeLog');
		expect(prompt).not.toContain('graveyard');
		// it DOES still carry the units the model needs to reason about the turn.
		expect(prompt).toContain('1-1');
		expect(prompt).toContain('DEF');
	});
});

// ── C: the skeleton must not seed qty:0 as a default; annotate qty positive ─────
describe('C — prompt does not present qty:0 as the default expend value', () => {
	test('the skeleton section does NOT contain a `"qty": 0` default', () => {
		const prompt = buildPrompt(payload());
		// The serialized skeleton (an empty-shape MoveEnvelope) must not seed 0 as the
		// to-fill expend qty — a model mirroring it would emit qty:0 (the observed bug).
		expect(prompt).not.toContain('"qty": 0');
	});

	test('the prompt annotates qty as a positive integer count', () => {
		const prompt = buildPrompt(payload());
		expect(prompt).toContain('positive integer count');
	});
});

// ── Finding 2: the structured-output contract is HARDENED (reveals shape + conventions) ─
describe('Finding 2 — prompt hardens the reveals shape + casualties/feasibility conventions', () => {
	test('the skeleton shows the reveals shape tokens report / resolvesTo / confirmedBy', () => {
		const prompt = buildPrompt(payload());
		expect(prompt).toContain('report');
		expect(prompt).toContain('resolvesTo');
		expect(prompt).toContain('confirmedBy');
	});

	test('the prompt states the reveals-[]-when-none convention with the correct entry shape', () => {
		const prompt = buildPrompt(payload());
		// The model must be told reveals is [] when nothing to resolve, and the entry is
		// { report, resolvesTo, confirmedBy } — NOT the wrong { unit, location } shape.
		expect(prompt).toContain('reveals MUST be []');
		expect(prompt).toContain('NOT { unit, location }');
	});

	test('the prompt states the casualties:[] no-loss convention (never a deltaBand:0 entry)', () => {
		const prompt = buildPrompt(payload());
		expect(prompt).toContain('casualties: []');
		expect(prompt).toContain('never a deltaBand: 0 entry');
		// And the skeleton itself must not seed a bare deltaBand:0 casualty.
		expect(prompt).not.toContain('"deltaBand": 0');
	});

	test('the prompt states feasibilityNote is ADVISORY / not code-enforced', () => {
		const prompt = buildPrompt(payload());
		expect(prompt).toContain('ADVISORY');
		expect(prompt).toContain('not code-enforced');
	});

	test('live unconfirmedReports surface under their own heading when present', () => {
		const full = stateBefore_5_4();
		const slice: Partial<GameState> = {
			meta: full.meta,
			sides: full.sides,
			intel: { ...full.intel, unconfirmedReports: ['possible MG nest, east ridge'] }
		};
		const prompt = buildPrompt({
			state: slice as GameState,
			rules: SIZED_RULES,
			order: { raw: ORDER_RAW, actions: [] },
			detail: 'deep'
		} as TurnPayload);
		expect(prompt).toContain('Unconfirmed reports in play');
		expect(prompt).toContain('possible MG nest, east ridge');
	});

	test('an empty unconfirmedReports renders the none ⇒ reveals [] convention', () => {
		const full = stateBefore_5_4();
		const slice: Partial<GameState> = {
			meta: full.meta,
			sides: full.sides,
			intel: { ...full.intel, unconfirmedReports: [] }
		};
		const prompt = buildPrompt({
			state: slice as GameState,
			rules: SIZED_RULES,
			order: { raw: ORDER_RAW, actions: [] },
			detail: 'deep'
		} as TurnPayload);
		expect(prompt).toContain('Unconfirmed reports in play');
		expect(prompt).toContain('none — reveals must be []');
	});
});

// ── E: the prompt frames the ACTIVE turn + expended[] as booked history ─────────
describe('E — prompt surfaces the active turn and frames expended[] as history', () => {
	// §5.4 stateBefore meta.turn === 3, so the ACTIVE turn being resolved is 4.
	test('the prompt states the active turn number (meta.turn + 1), not the stale turn', () => {
		const prompt = buildPrompt(payload());
		expect(prompt).toContain('Active turn 4');
	});

	test('the prompt frames expended[] as already-booked history', () => {
		const prompt = buildPrompt(payload());
		expect(prompt.toLowerCase()).toContain('already booked');
	});

	test('a partial/empty payload (no state) still builds a non-throwing prompt', () => {
		// buildPrompt runs inside ClipboardNarrator.run(); a missing meta.turn must
		// fall back to a sensible label rather than throw (NARR-02).
		const prompt = buildPrompt({} as TurnPayload);
		expect(typeof prompt).toBe('string');
		expect(prompt.length).toBeGreaterThan(0);
	});
});
