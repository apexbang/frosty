// scenarios/starter.ts — the CLEAN turn-0 player starter as a `PersistedGame` (D-01).
//
// PHASE 8 (LOAD-05): "a scenario IS a save at turn 0." The player-facing starter board is
// authored here as a `PersistedGame` envelope and loaded through the unified `loadGameState`
// path exactly like a resumed save — there is no bespoke hardcoded boot seed any more.
//
// CLEAN, not mid-engagement (D-01 / D-02): `meta.turn 0`, `phase: 'planning'`, EMPTY
// `consumables.expended` and `resupplied` for ALL sides, fresh full loadouts, units at full
// strength `staged`. The §5.4 baked turn-2 frag quirk (which makes `frag → 2` reproducible)
// belongs ONLY to the §5.4 canary / the `seedStarter()` twin — NOT to a fresh player board.
// A new player opens a clean turn-0 table, not a turn-3 fight already half-resolved.
//
// `campaignName: 'Starter'` is a FROZEN seed LABEL (D-06), NOT the identity — boot() mints
// the stable `campaignId` separately (D-05); the starter never derives or mints the id.
//
// PURITY (CORE-02): imports a PURE seed helper (`makeUnit`) + engine TYPE/const only
// (`PersistedGame`, `CURRENT_SCHEMA_VERSION`). NOTHING from Svelte / idb / valibot. It is a
// FACTORY — every call returns deep-distinct objects (fresh arrays, `makeUnit`-constructed
// units) so a booted game mutating one starter never touches another.

import { makeUnit } from '../seed';
import { CURRENT_SCHEMA_VERSION } from '../engine';
import type { PersistedGame } from '../engine';
import type { GameState } from '../engine/state';

/**
 * The clean turn-0 player starter STATE (D-01). Two sides, full loadouts, no prior expend,
 * units staged at full strength, `phase: 'planning'`, `meta.turn 0`. Every call builds a
 * deep-distinct object (fresh nested arrays / units) — the factory discipline the §5.4 twin
 * keeps, so two booted games never share mutable structure.
 */
function starterState(): GameState {
	return {
		meta: {
			campaignName: 'Starter',
			turn: 0,
			clock: 'D1 0600',
			weather: 'clear',
			terrain: 'urban',
			phase: 'planning'
		},
		sides: [
			{
				id: 'BLUE',
				commander: 'player',
				objectives: ['seize objective ALPHA'],
				manifest: {
					doctrine: 'combined-arms',
					echelon: 'platoon',
					// organicAssets are CAPABILITIES, not unit IDs (spec §5.4) — the capability
					// gate (VALID-01) validates `capabilitiesUsed` against these.
					organicAssets: ['small_arms', 'frag', 'smoke', 'mortar_60mm', 'at4', 'm240'],
					supportingAssets: ['60mm support'],
					prohibited: ['cas', 'artillery_beyond_60mm']
				},
				consumables: {
					loadout: { frag: 6, smoke: 4, mortar_60mm: 12 },
					// CLEAN turn-0: NO baked expend (the §5.4 turn-2 quirk lives only in the canary
					// / seedStarter twin — D-01/D-02). remaining derives to the full loadout here.
					expended: [],
					resupplied: []
				},
				units: [
					makeUnit({ id: '1-1', type: 'rifle-squad', posture: 'staged' }),
					makeUnit({ id: 'MTR', type: 'mortar-section', posture: 'staged' })
				]
			},
			{
				id: 'RED',
				commander: 'ai',
				objectives: ['hold the strongpoint'],
				manifest: {
					doctrine: 'positional-defense',
					echelon: 'platoon',
					organicAssets: ['small_arms', 'rpg', 'pkm'],
					supportingAssets: [],
					prohibited: ['heavy_weapons']
				},
				consumables: {
					loadout: { rpg: 8 },
					expended: [],
					resupplied: []
				},
				units: [makeUnit({ id: 'DEF', type: 'defenders', posture: 'staged' })]
			}
		],
		intel: { knows: {}, unconfirmedReports: [] },
		graveyard: [],
		// Phase 6 Slice A (UI-06): empty display-only narrative scrollback so the state is type-valid.
		narrativeLog: [],
		// Phase 13 (OBJ-05): the hand-authored mission briefing — DISPLAY-ONLY prose with zero
		// ledger authority. Win/lose is PROSE ONLY (the engine never detects victory/defeat); the
		// objective itself stays on Side.objectives[] (single source of truth, D-01) and is NOT
		// duplicated here. Authored to the urban BLUE-attacker-vs-RED-strongpoint framing, with the
		// full shape (incl. hints) because starterScenario() is the scenario-prompt's worked
		// exemplar — it must demonstrate a complete briefing. A fresh object literal per call
		// preserves the factory's deep-distinct-per-call discipline.
		briefing: {
			situation:
				'Before dawn your reinforced platoon presses into the outskirts. The enemy holds a ' +
				'fortified strongpoint astride objective ALPHA, covering the open approaches with ' +
				'interlocking fire. Surprise is gone; speed and suppression are what you have left.',
			victory:
				'You seize ALPHA and break the garrison — the strongpoint is yours and the enemy is ' +
				'driven out or destroyed before the city fully wakes.',
			defeat:
				'Your assault stalls in the open under their guns and your squads are bled white short ' +
				'of ALPHA, the strongpoint still holding when the light comes up.',
			hints: [
				'Screen the open approach with smoke before you cross it.',
				'Suppress the strongpoint before you commit the assault squad — do not trade in the open.',
				'Mortar fire is finite; spend it where it buys you the crossing.'
			]
		}
	};
}

/**
 * `starterScenario(): PersistedGame` — the clean turn-0 player starter wrapped as a
 * `PersistedGame` (a scenario IS a save at turn 0, D-LOCK-01). It carries a single turn-0
 * snapshot of the clean state and an EMPTY `events` array (a fresh board has no history to
 * replay), stamped at `CURRENT_SCHEMA_VERSION`. `loadGameState(starterScenario())` is always
 * shape-valid and always `ok` — the seed fallback is validated too (LOAD-05). Because both
 * `expended` and `events` are empty, the folded `remaining` is the full loadout.
 */
export function starterScenario(): PersistedGame {
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		campaignName: 'Starter',
		snapshots: [{ turn: 0, state: starterState() }],
		events: []
	};
}
