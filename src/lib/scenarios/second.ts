// scenarios/second.ts — "Hold the Crossing": the SECOND shipped scenario and the
// schema-generality PROOF (SCEN-07, D-01/D-02/D-03). It is authored as a turn-0
// `PersistedGame` and loaded through the SAME unified `loadGameState` path as the starter
// and any resumed save (D-LOCK-01: "a scenario IS a save at turn 0").
//
// THE PROOF (D-01): it INVERTS the starter on every axis to demonstrate the engine's
// state model is general, not starter-shaped:
//   • BLUE is the smaller, dug-in DEFENDER (the starter's BLUE is the attacker).
//   • RED is the larger mechanized ATTACKER (the starter's RED is the defender).
//   • `meta.terrain` is rural/river — NOT the starter's 'urban'.
//   • `objectives` are reversed polarity (deny / hold), authored as PROSE strings only —
//     there is NO victory mechanic or turn-counter (D-03); the prose IS the objective.
//   • `manifest.prohibited` is non-empty and MEANINGFUL for the lone defender (no off-map
//     fires coming — "hold alone, no cavalry") per D-02.
//
// CONFLICT-FREE INVARIANT (D-02, CRITICAL): no capability in `organicAssets ∪
// supportingAssets` may also appear in `prohibited`, and every `loadout` key must resolve
// into that allow-set. The Plan-01 seed validator (`validateSeed`, run inside
// `loadGameState`) rejects any violation AT LOAD. This scenario is therefore the proven
// conflict-free case the bundled-scenarios CI gate (Plan 04) asserts: its non-empty
// `prohibited` deliberately exercises the prohibited-conflict check with NO overlap.
//
// CLEAN turn-0 (mirrors starter.ts): `meta.turn 0`, `phase: 'planning'`, EMPTY
// `consumables.expended` / `resupplied` for ALL sides, fresh full loadouts, units at full
// strength `staged`, `events: []`. A fresh board has no history to replay.
//
// PURITY (CORE-02): imports the PURE seed helper `makeUnit` + engine TYPE/const only
// (`PersistedGame`, `CURRENT_SCHEMA_VERSION`). NOTHING from Svelte / idb / valibot. It is a
// FACTORY — every call returns deep-distinct objects (fresh nested arrays, `makeUnit`-built
// units) so one booted game mutating its state never touches another.

import { makeUnit } from '../seed';
import { CURRENT_SCHEMA_VERSION } from '../engine';
import type { PersistedGame } from '../engine';
import type { GameState } from '../engine/state';

/**
 * The clean turn-0 "Hold the Crossing" STATE — the INVERTED starter (D-01). A reinforced
 * BLUE infantry platoon (the player) holds a river crossing against a RED mechanized company
 * (the AI) pushing to seize it. Rural/river terrain, reversed deny/hold objectives, a
 * non-empty BLUE `prohibited` (no off-map fires). Every call builds a deep-distinct object.
 */
