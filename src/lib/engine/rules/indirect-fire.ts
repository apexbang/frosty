// rules/indirect-fire.ts — the indirect-fire rule module (DEPTH-01).
//
// Load when an indirect asset acts: any action whose actionType reads as fire support /
// indirect / mortar / artillery (the §5.4 MTR fire_support case), OR a unit type that is
// a mortar/artillery section is committed. Trigger reads code-known stakes only — matched
// LOOSELY (RESEARCH A1).
//
// PURE: no mutation, no stored field, no AI/narrative input, no Date.now /
// Math.random / crypto. NO Svelte / idb / valibot import (CLAUDE.md engine-purity
// rule, CORE-02).

import type { RuleModule } from './types';

const INDIRECT_VERBS = ['fire_support', 'fire support', 'indirect', 'mortar', 'artillery', 'suppress'];
const INDIRECT_UNIT_TYPES = ['mortar', 'artillery'];

export const indirectFire: RuleModule = {
	id: 'indirect-fire',
	trigger: (state, order) => {
		const indirectAction = order.actions.some((a) =>
			INDIRECT_VERBS.some((v) => a.actionType.toLowerCase().includes(v))
		);
		if (indirectAction) return true;
		const orderedActors = new Set(order.actions.map((a) => a.actor));
		return state.sides.some((s) =>
			s.units.some(
				(u) => orderedActors.has(u.id) && INDIRECT_UNIT_TYPES.some((t) => u.type.toLowerCase().includes(t))
			)
		);
	},
	text: [
		'INDIRECT FIRE: mortar/artillery support is suppression, not a guaranteed kill. It',
		'shifts the supported unit\'s contest as a positive modifier and may suppress the',
		'target\'s posture/morale. CODE owns the consumable expend (rounds) and any band.'
	].join('\n')
};
