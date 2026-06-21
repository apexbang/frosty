// rules/breaching.ts — the breaching rule module (DEPTH-01).
//
// Assault or breach against a prepared/fortified target (a compound, strongpoint). Load
// when an assault/breach action is ordered AND any enemy unit holds a prepared posture
// (the §5.4 assault on the prepared DEF). Trigger reads code-known stakes only — matched
// LOOSELY (RESEARCH A1).
//
// PURE: no mutation, no stored field, no AI/narrative input, no Date.now /
// Math.random / crypto. NO Svelte / idb / valibot import (CLAUDE.md engine-purity
// rule, CORE-02).

import type { RuleModule } from './types';

const BREACH_VERBS = ['assault', 'breach', 'clear', 'storm'];

export const breaching: RuleModule = {
	id: 'breaching',
	trigger: (state, order) => {
		const assaulting = order.actions.some((a) =>
			BREACH_VERBS.some((v) => a.actionType.toLowerCase().includes(v))
		);
		if (!assaulting) return false;
		return state.sides.some(
			(s) => s.commander === 'ai' && s.units.some((u) => u.posture.toLowerCase().includes('prepared'))
		);
	},
	text: [
		'BREACHING: assaulting a prepared/fortified position is costly for the attacker.',
		'The defender\'s prepared cover is a negative modifier on the assault contest; a clean',
		'win still risks attacker losses. CODE owns the contest, the dice, and casualty bands.'
	].join('\n')
};
