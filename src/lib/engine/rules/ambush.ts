// rules/ambush.ts — the ambush rule module (DEPTH-01).
//
// Movement into reported-but-unconfirmed contact is the ambush risk: a unit that
// moves/patrols/recons toward an area with a live unconfirmed report may be ambushed.
// Trigger reads code-known stakes only (the order's actionTypes + intel reports) —
// matched LOOSELY (actionType is a free string the model emits; RESEARCH A1).
//
// PURE: no mutation, no stored field, no AI/narrative input, no Date.now /
// Math.random / crypto. NO Svelte / idb / valibot import (CLAUDE.md engine-purity
// rule, CORE-02).

import type { RuleModule } from './types';

const MOVE_VERBS = ['move', 'patrol', 'recon', 'advance', 'maneuver'];

export const ambush: RuleModule = {
	id: 'ambush',
	trigger: (state, order) =>
		state.intel.unconfirmedReports.length > 0 &&
		order.actions.some((a) => MOVE_VERBS.some((v) => a.actionType.toLowerCase().includes(v))),
	text: [
		'AMBUSH: a unit moving into an area with an unconfirmed report may be ambushed.',
		'The contest is read in the moving unit\'s frame; surprise is an enemy modifier, not',
		'a guaranteed casualty. CODE owns the roll and any band — your JSON only proposes the',
		'modifiers and the narrative of contact.'
	].join('\n')
};
