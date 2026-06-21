// prompt.ts — the COPY-INTO-ANY-AI prompt builder (ORDER-01).
//
// buildPrompt(payload) assembles the single self-contained string the player copies
// and pastes into any external model. Per CLAUDE.md's structured-output mandate it
// front-loads a zero-authority system instruction, the code-owned state slice, the
// rules in effect, the player's RAW prose order verbatim, an explicit MoveEnvelope
// JSON skeleton, and the §5.4 worked example as a one-shot exemplar — so even a weak
// model answers with ONE ```json block. Phase 6 (DEPTH-02) wired the §8 sizing: `payload.state`
// is now the PRE-SIZED slice from `sizeTurn` and `payload.rules` the concatenated firing
// rule-module text — buildPrompt serializes whatever sized slice/rules it is handed.
//
// The exemplar is imported from `./examples` (the engine-side §5.4 twin), NEVER from
// `tests/` — the engine stays import-pure (CORE-02, threat T-03-12).
//
// PURITY: type-only sibling import of TurnPayload + the engine-side exemplar; a
// deterministic string builder, no entropy, no mutation; NO Svelte/idb/valibot.

import type { TurnPayload } from './narrator';
import type { MoveEnvelope } from './envelope';
import { EXAMPLE_ENVELOPE_5_4 } from './examples';

/**
 * A field-annotated EMPTY-SHAPE MoveEnvelope — the "return EXACTLY this shape" target.
 * Empty arrays / placeholder strings show the model the shape without prescribing
 * content (the §5.4 exemplar below supplies the worked content). Models match a
 * concrete shape far more reliably than a prose description (CLAUDE.md).
 */
const MOVE_ENVELOPE_SKELETON: MoveEnvelope = {
	narrative: '<prose narration of the turn — cosmetic, zero authority over the ledger>',
	playerActions: [
		{
			actor: '<unit id, e.g. 1-1>',
			side: '<your side id, e.g. BLUE>',
			actionType: '<verb, e.g. assault | fire_support | move>',
			target: '<optional target>',
			opposes: '<optional: the enemy actor id this contests>',
			capabilitiesUsed: ['<capability from the manifest>'],
			// C: do NOT seed `qty: 0` here — a model mirroring the skeleton would emit
			// qty:0 (the observed bug). The shape is shown via an empty `expend` array;
			// an adjacent annotation line in buildPrompt explains the entry shape and that
			// qty is a POSITIVE INTEGER count (0 / omitted = spend nothing).
			expend: [],
			proposedModifiers: [{ label: '<why>', value: 0 }],
			proposedOutcome: {
				// Finding 2: do NOT seed a `deltaBand: 0` casualty here — a model mirroring
				// the skeleton would emit a no-loss entry that triggers a cosmetic roll. The
				// no-loss convention (`casualties: []`) is shown via the empty array + an
				// adjacent annotation line in buildPrompt.
				casualties: [],
				note: '<optional>'
			},
			feasibilityNote: '<optional spatial/feasibility judgment>'
		}
	],
	enemyActions: [],
	// Finding 2: show the EXACT reveals entry shape so the model can only resolve a
	// report it can see, in the right shape ({ report, resolvesTo, confirmedBy }). An
	// adjacent annotation line explains the []-when-none convention + the wrong shape
	// to avoid; the live unconfirmedReports are surfaced under their own heading below.
	reveals: [
		{
			report: '<the exact unconfirmedReports string this resolves — omit the array entirely if none>',
			resolvesTo: '<what it actually is, e.g. "enemy MG nest, east ridge">',
			confirmedBy: '<the side id confirming it, e.g. BLUE>'
		}
	]
};

/**
 * Build the prompt the player copies into any external AI. Assembles, in order:
 * a zero-authority system instruction → the code-owned state slice → the rules in
 * effect → the player's RAW prose order (embedded verbatim) → the MoveEnvelope
 * skeleton → the §5.4 one-shot exemplar. Returns ONE string answerable with a single
 * fenced ```json block.
 */
