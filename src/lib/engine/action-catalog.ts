// action-catalog.ts — the PURE, code-owned verb catalog + the menu-time `offerableActions`
// filter (ORDER-04, CONTEXT D-01).
//
// This is the menu-time PREVIEW of the same capability gate `validate.ts` enforces at
// resolve (VALID-01): a tapped verb is never one the resolver would later reject. The
// resolver remains the AUTHORITY — this filter is COSMETIC (it shapes the menu only). A
// tapped action is a PROPOSAL with zero ledger authority; the resolver owns every delta
// (CLAUDE.md authority rule). The expend ceiling is the DERIVED `remaining` passed in;
// this module holds no count of its own.
//
// PURE: no Svelte / idb / valibot import, no Date.now / Math.random / crypto, no mutation
// (every filter returns a FRESH array; VERB_CATALOG is never spliced). `import type` of
// engine siblings only (CLAUDE.md engine-purity rule, CORE-02).

import type { Side, Unit, SupplyLevel } from './state';
import type { OrderAction } from './envelope';

/**
 * A code-owned verb in the action catalog. Each verb declares the capabilities it needs
 * (ALL must be on organic ∪ supporting, NONE prohibited — the VALID-01 mirror) and, for
 * a materiel verb, the consumable it expends (the UI binds the qty to derived `remaining`).
 * Free verbs (recon / hold) omit `expends` and require no capability, so a live unit always
 * has ≥1 offerable action.
 */
export interface ActionVerb {
	id: string;
	label: string;
	actionType: string;
	/** Capabilities this verb needs — ALL must be in organic ∪ supporting (none prohibited). */
	requiresCapabilities: string[];
	/** Consumable expended per use (default qty; the UI bounds it by derived remaining). Omit for free verbs. */
	expends?: { item: string; qty: number };
	/** Minimum supply gate (ADVISORY only — still offerable, the resolver adjudicates). */
	minSupply?: SupplyLevel;
}

/**
 * The static catalog — derived from the seed manifests (`seed.ts` / worked-example-5.4):
 *   BLUE organic: small_arms, frag, smoke, mortar_60mm, at4, m240 ; supporting: '60mm support'
 *   RED  organic: small_arms, rpg, pkm
 *   prohibited (BLUE): cas, artillery_beyond_60mm ; (RED): heavy_weapons
 * Exact verb set is Claude's Discretion (CONTEXT D-01 / RESEARCH A3): a defensible MVP set
 * traceable to the seed manifest. `recon`/`hold` are FREE (no capability, no expend) so every
 * live unit always has at least one offerable verb — the empty menu only ever shows for a
 * genuinely incapacitated unit. The list is module-frozen-by-discipline (never mutated).
 */
export const VERB_CATALOG: ActionVerb[] = [
	{ id: 'assault', label: 'Assault', actionType: 'assault', requiresCapabilities: ['small_arms'] },
	{
		id: 'frag_assault',
		label: 'Frag & clear',
		actionType: 'assault',
		requiresCapabilities: ['small_arms', 'frag'],
		expends: { item: 'frag', qty: 1 }
	},
	{
		id: 'support_fire',
		label: 'Support fire',
		actionType: 'support_fire',
		requiresCapabilities: ['60mm support', 'mortar_60mm'],
		expends: { item: 'mortar_60mm', qty: 1 }
	},
	{
		id: 'smoke',
		label: 'Pop smoke',
		actionType: 'obscure',
		requiresCapabilities: ['smoke'],
		expends: { item: 'smoke', qty: 1 }
	},
	{ id: 'suppress', label: 'Suppress', actionType: 'suppress', requiresCapabilities: ['m240'] },
	{ id: 'recon', label: 'Recon', actionType: 'recon', requiresCapabilities: [] },
	{ id: 'hold', label: 'Hold', actionType: 'hold', requiresCapabilities: [] },
	{
		id: 'rpg_strike',
		label: 'RPG strike',
		actionType: 'attack',
		requiresCapabilities: ['rpg'],
		expends: { item: 'rpg', qty: 1 }
	}
];

/**
 * `offerableActions(side, unit, remainingForSide)` — the PURE menu-time filter (ORDER-04).
 *
 * Returns ONLY the verbs offerable for `unit` on `side`, given the side's DERIVED remaining
 * map. Unofferable verbs are ABSENT from the returned list (never rendered-and-disabled —
 * CONTEXT: "unofferable means not rendered"). The gates, in order:
 *   1. ALIVE FIRST — a strength-≤0 or 'destroyed' unit yields [] (no resurrection-by-menu).
 *   2. CAPABILITY (VALID-01 mirror) — every required capability must be in organic ∪
 *      supporting and NONE may be prohibited (the cas / orbital-laser bug class, gated at
 *      menu time so a tapped verb never reaches a resolver rejection).
 *   3. CONSUMABLE — a materiel verb whose expended item has remainingForSide[item] ≤ 0 is
 *      unofferable (no point offering a spend the ledger cannot fund). The qty BOUND is the
 *      stepper's job (ORDER-05); this gate only drops the wholly-exhausted verb.
 *
 * Pure: never mutates `side`/`unit`/`remainingForSide` and returns a FRESH array (a
 * `.filter` over VERB_CATALOG, never the catalog itself).
 */
export function offerableActions(
	side: Side,
	unit: Unit,
	remainingForSide: Record<string, number>
): ActionVerb[] {
	// (1) ALIVE FIRST — an incapacitated unit offers nothing.
	if (unit.strength <= 0 || unit.status.includes('destroyed')) return [];

	const organic = new Set(side.manifest.organicAssets);
	const supporting = new Set(side.manifest.supportingAssets);
	const prohibited = new Set(side.manifest.prohibited);

	return VERB_CATALOG.filter((verb) => {
		// (2) CAPABILITY — every required capability allowed, none prohibited (VALID-01 mirror).
		for (const cap of verb.requiresCapabilities) {
			if (prohibited.has(cap)) return false;
			if (!organic.has(cap) && !supporting.has(cap)) return false;
		}
		// (3) CONSUMABLE — a verb that expends an item with 0 remaining is unofferable.
		if (verb.expends && (remainingForSide[verb.expends.item] ?? 0) <= 0) return false;
		return true;
	});
}

/**
 * `toOrderAction(unit, verb, qty)` — build the structured `OrderAction` a tapped verb
 * proposes (RESEARCH Code Examples). The `expend` array is present ONLY for a materiel verb,
 * carrying the player-chosen `qty` (bounded upstream by the stepper's derived ceiling). The
 * result is a PROPOSAL — it crosses into the engine only via `validate.ts` at resolve, never
 * a direct ledger write (CLAUDE.md authority rule).
 */
export function toOrderAction(unit: Unit, verb: ActionVerb, qty: number): OrderAction {
	return {
		actor: unit.id,
		actionType: verb.actionType,
		capabilitiesUsed: verb.requiresCapabilities,
		...(verb.expends ? { expend: [{ item: verb.expends.item, qty }] } : {})
	};
}
