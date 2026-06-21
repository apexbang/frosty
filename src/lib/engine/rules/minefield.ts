// rules/minefield.ts — the minefield/obstacle rule module (DEPTH-01).
//
// Breaching or moving toward prepared positions is when mines/obstacles matter. To honour
// the §8 floor (a quiet move on an urban map must NOT load this), the trigger fires only
// when an approach action meets actual prepared opposition: any enemy unit holding a
// 'prepared' posture, OR a dedicated breach/assault action onto obstacle terrain. Terrain
// alone never fires it. Trigger reads code-known stakes only (order actionTypes +
// meta.terrain + enemy posture) — matched LOOSELY (RESEARCH A1).
//
// PURE: no mutation, no stored field, no AI/narrative input, no Date.now /
// Math.random / crypto. NO Svelte / idb / valibot import (CLAUDE.md engine-purity
// rule, CORE-02).

import type { RuleModule } from './types';

const APPROACH_VERBS = ['move', 'assault', 'breach', 'advance'];
const BREACH_VERBS = ['assault', 'breach'];
const OBSTACLE_TERRAIN = ['urban', 'prepared', 'fortified'];

export const minefield: RuleModule = {
	id: 'minefield',
	trigger: (state, order) => {
		const approaching = order.actions.some((a) =>
			APPROACH_VERBS.some((v) => a.actionType.toLowerCase().includes(v))
		);
		if (!approaching) return false;
		// Prepared opposition is the primary signal — mines guard a held position.
		const enemyPrepared = state.sides.some(
			(s) => s.commander === 'ai' && s.units.some((u) => u.posture.toLowerCase().includes('prepared'))
		);
		if (enemyPrepared) return true;
		// Otherwise terrain only matters when a DEDICATED breach/assault crosses it — a plain
		// move on an urban map (the §8 floor case) must not load this module.
		const breaching = order.actions.some((a) =>
			BREACH_VERBS.some((v) => a.actionType.toLowerCase().includes(v))
		);
		const obstacleTerrain = OBSTACLE_TERRAIN.some((t) => state.meta.terrain.toLowerCase().includes(t));
		return breaching && obstacleTerrain;
	},
	text: [
		'MINEFIELD / OBSTACLES: approaching a prepared position or urban terrain may cross',
		'mines, wire, or rubble. Treat obstacle effects as a modifier on the moving/breaching',
		'unit\'s contest, never an automatic loss. CODE owns the dice and casualty band.'
	].join('\n')
};
