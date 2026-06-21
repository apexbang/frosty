// examples.ts — the ENGINE-SIDE canonical §5.4 exemplar (the prompt one-shot).
//
// prompt.ts embeds a worked example so a weak external model still emits one
// well-shaped MoveEnvelope. That exemplar must live ENGINE-SIDE: the engine must
// never import from `tests/` (CORE-02 keeps the engine pure and import-clean; a
// test file is dev-only/untrusted from the engine's perspective, threat T-03-12).
// So the §5.4 envelope value is lifted here, byte-for-byte from spec §5.4, and
// `prompt.ts` imports `./examples` — never `tests/engine/fixtures/...`.
//
// The test fixture (tests/engine/fixtures/worked-example-5.4.ts) keeps its own
// `envelope_5_4` as the golden's contract of record; a follow-up may re-point it
// here. THIS plan does NOT modify that fixture — it only adds the engine-side
// twin so the two share spec §5.4 as their single source of truth.
//
// PURITY: type-only sibling import; NO Svelte/idb/valibot (CORE-02). This module
// is a plain typed constant — no logic, no entropy, no mutation.

import type { MoveEnvelope } from './envelope';

/**
 * The §5.4 worked example as a `MoveEnvelope` (spec §5.4, verbatim) — the one-shot
 * exemplar `buildPrompt` embeds so the model has a concrete, well-shaped target:
 *   - 2 playerActions: `1-1` assault opposing `DEF` (small_arms, frag; frag×2;
 *     +2 60mm support, −1 enemy prepared cover; 1-1 deltaBand −1), and `MTR`
 *     fire_support (mortar_60mm; ×2).
 *   - 1 enemyAction: `DEF` defend_fire opposing `1-1` (small_arms, rpg; rpg×1;
 *     +1 prepared position; DEF deltaBand −3).
 *   - no reveals.
 */
export const EXAMPLE_ENVELOPE_5_4: MoveEnvelope = {
	narrative:
		"1st squad pushes off the line of departure as two 60mm rounds crump into the compound's near wall; the fighters inside go to ground under the dust...",
	playerActions: [
		{
			actor: '1-1',
			side: 'BLUE',
			actionType: 'assault',
			target: 'compound',
			opposes: 'DEF',
			capabilitiesUsed: ['small_arms', 'frag'],
			expend: [{ item: 'frag', qty: 2 }],
			proposedModifiers: [
				{ label: '60mm support', value: 2 },
				{ label: 'enemy in prepared cover', value: -1 }
			],
			proposedOutcome: {
				casualties: [{ unit: '1-1', deltaBand: -1 }],
				note: 'takes the compound, light losses'
			},
			feasibilityNote: 'compound within assault distance via covered approach'
		},
		{
			actor: 'MTR',
			side: 'BLUE',
			actionType: 'fire_support',
			target: 'compound',
			capabilitiesUsed: ['mortar_60mm'],
			expend: [{ item: 'mortar_60mm', qty: 2 }],
			proposedModifiers: [],
			proposedOutcome: { note: 'suppresses defenders during the assault' }
		}
	],
	enemyActions: [
		{
			actor: 'DEF',
			side: 'RED',
			actionType: 'defend_fire',
			target: '1-1',
			opposes: '1-1',
			capabilitiesUsed: ['small_arms', 'rpg'],
			expend: [{ item: 'rpg', qty: 1 }],
			proposedModifiers: [{ label: 'prepared position', value: 1 }],
			proposedOutcome: {
				casualties: [{ unit: 'DEF', deltaBand: -3 }],
				note: 'fires then is overrun'
			}
		}
	],
	reveals: []
};
