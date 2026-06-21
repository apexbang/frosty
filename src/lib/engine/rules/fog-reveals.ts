// rules/fog-reveals.ts — the fog-of-war reveals rule module (DEPTH-01).
//
// A reveal can only resolve a LIVE unconfirmed report, so load this module whenever any
// unconfirmed report exists — the model may then propose a `reveals` entry resolving one.
// Trigger reads code-known stakes only (intel.unconfirmedReports).
//
// PURE: no mutation, no stored field, no AI/narrative input, no Date.now /
// Math.random / crypto. NO Svelte / idb / valibot import (CLAUDE.md engine-purity
// rule, CORE-02).

import type { RuleModule } from './types';

export const fogReveals: RuleModule = {
	id: 'fog-reveals',
	trigger: (state) => state.intel.unconfirmedReports.length > 0,
	text: [
		'FOG-OF-WAR REVEALS: an unconfirmed report may turn out real, wrong, stale, or absent.',
		'A reveal RESOLVES a specific report into durable intel via a `reveals` entry',
		'{ report, resolvesTo, confirmedBy }. Only resolve a report that is actually in play;',
		'when none exist, `reveals` MUST be []. CODE owns the intel ledger; your reveal is a',
		'proposal that the resolver applies.'
	].join('\n')
};
