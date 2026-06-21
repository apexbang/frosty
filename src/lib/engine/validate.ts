// validate.ts — the pure CATEGORICAL GATE (the first half of the trust boundary,
// spec §6.2; VALID-01..05).
//
// The AI-authored `MoveEnvelope` crosses into the engine HERE. validate partitions
// every action — BLUE and RED alike, in ONE uniform pass (VALID-05) — into accepted
// proposals and `rejected` events. It enforces the three code-owned, categorical
// checks the AI's prose has zero authority over:
//   (1) ALIVE        — a strength-0 / 'destroyed' / absent actor cannot act (VALID-03);
//   (2) CAPABILITY   — a capability not on organicAssets∪supportingAssets is denied
//                      (VALID-01 — the orbital-laser / cas bug class);
//   (3) CONSUMABLE   — an expend exceeding the DERIVED remaining (cumulative within
//                      the turn) is rejected, NEVER silently clamped (VALID-02), and a
//                      non-positive qty is refused (T-02-08).
//
// Every refusal SURFACES a `rejected` event carrying actor/action/reason/turn —
// reject-and-surface, never silent-drop (VALID-04). Because `fold`'s `rejected`
// case is a no-op, folding the rejections leaves state byte-unchanged (the
// authority-leak guard).
//
// PURE: reads `state` and the event stream, mutates NOTHING; no dice, no clock, no
// Date.now / Math.random / crypto — this module is purely categorical (the dice and
// the clock belong to resolve.ts). NO Svelte / idb / valibot import (CLAUDE.md
// engine-purity rule, CORE-02). Full numeric/shape validation of the untrusted JSON
// is Phase 3 (valibot at the ClipboardNarrator boundary); here `qty` is treated
// defensively as untrusted.

import type { GameState } from './state';
import type { GameEvent } from './events';
import type { MoveEnvelope, ResolvedActionProposal } from './envelope';
import { remaining } from './ledger';

/** The `rejected` arm of the GameEvent union — single-sourced, not re-declared. */
type Rejected = Extract<GameEvent, { kind: 'rejected' }>;

export interface ValidationResult {
	/** Actions that cleared all three gates — eligible to reach resolve.ts. */
	accepted: ResolvedActionProposal[];
	/** One `rejected` event per refused action (reject-and-surface, VALID-04). */
	rejections: Rejected[];
}

/**
 * `validate(state, envelope, priorEvents, turn)` — partition the untrusted envelope.
 *
 * Iterates `[...playerActions, ...enemyActions]` in a SINGLE loop so RED is gated
 * identically to BLUE (VALID-05). For each action the three gates run in order and
 * the FIRST failure pushes a `rejected` event and skips the action — an action
 * reaches `accepted` only when ALL gates pass and ALL its expends fit the running
 * (cumulative) per-side/item budget. Over-budget expends are rejected whole, never
 * clamped to a partial spend.
 *
 * Pure: never mutates `state`, never rolls dice, never touches the clock.
 */
export function validate(
	state: GameState,
	envelope: MoveEnvelope,
	priorEvents: GameEvent[],
	turn: number
): ValidationResult {
	const accepted: ResolvedActionProposal[] = [];
	const rejections: Rejected[] = [];

	// Running per-side/item tally of accepted-so-far expends THIS turn. Keyed
	// `${side}:${item}` so two same-turn expends of the same item are checked
	// against the running remainder, not just priorEvents (Pitfall 3 / T-02-05).
	const spentThisTurn = new Map<string, number>();

	for (const action of [...envelope.playerActions, ...envelope.enemyActions]) {
		const side = state.sides.find((s) => s.id === action.side);
		const unit = side?.units.find((u) => u.id === action.actor);

		const reject = (reason: string): void => {
			rejections.push({
				kind: 'rejected',
				actor: action.actor,
				action: action.actionType,
				reason,
				turn
			});
		};

		// An action against an unknown side cannot be gated at all — refuse it.
		// NOTE (B): reason strings carry NO `${actor}:` prefix — the rejected event's
		// `actor` field is the single actor source, and the UI renders it once
		// (`{rej.actor}: {rej.reason}`). A prefix here would double the actor.
		if (!side) {
			reject(`unknown side ${action.side}`);
			continue;
		}

		// (1) ALIVE (VALID-03) — no resurrection-by-action. Absent, strength-0, or
		//     'destroyed' actors are categorically ineligible.
		if (!unit || unit.strength <= 0 || unit.status.includes('destroyed')) {
			reject(`destroyed/absent unit cannot act`);
			continue;
		}

		// (2) CAPABILITY (VALID-01) — organic ∪ supporting is the WHOLE allow-set;
		//     anything else (cas, orbital_laser, …) is denied. This is the
		//     orbital-laser bug class made structurally impossible.
		const allowed = new Set([...side.manifest.organicAssets, ...side.manifest.supportingAssets]);
		const offManifest = action.capabilitiesUsed.find((c) => !allowed.has(c));
		if (offManifest !== undefined) {
			reject(`${offManifest} not available`);
			continue;
		}

		// (3) CONSUMABLE (VALID-02) — reject (never clamp) any expend that does not
		//     fit the cumulative, side-scoped, DERIVED budget. The qty guard SPLITS
		//     (D, the authority invariant):
		//       - qty === 0 → benign "spend nothing": SILENTLY skipped. Not rejected,
		//         not tallied, does not block the action — it stays eligible on its
		//         other (positive) expends. valibot guarantees qty is a number at the
		//         paste boundary, so a 0 lands here, never `undefined`.
		//       - qty < 0  → incoherent ANOMALY (a negative expend would MINT a
		//         consumable). Refused WHOLE (reject + break) so it NEVER reaches
		//         `accepted`/resolve/fold and can never fold as a subtract-of-negative
		//         (CLAUDE.md Authority rule / LEDGER-02). "Clamp to zero" is satisfied
		//         structurally: the negative never folds at all.
		//     Probe all expends first; commit the running tally only if EVERY positive
		//     expend of this action passes.
		let short = false;
		for (const { item, qty } of action.expend) {
			if (qty === 0) continue; // silent skip — spend nothing, stay eligible.
			if (qty < 0) {
				reject(`negative expend qty ${qty} for ${item}`);
				short = true;
				break;
			}
			if (!(item in side.consumables.loadout)) {
				reject(`out of ${item}`);
				short = true;
				break;
			}
			const already = spentThisTurn.get(`${action.side}:${item}`) ?? 0;
			const have = remaining(side.consumables.loadout, priorEvents, item, action.side) - already;
			if (have < qty) {
				reject(`out of ${item}`);
				short = true;
				break;
			}
		}
		if (short) continue;

		// All gates passed — commit this action's POSITIVE expends to the running tally
		// so a later same-turn action sees the reduced remainder, then accept. A qty===0
		// expend contributes nothing (no decrement).
		for (const { item, qty } of action.expend) {
			if (qty <= 0) continue;
			const key = `${action.side}:${item}`;
			spentThisTurn.set(key, (spentThisTurn.get(key) ?? 0) + qty);
		}
		accepted.push(action); // VALID-05: RED reaches here by the same path as BLUE.
	}

	return { accepted, rejections };
}
