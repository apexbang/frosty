// dice.ts — the neutral dice primitive (a pure, framework-free LEAF module).
//
// "Code owns the dice; the AI never rolls." This module is the structural answer
// to author bias creeping in at the one place it historically did — the roll.
//
// Three guarantees, all auditable and all tested in dice.test.ts:
//   1. FAIRNESS (DICE-01): each d6 draws a byte from crypto.getRandomValues and
//      REJECTION-SAMPLES (reject bytes >= 252) so there is no modulo bias. The
//      non-neutral JS RNG is banned (CLAUDE.md "What NOT to Use"); platform
//      crypto entropy only.
//   2. UNSHADEABLE RESOLUTION (DICE-02): net modifiers are summed and clamped to
//      [-3,+3] and itemized into the dice payload BEFORE the band is read. The
//      band is computed LAST, from the pre-committed clamped net — nothing can be
//      tuned after the fact to swing a result.
//   3. NO REROLLS (DICE-03): one roll per call. There is deliberately NO retry /
//      reroll / "try again" path — that would destroy pre-committed integrity.
//
// PURITY (CORE-02): imports NOTHING from Svelte / SvelteKit / idb / valibot. The
// only dependency is the platform `crypto.getRandomValues` and the OutcomeBand /
// dice-event types from events.ts (the engine leaf). [CITED: spec.md §6.3,
// RESEARCH Pattern 3, CLAUDE.md authority rule.]

import type { OutcomeBand, GameEvent } from './events';

/** A single net-modifier line item (label + signed value), as carried in the dice event. */
export type Modifier = { label: string; value: number };

/** The pre-committed dice payload — exactly the `dice` variant of GameEvent (events.ts). */
export type DicePayload = Extract<GameEvent, { kind: 'dice' }>;

/**
 * Draw one fair d6 in [1,6] from neutral platform entropy.
 *
 * 256 = 6*42 + 4, so the largest multiple of 6 that is <= 256 is 252. Bytes in
 * 252..255 map unevenly under `% 6` and are the source of modulo bias — so we
 * REJECT them and redraw. Over many draws every face lands within ~1% of 1/6
 * (VERIFIED: 16.651%–16.684% per face over 6M draws, RESEARCH Pattern 3).
 *
 * Crypto entropy only — the non-neutral JS RNG is forbidden. One byte,
 * rejection-sampled. [CITED: RESEARCH Pattern 3, PITFALLS #8.]
 */
export function d6(): number {
	const buf = new Uint8Array(1);
	do {
		crypto.getRandomValues(buf);
	} while (buf[0] >= 252); // reject 252..255 — kills modulo bias
	return (buf[0] % 6) + 1;
}

/** Roll two independent fair d6 — each in [1,6]. (No rerolls; one draw per die.) */
export function roll2d6(): [number, number] {
	return [d6(), d6()];
}

/**
 * Sum the modifier values and clamp the net to [-3, +3] — the ±3 authority bound
 * (spec §6.3, CLAUDE.md authority rule). The clamp is applied HERE, before the
 * band is ever read, so modifiers can never be shaded past ±3 to swing a result.
 *
 *   clampNet([{value:+2},{value:-1}]) === 1
 *   clampNet(sum +6) === 3   (clamped at the ceiling)
 *   clampNet(sum -6) === -3  (clamped at the floor)
 */
export function clampNet(modifiers: Modifier[]): number {
	const sum = modifiers.reduce((s, m) => s + m.value, 0);
	return Math.max(-3, Math.min(3, sum));
}

/**
 * Read the outcome band from `total = 2d6 + net` (total ∈ [-1, 15]).
 *
 *   total >= 10 -> success_clean
 *   total >=  7 -> success_costly
 *   total >=  5 -> stalled
 *   total <=  4 -> failure
 *
 * (spec §6.3 band table.) Exact at every boundary — see dice.test.ts.
 */
export function band(total: number): OutcomeBand {
	if (total >= 10) return 'success_clean';
	if (total >= 7) return 'success_costly';
	if (total >= 5) return 'stalled';
	return 'failure'; // <= 4
}

/**
 * Roll one contest and build the PRE-COMMITTED dice payload (the `dice` event).
 *
 * Ordering discipline (spec §6.3) — the whole point of this function:
 *   1. draw the dice (roll2d6),
 *   2. sum + clamp the modifiers (clampNet),  ← itemized + bounded BEFORE band
 *   3. build the payload and compute `band` LAST, from roll-sum + the clamped net.
 *
 * Because `band` is read from the net that is already itemized in the payload,
 * the result is unshadeable: there is no point at which a modifier could be tuned
 * after the band is known. One roll, no reroll path.
 */
export function roll(actor: string, modifiers: Modifier[], turn: number): DicePayload {
	const dice = roll2d6();
	const net = clampNet(modifiers); // clamp BEFORE band (pre-commit)
	return {
		kind: 'dice',
		actor,
		roll: dice,
		modifiers,
		net,
		band: band(dice[0] + dice[1] + net), // band computed LAST, from the clamped net
		turn
	};
}
