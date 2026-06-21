// worked-example-5.4.ts — THE SHARED §5.4 GOLDEN FIXTURE (the contract of record).
//
// This is the canonical §5.4 worked example that every LATER phase imports and
// keeps passing (M1 acceptance #3–#6 + the smoke/frag/mortar pitfall canary).
// Plan 01-02's fold.test.ts deliberately INLINED its own copy of this event list
// to keep plans 02 and 04 file-disjoint (parallel-safe); this file is the one all
// downstream code imports. Both MUST agree with spec §5.4 — and they do, verbatim.
//
// Exports:
//   - stateBefore_5_4()  — a COMPLETE, type-valid GameState matching §5.4 "state
//                          before", incl. BLUE's PRIOR turn-2 frag expend in
//                          consumables.expended so remaining('frag') derives to 2.
//   - events_5_4         — the 11-event §5.4 list, EXACTLY, turn:4 on every event.
//   - stateAfter_5_4     — the canonical categorical state-after (for cross-checks).
//   - remaining_after_5_4 — the canonical derived ledger counts after turn 4.
//
// Reuses the GameState / GameEvent contracts from src/lib/engine — does NOT
// redefine them. NO Svelte / idb / valibot import (engine-purity rule).

import type { GameState, Unit } from '../../../src/lib/engine/state';
import type { GameEvent } from '../../../src/lib/engine/events';
import type { MoveEnvelope } from '../../../src/lib/engine/envelope';

// A complete, type-valid Unit with §5.4-irrelevant fields as valid defaults.
function makeUnit(over: Partial<Unit> & Pick<Unit, 'id' | 'type'>): Unit {
	return {
		strength: 100,
		morale: 'steady',
		supply: { ammo: 'high', fuel: 'high', rations: 'high', medical: 'high' },
		position: 'unknown',
		posture: 'staged',
		status: [],
		...over
	};
}

/**
 * §5.4 "state before" — turn 3, the engagement about to be resolved on turn 4.
 *
 * BLUE loadout: frag 6, smoke 4, mortar_60mm 12. The PRIOR turn-2 frag expend
 * (qty 2) is already in `consumables.expended`, so after the turn-4 frag expend
 * (qty 2) the derived remaining('frag') = 6 − 2 − 2 = 2. smoke is in NO expend
 * entry, so remaining('smoke') stays 4 (the canary). RED loadout: rpg 8.
 *
 * A FACTORY (not a shared constant) so every test gets a fresh, unmutated base —
 * proving `fold` never mutates its input.
 */
export function stateBefore_5_4(): GameState {
	return {
		meta: {
			campaignName: 'worked-example-5.4',
			turn: 3,
			clock: 'D1 0700',
			weather: 'clear',
			terrain: 'urban',
			phase: 'engagement'
		},
		sides: [
			{
				id: 'BLUE',
				commander: 'player',
				objectives: ['seize objective ALPHA'],
				manifest: {
					doctrine: 'combined-arms',
					echelon: 'platoon',
					// spec §5.4 (spec.md:194): organicAssets are CAPABILITIES, not unit IDs.
					// Unit IDs ('1-1','MTR') live ONLY in units[].id below. The capability gate
					// (VALID-01) validates `capabilitiesUsed` against these, so the §5.4 assault
					// (small_arms, frag) must find them here or every check falsely rejects.
					organicAssets: ['small_arms', 'frag', 'smoke', 'mortar_60mm', 'at4', 'm240'],
					supportingAssets: ['60mm support'],
					prohibited: ['cas', 'artillery_beyond_60mm']
				},
				consumables: {
					loadout: { frag: 6, smoke: 4, mortar_60mm: 12 },
					// PRIOR turn-2 frag expend — so remaining('frag') = 6 − 2(turn2) − 2(turn4) = 2.
					expended: [{ turn: 2, item: 'frag', qty: 2, actor: '1-1', reason: 'turn-2 contact' }],
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
					// spec §5.4 (spec.md:202): RED capabilities, not the unit ID 'DEF'.
					organicAssets: ['small_arms', 'rpg', 'pkm'],
					supportingAssets: [],
					prohibited: ['heavy_weapons']
				},
				consumables: {
					loadout: { rpg: 8 },
					expended: [],
					resupplied: []
				},
				units: [makeUnit({ id: 'DEF', type: 'defenders', posture: 'prepared' })]
			}
		],
		intel: { knows: {}, unconfirmedReports: [] },
		graveyard: [],
		// Phase 6 Slice A: display-only narrative scrollback (ZERO ledger authority —
		// mirrors graveyard). Seeded empty so the §5.4 golden whole-state purity asserts
		// carry the field in lock-step with the inline copy in fold.test.ts (Pitfall 1).
		narrativeLog: []
	};
}