function holdTheCrossingState(): GameState {
	return {
		meta: {
			campaignName: 'Hold the Crossing',
			turn: 0,
			clock: 'D2 0430',
			weather: 'fog',
			// NON-'urban' (the schema-generality axis, D-01): a rural river line, not a city.
			terrain: 'rural river crossing',
			phase: 'planning'
		},
		sides: [
			{
				// BLUE = the smaller, dug-in DEFENDER (inverts the starter's BLUE attacker).
				id: 'BLUE',
				commander: 'player',
				// Reversed-polarity PROSE objectives (D-03) — deny / hold, NO victory mechanic.
				objectives: [
					'deny the river crossing to RED through D2',
					'hold the eastern bank — no withdrawal without orders'
				],
				manifest: {
					doctrine: 'prepared-defense',
					echelon: 'platoon',
					// CAPABILITIES, not unit IDs (spec §5.4). A dug-in defender's organic mix.
					organicAssets: ['small_arms', 'frag', 'smoke', 'mg', 'javelin', 'claymore'],
					supportingAssets: ['combat engineers'],
					// NON-EMPTY + MEANINGFUL (D-02): the lone defender has NO off-map fires. ZERO
					// overlap with the allow-set above — the proven conflict-free case the seed
					// validator (Plan 01) accepts AND the CI gate (Plan 04) asserts.
					prohibited: ['close_air_support', 'artillery', 'attack_helicopter']
				},
				consumables: {
					// Every key resolves into the allow-set above (coherence — validateSeed passes).
					loadout: { frag: 8, smoke: 6, javelin: 4, claymore: 6 },
					// CLEAN turn-0: no prior expend / resupply (D-01/D-02). remaining = full loadout.
					expended: [],
					resupplied: []
				},
				units: [
					makeUnit({ id: 'A-1', type: 'rifle-squad', posture: 'prepared' }),
					makeUnit({ id: 'A-2', type: 'rifle-squad', posture: 'prepared' }),
					makeUnit({ id: 'WPN', type: 'weapons-squad', posture: 'prepared' })
				]
			},
			{
				// RED = the LARGER, mechanized ATTACKER (inverts the starter's RED defender).
				id: 'RED',
				commander: 'ai',
				objectives: ['seize the crossing intact and break out to the eastern bank'],
				manifest: {
					doctrine: 'mechanized-assault',
					echelon: 'company',
					organicAssets: ['small_arms', 'autocannon', 'rpg', 'smoke', 'sapper_charge'],
					supportingAssets: ['mortar_120mm'],
					prohibited: ['nuclear']
				},
				consumables: {
					loadout: { autocannon: 30, rpg: 12, smoke: 8, sapper_charge: 4, mortar_120mm: 16 },
					expended: [],
					resupplied: []
				},
				units: [
					makeUnit({ id: 'R-1', type: 'mech-platoon', posture: 'staged' }),
					makeUnit({ id: 'R-2', type: 'mech-platoon', posture: 'staged' }),
					makeUnit({ id: 'R-3', type: 'mech-platoon', posture: 'staged' }),
					makeUnit({ id: 'R-SP', type: 'sapper-section', posture: 'staged' })
				]
			}
		],
		intel: { knows: {}, unconfirmedReports: [] },
		graveyard: [],
		// Phase 6 Slice A (UI-06): empty display-only narrative scrollback so the state is type-valid.
		narrativeLog: [],
		// Phase 13 (OBJ-05): the hand-authored mission briefing — DISPLAY-ONLY prose with zero
		// ledger authority. This SECOND distinct briefing proves the field is general, not
		// starter-shaped (the SCEN-07 generality discipline). Polarity is INVERTED: BLUE is the
		// dug-in DEFENDER denying a fog-bound river crossing (no off-map fires coming). Per the
		// file header (NO victory mechanic, the prose IS the objective), win/lose is PROSE ONLY.
		// Objectives stay on Side.objectives[] (D-01) and are NOT duplicated here.
		briefing: {
			situation:
				'Fog hangs over the river at first light. Your platoon is dug in on the eastern bank, ' +
				'holding the crossing alone — no off-map fires are coming. A RED mechanized company is ' +
				'massing on the far side to force a breakout across your line.',
			victory:
				'You deny RED the crossing through D2 and hold the eastern bank — the assault breaks ' +
				'against your prepared positions and the river line still belongs to you.',
			defeat:
				'RED forces the crossing intact and breaks out past your line, or your platoon is ' +
				'overrun and withdraws from the bank you were ordered to hold.',
			hints: [
				'Claymores and javelins favour the defender — site them on the likely crossing lanes.',
				'Fog cuts both ways; let RED come to you rather than spending the engineers early.',
				'You hold alone — there is no cavalry, so make every prepared position count.'
			]
		}
	};
}

/**
 * `holdTheCrossingScenario(): PersistedGame` — the clean turn-0 "Hold the Crossing" board
 * wrapped as a `PersistedGame` (a scenario IS a save at turn 0, D-LOCK-01), mirroring
 * `starterScenario()`. A single turn-0 snapshot + an EMPTY `events` array, stamped at
 * `CURRENT_SCHEMA_VERSION`. `loadGameState(holdTheCrossingScenario())` is always shape-valid,
 * passes the Plan-01 seed validator (conflict-free), and folds to its turn-0 state.
 */
export function holdTheCrossingScenario(): PersistedGame {
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		campaignName: 'Hold the Crossing',
		snapshots: [{ turn: 0, state: holdTheCrossingState() }],
		events: []
	};
}
