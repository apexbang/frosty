// rules/types.ts — the RuleModule contract (the LEAF of the rulebook graph).
//
// A rule module is a pure `{ id, trigger, text }`: a stable id surfaced in
// sizeTurn().ruleModules, a pure trigger predicate over code-known stakes (state,
// order), and the rule prose concatenated into the prompt's "Rules in effect" section.
// Rule text has ZERO authority over the ledger — it is advisory prose for the model,
// exactly like the envelope's "zero authority" discipline (envelope.ts).
//
// This module imports ONLY types (no Svelte, no state.ts runtime) so the rules graph
// stays acyclic — the six module files and the registry depend on this leaf.
//
// PURE: no mutation, no stored field, no AI/narrative input, no Date.now /
// Math.random / crypto. NO Svelte / idb / valibot import (CLAUDE.md engine-purity
// rule, CORE-02).

import type { GameState } from '../state';
import type { PlayerOrder } from '../envelope';

export interface RuleModule {
	/** Stable id surfaced in sizeTurn().ruleModules (e.g. 'ambush'). */
	id: string;
	/** Pure predicate over code-known stakes — true ⇒ this turn can trigger the rule. */
	trigger: (_state: GameState, _order: PlayerOrder) => boolean;
	/** The rule text concatenated into the prompt's "Rules in effect" section. */
	text: string;
}