/**
 * The PRIOR-history events that precede turn 4 — here, BLUE's turn-2 frag expend.
 * §5.4 derives `remaining('frag') = 6 − 2(turn2) − 2(turn4) = 2`, so the prior
 * expend must be part of the FULL event stream that `remaining` queries (the
 * snapshot also carries it as a materialized `expended` entry). Kept separate
 * from `events_5_4` (which is the turn-4 list, every event `turn:4`) so callers
 * can assert per-turn segmentation AND full-history derivation. (RESEARCH §5.4
 * note: the base snapshot must include the prior turn-2 expend.)
 */
export const priorEvents_5_4: GameEvent[] = [
	{ kind: 'expend', side: 'BLUE', actor: '1-1', item: 'frag', qty: 2, reason: 'turn-2 contact', turn: 2 }
];

/**
 * The §5.4 AI-returned `MoveEnvelope` (spec.md:214-238, verbatim) — the INPUT
 * that, after validate → resolveTurn → fold, produces `events_5_4` and therefore
 * `stateAfter_5_4`. This is the single-sourced happy-path input the §5.4 golden
 * (resolve.test.ts) validates against and drives to green in Plans 02/04.
 *
 *   - 2 playerActions: `1-1` assault opposing `DEF` (small_arms,frag; frag×2;
 *     +2 60mm support, −1 enemy prepared cover; 1-1 deltaBand −1), and `MTR`
 *     fire_support (mortar_60mm; ×2).
 *   - 1 enemyAction: `DEF` defend_fire opposing `1-1` (small_arms,rpg; rpg×1;
 *     +1 prepared position; DEF deltaBand −3).
 *   - no reveals.
 */
export const envelope_5_4: MoveEnvelope = {
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

/**
 * The §5.4 turn-4 event list — EXACTLY, every event `turn:4`. This is identical
 * to the copy inlined in fold.test.ts (both trace spec §5.4 verbatim).
 */
export const events_5_4: GameEvent[] = [
	{
		kind: 'dice',
		actor: '1-1',
		roll: [3, 4],
		modifiers: [
			{ label: '60mm support', value: 2 },
			{ label: 'enemy cover', value: -1 }
		],
		net: 1,
		band: 'success_costly',
		turn: 4
	},
	{ kind: 'strength', unit: '1-1', from: 100, to: 75, reason: 'assault casualties', turn: 4 },
	{ kind: 'strength', unit: 'DEF', from: 100, to: 25, reason: 'overrun', turn: 4 },
	{ kind: 'morale', unit: 'DEF', from: 'steady', to: 'broken', turn: 4 },
	{ kind: 'posture', unit: '1-1', from: 'staged', to: 'consolidating', turn: 4 },
	{ kind: 'posture', unit: 'DEF', from: 'prepared', to: 'broken', turn: 4 },
	{ kind: 'expend', side: 'BLUE', actor: '1-1', item: 'frag', qty: 2, turn: 4 },
	{ kind: 'expend', side: 'BLUE', actor: 'MTR', item: 'mortar_60mm', qty: 2, turn: 4 },
	{ kind: 'expend', side: 'RED', actor: 'DEF', item: 'rpg', qty: 1, turn: 4 },
	{ kind: 'clock', from: 'D1 0700', to: 'D1 0720', turn: 4 },
	{ kind: 'phase', from: 'engagement', to: 'consolidation', turn: 4 }
];

/**
 * The FULL §5.4 event history (prior turns + turn 4) — the stream `remaining`
 * queries to derive the post-turn-4 counts. `remaining(loadout, fullStream_5_4, item)`
 * gives the canonical `remaining_after_5_4` values (frag=2 because the prior
 * turn-2 frag expend is included).
 */
export const fullStream_5_4: GameEvent[] = [...priorEvents_5_4, ...events_5_4];

/** The canonical categorical state-after values (for cross-checking a fold). */
export const stateAfter_5_4 = {
	meta: { turn: 4, clock: 'D1 0720', phase: 'consolidation' as const },
	units: {
		'1-1': { strength: 75 as const, posture: 'consolidating' },
		MTR: { strength: 100 as const },
		DEF: { strength: 25 as const, morale: 'broken' as const, posture: 'broken' }
	}
};

/**
 * The canonical DERIVED ledger counts after turn 4 (spec §5.4):
 *   frag        = 6 − (2 + 2) = 2
 *   smoke       = 4 − 0       = 4   (UNCHANGED — the canary)
 *   mortar_60mm = 12 − 2      = 10
 *   rpg         = 8 − 1       = 7
 */
export const remaining_after_5_4 = {
	frag: 2,
	smoke: 4,
	mortar_60mm: 10,
	rpg: 7
} as const;
