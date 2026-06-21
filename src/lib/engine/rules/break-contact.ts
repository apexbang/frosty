// rules/break-contact.ts — the break-contact rule module (DEPTH-01).
//
// Break-contact rules apply when disengaging or under pressure: a break_contact/withdraw/
// disengage action, OR the disengaging phase, OR a friendly unit at low strength (<= 25)
// in an active engagement. Trigger reads code-known stakes only — matched LOOSELY
// (RESEARCH A1).
//
// PURE: no mutation, no stored field, no AI/narrative input, no Date.now /
// Math.random / crypto. NO Svelte / idb / valibot import (CLAUDE.md engine-purity
// rule, CORE-02).

import type { RuleModule } from './types';

const DISENGAGE_VERBS = ['break_contact', 'break contact', 'withdraw', 'disengage', 'retreat', 'fall_back', 'fall back'];

/** The low-strength band at/below which a unit in an engagement is "under pressure". */
const PRESSURE_BAND = 25;

export const breakContact: RuleModule = {
	id: 'break-contact',
	trigger: (state, order) => {
		const disengaging = order.actions.some((a) =>
			DISENGAGE_VERBS.some((v) => a.actionType.toLowerCase().includes(v))
		);
		if (disengaging) return true;
		if (state.meta.phase === 'disengaging') return true;
		if (state.meta.phase === 'engagement') {
			return state.sides.some(
				(s) => s.commander === 'player' && s.units.some((u) => u.strength <= PRESSURE_BAND)
			);
		}
		return false;
	},
	text: [
		'BREAK CONTACT: disengaging under fire is a contested action, not a free withdrawal.',
		'The pursuing enemy gets a modifier; a pressed unit may take losses or shift posture',
		'while breaking. CODE owns the contest, dice, and any casualty band.'
	].join('\n')
};
