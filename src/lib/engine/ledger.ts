// ledger.ts — the ONE ledger. `remaining(item)` is a pure DERIVED query over the
// event stream, never a stored field (spec §4.1; LEDGER-01..04).
//
// The append-only `expended` log, the per-turn diff, and the event log are one
// transactional structure. A consumable count can ONLY change by summing `expend`
// (and logged `resupply`) events for that EXACT item — there is no other code path
// to a count, and the AI's prose has none (LEDGER-04). This is the structural
// answer to the spec's two named bugs:
//   - smoke-swept-with-frags: smoke appears in no `expend` entry ⇒ it cannot move.
//   - phantom mortar: a count can only move with a logged order (an `expend` event).
//
// `Consumables` (state.ts) deliberately has only `loadout` + `expended` and NO
// `remaining` field, so a stored count that could drift from `loadout − Σexpend`
// cannot even be represented (LEDGER-02 by construction).
//
// PURE: no mutation, no stored field, no AI/narrative input, no Date.now /
// Math.random / crypto. NO Svelte / idb / valibot import (CLAUDE.md engine-purity
// rule, CORE-02).

import type { GameEvent } from './events';
import type { ExpendEntry } from './state';

/**
 * `remaining(loadout, events, item, side)` — the derived consumable count for
 * `item` belonging to `side`.
 *
 *   = (loadout[item] ?? 0)
 *     − Σ(qty)      over `expend`   events for that exact item AND side  (the ONLY decrement)
 *     + Σ(to − from) over `resupply` events for that exact item AND side (the ONLY increment)
 *
 * Computed fresh from the event stream every call — it is never cached or stored.
 * Filtering on `e.item === item` is precisely why a consumable in no `expend`
 * entry cannot change (the smoke canary, §5.4 / M1 acceptance #5).
 *
 * `side` is REQUIRED and load-bearing: `loadout` is a single side's table, and both
 * `expend` and `resupply` events carry a `side`. Without the side filter, two sides
 * sharing an item name (e.g. `ammo`, `rations`) would have one side's loadout pay for
 * the other's expends — reintroducing the exact phantom-mortar bug class this ledger
 * exists to eliminate, and disagreeing with the side-aware materialized `expended`
 * view that `fold` maintains (LEDGER-01..04).
 */
export function remaining(
	loadout: Record<string, number>,
	events: GameEvent[],
	item: string,
	side: string
): number {
	const spent = events
		.filter(
			(e): e is Extract<GameEvent, { kind: 'expend' }> =>
				e.kind === 'expend' && e.item === item && e.side === side
		)
		.reduce((sum, e) => sum + e.qty, 0);

	const resupplied = events
		.filter(
			(e): e is Extract<GameEvent, { kind: 'resupply' }> =>
				e.kind === 'resupply' && e.item === item && e.side === side
		)
		.reduce((sum, e) => sum + (e.to - e.from), 0);

	return (loadout[item] ?? 0) - spent + resupplied;
}

/**
 * `expendedProjection(events)` — materialize the append-only `ExpendEntry[]` view
 * from the event stream, in stream order. This is the snapshot-time materialized
 * view of `expend` events (the same shape `fold` maintains on `Consumables.expended`):
 * rebuilt from events, never edited or deleted (LEDGER-01, append-only).
 *
 * Optionally scope to a single `side` (the `expend` event's `side`) so a per-side
 * ledger view can be derived without mutating anything.
 */
export function expendedProjection(events: GameEvent[], side?: string): ExpendEntry[] {
	return events
		.filter(
			(e): e is Extract<GameEvent, { kind: 'expend' }> =>
				e.kind === 'expend' && (side === undefined || e.side === side)
		)
		.map((e) => ({
			turn: e.turn,
			item: e.item,
			qty: e.qty,
			actor: e.actor,
			reason: e.reason ?? ''
		}));
}
