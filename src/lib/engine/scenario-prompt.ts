// scenario-prompt.ts — the COPY-INTO-ANY-AI scenario GENERATION prompt builder (SCEN-01).
//
// buildScenarioPrompt(brief) is the turn-0 sibling of prompt.ts's buildPrompt. Where
// buildPrompt asks a model to ADJUDICATE one turn, this asks a model to AUTHOR a fresh
// turn-0 `PersistedGame` seed from the player's free-form brief, which the paste-back path
// then extracts → shape-validates → seed-validates → loads as a NEW campaign. Per CLAUDE.md's
// structured-output mandate it front-loads a zero-authority instruction, shows an explicit
// annotated turn-0 PersistedGame JSON skeleton, embeds the CLEAN starter as a one-shot
// exemplar, then the player's RAW brief verbatim, and asks for ONE ```json block — so even a
// weak model answers with a single cleanly-importing seed.
//
// SCEN-05 / D-04: the directive instructs the model to fill EVERY required field with
// plausible, internally-consistent choices — never blank/partial — so even a TERSE brief
// yields a complete, cleanly-importing seed. This is SAFE because the seed validator
// (validate-seed.ts) checks LEGALITY/coherence only, never balance or plausibility — the model
// is free to invent any internally-consistent forces/terrain/objectives.
//
// The exemplar is imported from `../scenarios/starter` (the engine-side clean turn-0 twin,
// D-05), NEVER from `tests/` — the engine stays import-pure (CORE-02). The §5.4 canary in
// examples.ts is the WRONG exemplar here: its baked turn-2/turn-3 history is mid-engagement;
// a model mirroring it would emit prior-turn expends, not a clean turn-0 board.
//
// PURITY: type-only sibling import of PersistedGame + the engine-side clean exemplar; a
// deterministic string builder, no entropy, no mutation; NO Svelte/idb/valibot.

import { starterScenario } from '../scenarios/starter';
import { CURRENT_SCHEMA_VERSION } from './save-schema';

/**
 * A field-annotated EMPTY-SHAPE turn-0 `PersistedGame` — the "return EXACTLY this shape"
 * target. Placeholder strings show the model the envelope + nested GameState shape WITHOUT
 * prescribing content (the clean-starter exemplar below supplies the worked content). Models
 * match a concrete shape far more reliably than a prose description (CLAUDE.md).
 *
 * Discipline (mirrors MOVE_ENVELOPE_SKELETON, prompt.ts:28-67): the turn-0 invariants —
 * `meta.turn 0`, EMPTY `events`, EMPTY `consumables.expended` / `resupplied` — are shown via
 * empty arrays, and NO zero/no-op value a model would mirror is seeded (no `qty: 0`, no
 * `deltaBand: 0`; loadout counts are placeholder strings, not literal zeros).
 */
const SCENARIO_SKELETON = {
	schemaVersion: CURRENT_SCHEMA_VERSION,
	campaignName: '<a short scenario title, e.g. "Patrol at Dawn">',
	snapshots: [
		{
			turn: 0,
			state: {
				meta: {
					campaignName: '<same title as above>',
					turn: 0,
					clock: '<start time, e.g. "D1 0600">',
					weather: '<e.g. clear | rain | fog>',
					terrain: '<e.g. urban | rural | mountain | river>',
					phase: 'planning'
				},
				sides: [
					{
						id: '<side id, e.g. BLUE>',
						commander: 'player',
						objectives: ['<a prose objective for this side>'],
						manifest: {
							doctrine: '<e.g. combined-arms | positional-defense>',
							echelon: '<e.g. squad | platoon | company>',
							// organicAssets / supportingAssets are CAPABILITIES (e.g. small_arms,
							// frag, mortar_60mm), NOT unit ids — the engine validates against these.
							organicAssets: ['<capability>', '<capability>'],
							supportingAssets: ['<optional supporting capability>'],
							// prohibited capabilities must NOT also appear in organic/supporting above
							// (a capability cannot be both available and prohibited).
							prohibited: ['<optional off-limits capability>']
						},
						consumables: {
							// loadout maps a consumable id to a POSITIVE integer count for THIS side.
							loadout: { '<consumable id>': '<positive integer count>' },
							// turn-0 invariants: a fresh board has spent and resupplied NOTHING.
							expended: [],
							resupplied: []
						},
						units: [
							{
								// EVERY unit needs ALL of these fields — a turn-0 board with units
								// missing morale/supply/position/status hard-fails import.
								id: '<unit id, e.g. 1-1>',
								type: '<e.g. rifle-squad | mortar-section | defenders>',
								// a strength BAND — one of 0 | 25 | 50 | 75 | 100 (full on a fresh board)
								strength: 100,
								morale: '<one of: steady | shaken | broken | routed>',
								// ALL FOUR channels required; each EXACTLY one of: high | med | low | none | na
								// (use `med`, NOT `medium`).
								supply: {
									ammo: '<high | med | low | none | na>',
									fuel: '<high | med | low | none | na>',
									rations: '<high | med | low | none | na>',
									medical: '<high | med | low | none | na>'
								},
								position: '<grid or landmark, e.g. "unknown">',
								posture: 'staged',
								// a fresh board has no unit statuses yet
								status: []
							}
						]
					}
				],
				intel: { knows: {}, unconfirmedReports: [] },
				graveyard: [],
				narrativeLog: [],
				// Phase 13 (OBJ-05): a DISPLAY-ONLY mission briefing the player reads — situation +
				// win/lose prose. ZERO AUTHORITY: the engine never detects victory or defeat; this is
				// read-only mission prose, never a mechanic. Keys match the GameState.briefing shape
				// exactly (situation / victory / defeat / hints?). Objectives stay on
				// Side.objectives[] above — do NOT repeat them here.
				briefing: {
					situation: '<2-3 sentences: the tactical situation the player faces at turn 0>',
					victory: '<what winning looks like — PROSE only, never a mechanic or turn-counter>',
					defeat: '<what losing looks like — PROSE only>',
					hints: ['<an optional tactical hint>', '<another optional hint>']
				}
			}
		}
	],
	// A fresh turn-0 board has NO history to replay.
	events: []
};

