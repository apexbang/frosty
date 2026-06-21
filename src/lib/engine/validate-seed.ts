// validate-seed.ts — the pure SEED WELL-FORMEDNESS gate (legality + coherence ONLY;
// SCEN-03 / SCEN-04). The DOMAIN half of the load trust boundary (the SHAPE half is
// valibot's `validateSaveEnvelope`, already crossed upstream in load.ts).
//
// A seed (a turn-0 scenario, an AI-generated paste, a resumed save) crosses HERE before
// it can boot. `validateSeed` enforces two manifest-internal categorical invariants and
// NOTHING about balance/winnability/plausibility (SCEN-04 — a guerrilla legally fielding
// `close_air_support` is ACCEPTED; the validator never judges the force):
//   (1) PROHIBITED CONFLICT (the NEW check, D-02) — no capability may sit in BOTH a side's
//       allow-set (organicAssets ∪ supportingAssets) AND that side's `prohibited`. A seed
//       that both fields and forbids the same capability is internally contradictory.
//   (2) COHERENT REFERENCE — every capability a side's `consumables.loadout` references
//       resolves into that side's allow-set. A loadout for a capability the side does not
//       field is an incoherent reference (the validate.ts:101 membership family, reused).
//
// It returns a discriminated `SeedResult` and NEVER throws — TOTAL over every shape-valid
// input (the DoS mitigation, T-09A-02; a bad seed is a recoverable reject, not a crash).
// The reason string is human-readable and NAMES the offending capability so the load
// boundary can surface a clear at-load rejection ("never three turns later").
//
// SCOPE (SCEN-04): legality/coherence ONLY. It reads manifests + loadout keys; it does NOT
// parse `objectives` prose, does NOT invent action-level checks (turn 0 has no actions),
// and does NOT judge whether a force is balanced/winnable/plausible.
//
// PURITY (CORE-02): TYPE-ONLY engine imports (GameState / Side from ./state); no value
// imports, no dice / clock / Date.now / Math.random / crypto, mutates NOTHING. NO Svelte /
// idb / valibot (valibot already crossed the SHAPE gate upstream — this domain validator
// needs none). Mirrors the validate.ts:1-25 purity header + the Result<T> never-throw idiom.

import type { GameState, Side } from './state';

/**
 * The result of crossing the seed well-formedness gate — a recoverable discriminated union
 * following the `Result<T>` idiom (envelope-schema.ts:95), NEVER a throw. The reject arm
 * carries a human-readable `reason` that NAMES the offending capability so the caller can
 * surface a clear at-load message (the load boundary maps it to `reason: 'illegal-seed'`).
 */
export type SeedResult = { ok: true } | { ok: false; reason: string };

/** A side's whole capability allow-set — organic ∪ supporting (reuses validate.ts:101). */
function allowSet(side: Side): Set<string> {
	return new Set([...side.manifest.organicAssets, ...side.manifest.supportingAssets]);
}

/**
 * `validateSeed(state)` — the seed well-formedness gate (SCEN-03 / SCEN-04). For EACH side:
 *
 *   (1) PROHIBITED CONFLICT — any capability in BOTH the allow-set and `prohibited` is a
 *       rejection naming that capability (the NEW check).
 *   (2) COHERENT REFERENCE — any `loadout` key NOT in the allow-set is a rejection naming
 *       that capability (a loadout for a capability the side does not field).
 *
 * First failure wins (one clear reason). All sides pass ⇒ `{ ok: true }`. TOTAL: never
 * throws. Legality/coherence ONLY — it judges nothing about plausibility (SCEN-04).
 */
export function validateSeed(state: GameState): SeedResult {
	for (const side of state.sides) {
		const allowed = allowSet(side);

		// (1) PROHIBITED CONFLICT (D-02) — a capability cannot be both fielded and forbidden.
		//     The reason names the side + the conflicting capability; `SeedResult` has no
		//     actor field, so naming the side here is the single actor source (NOTE B — no
		//     double-prefix, because no other field carries the actor).
		const conflict = side.manifest.prohibited.find((cap) => allowed.has(cap));
		if (conflict !== undefined) {
			return {
				ok: false,
				reason: `${side.id} manifest lists ${conflict} as both available and prohibited`
			};
		}

		// (2) COHERENT REFERENCE — every loadout key must resolve into the allow-set. A
		//     consumable for a capability the side does not field is an incoherent reference.
		const unresolved = Object.keys(side.consumables.loadout).find((item) => !allowed.has(item));
		if (unresolved !== undefined) {
			return {
				ok: false,
				reason: `${side.id} loadout references ${unresolved}, which is not in its manifest`
			};
		}
	}

	return { ok: true };
}
