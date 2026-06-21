// confirm.ts — the player's confirm-before-commit DIFF projection (ORDER-02/03).
//
// confirmDiff turns a validated MoveEnvelope into a flat, glanceable list of rows
// the player approves BEFORE resolveTurn commits any ledger touch (spec §5.3/§5.5).
// It SURFACES every `expend` (actor/side/item/qty) and every
// `proposedOutcome.casualties` (unit/deltaBand) so a fabricated spend in a
// shape-valid paste is visible to the human before it ever reaches the resolver
// (threat T-03-07). The confirm step is the player's final authority over counts
// (PROJECT.md Key Decision: confirm step ON).
//
// PURE projection of a validated envelope; reads envelope only, mutates/derives
// nothing stored; NO Svelte/idb/valibot (CORE-02). The rows are DERIVED from the
// envelope on every call — no cached count can desync from the ledger (LEDGER-02,
// threat T-03-08). The Svelte panel that renders these rows and the disable toggle
// `$state` land in Phase 5; this is the engine half.

import type { MoveEnvelope } from './envelope';

/**
 * One glanceable confirm-step row. A discriminated union on `kind`:
 *   - `expend`   — a consumable the paste claims to spend: `item` × `qty`.
 *   - `casualty` — a proposed strength loss: `unit` drops by `deltaBand` 25-pt bands
 *                  (negative; the §5.4 frame uses −1, −3).
 * Both carry the `actor`/`side` of the originating action so the view groups by who.
 */
export type ConfirmRow =
	| { kind: 'expend'; actor: string; side: string; item: string; qty: number }
	| { kind: 'casualty'; actor: string; side: string; unit: string; deltaBand: number };

/**
 * `confirmDiff(envelope)` — project a validated envelope into confirm rows.
 *
 * Iterates `[...playerActions, ...enemyActions]` in a SINGLE pass (the validate.ts:68
 * idiom) so BLUE and RED actions are surfaced identically. Per action it pushes one
 * `expend` row per `expend` entry and one `casualty` row per
 * `proposedOutcome?.casualties` entry, carrying the action's `actor`/`side`.
 *
 * Pure: builds and returns a FRESH array; stores nothing, caches no count, mutates
 * neither the envelope nor any module state (LEDGER-02 — derived, never stored).
 */
export function confirmDiff(envelope: MoveEnvelope): ConfirmRow[] {
	const rows: ConfirmRow[] = [];

	for (const action of [...envelope.playerActions, ...envelope.enemyActions]) {
		for (const e of action.expend) {
			// D: a qty <= 0 expend never surfaces a confirm row — a `frag ×0` (benign
			// "spend nothing") or a `frag ×-1` (rejected anomaly) row would mislead the
			// player about a real spend. confirmDiff shows only positive spends.
			if (e.qty <= 0) continue;
			rows.push({
				kind: 'expend',
				actor: action.actor,
				side: action.side,
				item: e.item,
				qty: e.qty
			});
		}
		for (const c of action.proposedOutcome?.casualties ?? []) {
			rows.push({
				kind: 'casualty',
				actor: action.actor,
				side: action.side,
				unit: c.unit,
				deltaBand: c.deltaBand
			});
		}
	}

	return rows;
}

/**
 * The confirm gate defaults ON (ORDER-02). The orchestrator/UI may disable it once
 * the parse is trusted (ORDER-03) by skipping the gate — that disable is a UI
 * `$state` boolean (Phase 5) which initializes from THIS constant. No Svelte `$state`
 * lives here (engine purity, CORE-02): this is just the default the gate reads.
 */
export const CONFIRM_DEFAULT_ON = true;