/**
 * Build the scenario-GENERATION prompt the player copies into any external AI. Assembles, in
 * order, into a single `.join('\n')` string:
 *   zero-authority system instruction → the D-04 "fully complete every field" directive →
 *   the annotated turn-0 PersistedGame skeleton → the clean starter one-shot exemplar →
 *   the player's RAW brief embedded verbatim → the "return ONE ```json block" ask.
 *
 * TOTAL: a terse, elaborate, or even empty brief all yield a complete, non-empty, non-throwing
 * prompt (the brief is embedded verbatim with a defensive `?? ''`). buildScenarioPrompt has no
 * entropy and no mutation — the same brief always produces the same prompt.
 */
export function buildScenarioPrompt(brief: string): string {
	// Defensive read: a missing/empty brief must still yield the full scaffold (the player can
	// re-copy after typing) — never a throw or a truncated prompt.
	const briefRaw = brief ?? '';

	return [
		'You are authoring the STARTING BOARD of a tactical wargame as a single turn-0',
		'save. CODE owns all numbers, dice, and consumable counts at play time; the JSON',
		'you return is the INITIAL STATE only and has ZERO AUTHORITY over how the game then',
		'plays out. Return ONE ```json block only — no commentary before or after.',
		'',
		'## Your task',
		'Read the player brief at the bottom and produce ONE turn-0 PersistedGame seed that',
		'realises it. Fill EVERY required field with plausible, internally-consistent choices;',
		'never leave a field blank or partial. Where the brief is terse, INVENT reasonable',
		'forces, terrain, weather, and objectives that fit it — a sparse brief must still yield',
		'a complete, well-formed seed. Keep it internally consistent: every capability a side',
		'uses must be listed in that side’s organicAssets or supportingAssets, and a',
		'capability listed as prohibited must NOT also appear as available.',
		'',
		'## Turn-0 invariants (a fresh board has NO history)',
		'- `meta.turn` is 0 and `meta.phase` is "planning".',
		'- `events` is an empty array `[]` — there is nothing to replay yet.',
		'- every side’s `consumables.expended` and `consumables.resupplied` are empty `[]`',
		'  (nothing has been spent or resupplied on a board that has not started).',
		'- `loadout` counts are POSITIVE integers; do NOT write `qty` or `deltaBand` anywhere',
		'  in a turn-0 seed (those belong to mid-game moves, not a starting board).',
		'- `briefing` is READ-ONLY mission prose for the player — situation + win/lose narration.',
		'  Its `victory`/`defeat` are PROSE ONLY: the engine NEVER detects victory or defeat and the',
		'  briefing carries ZERO authority over how the game plays out. Do NOT encode a win/lose',
		'  mechanic, score, or turn-limit there; do NOT repeat the side `objectives` inside it.',
		'',
		'## Return EXACTLY this shape (a turn-0 PersistedGame)',
		'Placeholders in `<angle brackets>` show the shape — replace each with a real value',
		'that fits the brief. Keep the field names and structure exactly as shown.',
		'```json',
		JSON.stringify(SCENARIO_SKELETON, null, 2),
		'```',
		'',
		'## Allowed values (STRICT — the importer rejects anything else)',
		'Every unit needs ALL of: `id`, `type`, `strength`, `morale`,',
		'`supply{ammo,fuel,rations,medical}`, `position`, `posture`, `status`.',
		'- `supply.ammo`, `supply.fuel`, `supply.rations`, `supply.medical` — each EXACTLY one of',
		'  `high | med | low | none | na`. Use `med` — NEVER `medium`, `high/low`, or any other',
		'  synonym; the importer hard-rejects `"medium"`.',
		'- `morale` — exactly one of `steady | shaken | broken | routed`.',
		'- `strength` — a band: exactly one of `0 | 25 | 50 | 75 | 100` (a number, not a percentage',
		'  in between).',
		'',
		'## Worked example (a complete, clean turn-0 seed)',
		'This is a real, cleanly-importing seed. Match its completeness and structure; author',
		'your own forces/terrain/objectives to fit the brief rather than copying its content.',
		'```json',
		JSON.stringify(starterScenario(), null, 2),
		'```',
		'',
		'## Player brief',
		briefRaw,
		'',
		'## Reminder',
		'Return ONE ```json block only — a single complete turn-0 PersistedGame, no commentary.'
	].join('\n');
}
