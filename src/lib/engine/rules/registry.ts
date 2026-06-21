// rules/registry.ts — the rule-module registry + selectModules (DEPTH-01).
//
// RULE_MODULES is the ordered array of every rule module; the library "grows without
// limit" — a 7th rule is one new file + one entry here. `selectModules(state, order)` is
// a pure derived query (mirrors ledger.ts's "computed fresh every call, never cached"):
// filter by trigger, return the firing module ids + their text joined by a blank line.
// An empty result (no module fires) returns `{ ids: [], text: '' }` — a quiet patrol
// ships no rules (the §8 floor).
//
// PURE: no mutation, no stored field, no AI/narrative input, no Date.now /
// Math.random / crypto. NO Svelte / idb / valibot import (CLAUDE.md engine-purity
// rule, CORE-02).

import type { GameState } from '../state';
import type { PlayerOrder } from '../envelope';
import type { RuleModule } from './types';
import { ambush } from './ambush';
import { minefield } from './minefield';
import { indirectFire } from './indirect-fire';
import { breaching } from './breaching';
import { fogReveals } from './fog-reveals';
import { breakContact } from './break-contact';

/** The six locked rule modules, in stable registry order (DEPTH-01). */
export const RULE_MODULES: RuleModule[] = [
	ambush,
	minefield,
	indirectFire,
	breaching,
	fogReveals,
	breakContact
];

/**
 * `selectModules(state, order)` — the firing modules for this turn. Pure filter over the
 * registry by each module's trigger predicate; returns the matching ids and their text
 * concatenated by '\n\n' (the prompt's "Rules in effect" body). Empty when none fire.
 */
export function selectModules(state: GameState, order: PlayerOrder): { ids: string[]; text: string } {
	const hits = RULE_MODULES.filter((m) => m.trigger(state, order));
	return { ids: hits.map((m) => m.id), text: hits.map((m) => m.text).join('\n\n') };
}