export function buildPrompt(payload: TurnPayload): string {
	const { state, rules, order } = payload;
	// Defensive reads: a partial/empty payload (e.g. before an order is parsed) must
	// still yield a non-empty, non-throwing prompt — buildPrompt is called inside
	// ClipboardNarrator.run() and a crash there would lose the turn (NARR-02).
	// Phase 6 (DEPTH-02): `state` is now the PRE-SIZED slice from sizeTurn (a bounded
	// Partial<GameState> — meta + the in-play sides + intel, never narrativeLog/graveyard).
	// buildPrompt just serializes whatever slice it is handed; the sizing happened upstream.
	const stateSlice = JSON.stringify(state ?? {}, null, 2);
	const rulesText = rules ?? '';
	const orderRaw = order?.raw ?? '';

	// E: surface the ACTIVE turn being resolved (meta.turn + 1, NOT the stale
	// meta.turn the state slice carries) so a model proposes only NEW spends for this
	// turn. A missing meta.turn falls back to a sensible label rather than throwing.
	const metaTurn = state?.meta?.turn;
	const activeTurn = typeof metaTurn === 'number' ? metaTurn + 1 : undefined;
	const activeTurnLabel = activeTurn !== undefined ? `Active turn ${activeTurn}` : 'Active turn';

	// Finding 2: surface the LIVE unconfirmed reports under their own heading so the
	// model can only resolve a report that actually exists (it cannot invent reveals).
	// Defensive read — the sized slice may carry an empty array or omit intel entirely.
	const reports = state?.intel?.unconfirmedReports ?? [];
	const reportsBlock =
		reports.length > 0
			? reports.map((r) => `- ${r}`).join('\n')
			: 'none — reveals must be []';

	return [
		'You are adjudicating one turn of a tactical wargame. CODE owns all numbers,',
		'dice, and consumable counts; your JSON is a PROPOSAL with ZERO authority over',
		'the ledger. Return ONE ```json block only — no commentary before or after.',
		'',
		`## ${activeTurnLabel}`,
		'This is the turn you are resolving now. The state below carries `meta.turn`',
		'(the PREVIOUS turn) and an `expended[]` ledger that is ALREADY BOOKED HISTORY —',
		'consumables spent on earlier turns. Do NOT re-spend booked history: propose only',
		'the NEW spends this order calls for this turn.',
		'',
		'## Current state',
		'```json',
		stateSlice,
		'```',
		'',
		'## Rules in effect',
		rulesText,
		'',
		'## Player order (prose)',
		orderRaw,
		'',
		'## Unconfirmed reports in play',
		'These are the ONLY reports you may resolve into `reveals`. Resolve a report only',
		'when this turn confirms or refutes it; otherwise leave `reveals` as `[]`.',
		reportsBlock,
		'',
		'## Return EXACTLY this shape (a MoveEnvelope)',
		'Each `expend` entry is `{ "item": "<consumable id>", "qty": <count> }` where',
		'`qty` is a positive integer count of the consumable to spend this turn. To spend',
		'nothing, leave `expend` as an empty array `[]` — never write `qty: 0` (0 / an',
		'omitted entry means spend nothing).',
		'reveals MUST be [] when there are no unconfirmed reports to resolve; each entry',
		'is { report, resolvesTo, confirmedBy } — NOT { unit, location }. `report` must be',
		'the EXACT string from "Unconfirmed reports in play" above.',
		"Represent 'no casualties' as `casualties: []` — never a deltaBand: 0 entry (a",
		'zero-delta casualty is a no-op the engine drops; an empty array is the correct shape).',
		'`feasibilityNote` is ADVISORY and not code-enforced; to refuse an impossible order,',
		'return empty `playerActions` rather than a no-op action.',
		'```json',
		JSON.stringify(MOVE_ENVELOPE_SKELETON, null, 2),
		'```',
		'',
		'## Worked example (one-shot)',
		'```json',
		JSON.stringify(EXAMPLE_ENVELOPE_5_4, null, 2),
		'```'
	].join('\n');
}
