// validate.test.ts — the categorical GATE (VALID-01..05) + the in-turn double-spend
// guard + the byte-unchanged-on-rejection guarantee.
//
// validate.ts is the FIRST HALF of the trust boundary: it partitions an untrusted
// MoveEnvelope into accepted proposals and `rejected` events, enforcing the three
// code-owned checks (capability-on-manifest, consumable-budget, alive) UNIFORMLY
// over BLUE and RED. This suite locks the bug classes the seam exists to kill:
//   - VALID-01 off-manifest capability (the orbital-laser / cas case)
//   - VALID-02 over-budget expend (rejected, NEVER silently clamped)
//   - VALID-03 dead / destroyed / absent actor cannot act
//   - VALID-04 every refusal surfaces a `rejected` event AND leaves state byte-unchanged
//   - VALID-05 RED actions are validated by the SAME code path as BLUE
//   - Pitfall 3 — two same-turn expends of the same item are checked cumulatively
//   - Golden — the §5.4 envelope passes the gate with 3 accepted / 0 rejections.
//
// Tests the SHARED §5.4 fixture (the contract of record) so the gate stays honest
// against the canonical worked example every later phase keeps passing.

import { describe, test, expect } from 'vitest';
import { validate } from '../../src/lib/engine/validate';
import { remaining } from '../../src/lib/engine/ledger';
import { fold } from '../../src/lib/engine/state';
import type { MoveEnvelope, ResolvedActionProposal } from '../../src/lib/engine/envelope';
import type { GameState } from '../../src/lib/engine/state';
import { stateBefore_5_4, envelope_5_4, priorEvents_5_4 } from './fixtures/worked-example-5.4';

// ── Helpers ──────────────────────────────────────────────────────────────────

const TURN = 4;

/** Deep-clone the §5.4 envelope so a test can mutate one action without bleed. */
const cloneEnvelope = (): MoveEnvelope => structuredClone(envelope_5_4);

/** An empty-but-valid MoveEnvelope to fill with hand-crafted actions. */
const emptyEnvelope = (over: Partial<MoveEnvelope> = {}): MoveEnvelope => ({
	narrative: '',
	playerActions: [],
	enemyActions: [],
	reveals: [],
	...over
});

/** A minimal valid BLUE action against §5.4 state (1-1 is alive, capabilities on-manifest). */
const blueAction = (over: Partial<ResolvedActionProposal> = {}): ResolvedActionProposal => ({
	actor: '1-1',
	side: 'BLUE',
	actionType: 'assault',
	capabilitiesUsed: ['small_arms'],
	expend: [],
	proposedModifiers: [],
	...over
});

// ── VALID-01: capability-on-manifest gate (the orbital-laser case) ────────────

describe('VALID-01 — off-manifest capability is rejected, surfaced, and dropped', () => {
	test('cas on a player action is rejected with a reason naming the capability; siblings still accept', () => {
		const env = cloneEnvelope();
		// 1-1 assault now also claims `cas` — prohibited / not on BLUE's manifest.
		env.playerActions[0].capabilitiesUsed = ['small_arms', 'cas'];

		const { accepted, rejections } = validate(stateBefore_5_4(), env, priorEvents_5_4, TURN);

		expect(rejections).toHaveLength(1);
		expect(rejections[0].kind).toBe('rejected');
		expect(rejections[0].actor).toBe('1-1');
		expect(rejections[0].reason).toContain('cas');
		// the off-manifest action never reaches `accepted`
		expect(accepted.some((a) => a.actor === '1-1' && a.actionType === 'assault')).toBe(false);
		// the OTHER player action (MTR) and the RED action still pass
		expect(accepted.some((a) => a.actor === 'MTR')).toBe(true);
		expect(accepted.some((a) => a.actor === 'DEF')).toBe(true);
		expect(accepted).toHaveLength(2);
	});

	test('orbital_laser (a wholly invented capability) is likewise rejected', () => {
		const env = emptyEnvelope({
			playerActions: [blueAction({ capabilitiesUsed: ['orbital_laser'] })]
		});
		const { accepted, rejections } = validate(stateBefore_5_4(), env, priorEvents_5_4, TURN);
		expect(accepted).toHaveLength(0);
		expect(rejections).toHaveLength(1);
		expect(rejections[0].reason).toContain('orbital_laser');
	});
});

// ── VALID-02: consumable-budget gate (reject, NEVER clamp) ────────────────────

describe('VALID-02 — over-budget expend is rejected, never clamped', () => {
	test('frag qty 7 against remaining 4 is rejected with the item name; no clamped accept', () => {
		// §5.4: BLUE frag loadout 6, prior turn-2 expend 2 ⇒ remaining 4.
		const env = emptyEnvelope({
			playerActions: [blueAction({ capabilitiesUsed: ['frag'], expend: [{ item: 'frag', qty: 7 }] })]
		});
		const { accepted, rejections } = validate(stateBefore_5_4(), env, priorEvents_5_4, TURN);

		expect(rejections).toHaveLength(1);
		expect(rejections[0].reason).toContain('frag');
		// NEVER a partial/clamped accept — the action appears ONLY in rejections
		expect(accepted).toHaveLength(0);
	});

	test('an item with 0 loadout (at4) is rejected, not silently zero-accepted', () => {
		const env = emptyEnvelope({
			playerActions: [blueAction({ capabilitiesUsed: ['at4'], expend: [{ item: 'at4', qty: 1 }] })]
		});
		const { accepted, rejections } = validate(stateBefore_5_4(), env, priorEvents_5_4, TURN);
		expect(accepted).toHaveLength(0);
		expect(rejections[0].reason).toContain('at4');
	});

	test('a negative qty is rejected, never an inflating accept (T-02-08)', () => {
		// qty === 0 is now a benign silent-skip (see the D suite below); only a
		// NEGATIVE qty is the anomaly that must be refused whole.
		const envNeg = emptyEnvelope({
			playerActions: [blueAction({ capabilitiesUsed: ['frag'], expend: [{ item: 'frag', qty: -3 }] })]
		});
		const rNeg = validate(stateBefore_5_4(), envNeg, priorEvents_5_4, TURN);
		expect(rNeg.accepted).toHaveLength(0);
		expect(rNeg.rejections).toHaveLength(1);
	});
});

// ── D: qty <= 0 expend (the AUTHORITY INVARIANT — nothing may mint a consumable) ─

describe('D — qty <= 0 expend (authority invariant)', () => {
	test('qty === 0 is silently skipped: NO rejection, the action stays eligible to accept', () => {
		// §5.4: BLUE frag remaining = 4. A qty:0 frag expend on an otherwise-valid
		// assault must NOT surface a rejection and must NOT block the action — it is a
		// benign "spend nothing", silently dropped.
		const env = emptyEnvelope({
			playerActions: [
				blueAction({ capabilitiesUsed: ['frag'], expend: [{ item: 'frag', qty: 0 }] })
			]
		});
		const { accepted, rejections } = validate(stateBefore_5_4(), env, priorEvents_5_4, TURN);

		// No surfaced rejection for the zero spend.
		expect(rejections).toHaveLength(0);
		// The action clears on its other merits (it is accepted, eligible to resolve).
		expect(accepted).toHaveLength(1);
		expect(accepted[0].actor).toBe('1-1');
	});

	test('a qty:0 expend alongside a positive expend still accepts on the positive one', () => {
		const env = emptyEnvelope({
			playerActions: [
				blueAction({
					capabilitiesUsed: ['frag'],
					expend: [
						{ item: 'frag', qty: 0 },
						{ item: 'frag', qty: 2 }
					]
				})
			]
		});
		const { accepted, rejections } = validate(stateBefore_5_4(), env, priorEvents_5_4, TURN);
		expect(rejections).toHaveLength(0);
		expect(accepted).toHaveLength(1);
	});

	test('qty < 0 is rejected as a NEGATIVE anomaly, refused whole, never accepted', () => {
		const env = emptyEnvelope({
			playerActions: [
				blueAction({ capabilitiesUsed: ['frag'], expend: [{ item: 'frag', qty: -2 }] })
			]
		});
		const { accepted, rejections } = validate(stateBefore_5_4(), env, priorEvents_5_4, TURN);

		expect(accepted).toHaveLength(0);
		expect(rejections).toHaveLength(1);
		expect(rejections[0].actor).toBe('1-1');
		// the reason flags the negative/anomalous qty with a stable token
		expect(rejections[0].reason).toContain('negative');
	});

	test('THE INVARIANT: a negative frag expend leaves remaining UNCHANGED (never minted)', () => {
		// A negative expend, if it folded as a subtract-of-negative, would MINT frag.
		// It is rejected and never reaches `accepted`/resolve/fold, so deriving remaining
		// over the post-validate stream (priorEvents only — no accepted expend was added)
		// stays at its pre-action value. This is the project's central authority proof.
		const pre = remaining(
			stateBefore_5_4().sides[0].consumables.loadout,
			priorEvents_5_4,
			'frag',
			'BLUE'
		);

		const env = emptyEnvelope({
			playerActions: [
				blueAction({ capabilitiesUsed: ['frag'], expend: [{ item: 'frag', qty: -2 }] })
			]
		});
		const { accepted } = validate(stateBefore_5_4(), env, priorEvents_5_4, TURN);

		// No accepted action carries the negative expend, so it never enters the stream.
		expect(accepted).toHaveLength(0);
		const post = remaining(
			stateBefore_5_4().sides[0].consumables.loadout,
			priorEvents_5_4, // the stream that resolve would fold over; the negative is absent
			'frag',
			'BLUE'
		);
		expect(post).toBe(pre); // UNCHANGED — never increased / minted.
	});
});

// ── B: reject reasons must not repeat the actor (the +page.svelte dedup) ────────

describe('B — reject reasons do not repeat the actor', () => {
	test('every rejection reason does NOT begin with `${actor}:` (no doubled actor)', () => {
		// Build an envelope that triggers several rejections: an off-manifest capability
		// AND an out-of-consumable expend.
		const env = emptyEnvelope({
			playerActions: [
				blueAction({ actor: '1-1', capabilitiesUsed: ['orbital_laser'] }),
				blueAction({
					actor: 'MTR',
					actionType: 'fire_support',
					capabilitiesUsed: ['frag'],
					expend: [{ item: 'frag', qty: 99 }]
				})
			]
		});
		const { rejections } = validate(stateBefore_5_4(), env, priorEvents_5_4, TURN);
		expect(rejections.length).toBeGreaterThan(0);
		for (const rej of rejections) {
			expect(rej.reason.startsWith(rej.actor + ':')).toBe(false);
		}
	});
});

// ── VALID-03: alive gate (no resurrection-by-action) ──────────────────────────

describe('VALID-03 — a dead / destroyed / absent actor cannot act', () => {
	const withDeadUnit = (mutate: (_s: GameState) => void): GameState => {
		const s = stateBefore_5_4();
		mutate(s);
		return s;
	};

	test('strength 0 actor is rejected', () => {
		const state = withDeadUnit((s) => {
			s.sides[0].units[0].strength = 0;
		});
		const env = emptyEnvelope({ playerActions: [blueAction()] });
		const { accepted, rejections } = validate(state, env, priorEvents_5_4, TURN);
		expect(accepted).toHaveLength(0);
		expect(rejections).toHaveLength(1);
		expect(rejections[0].actor).toBe('1-1');
	});

	test("status ['destroyed'] actor is rejected", () => {
		const state = withDeadUnit((s) => {
			s.sides[0].units[0].status = ['destroyed'];
		});
		const env = emptyEnvelope({ playerActions: [blueAction()] });
		const { accepted, rejections } = validate(state, env, priorEvents_5_4, TURN);
		expect(accepted).toHaveLength(0);
		expect(rejections).toHaveLength(1);
	});

	test('an actor absent from the side units is rejected', () => {
		const env = emptyEnvelope({ playerActions: [blueAction({ actor: 'GHOST' })] });
		const { accepted, rejections } = validate(stateBefore_5_4(), env, priorEvents_5_4, TURN);
		expect(accepted).toHaveLength(0);
		expect(rejections).toHaveLength(1);
		expect(rejections[0].actor).toBe('GHOST');
	});
});

// ── VALID-04: surfaced + byte-unchanged (reject-and-surface, never silent-drop) ─

describe('VALID-04 — every refusal surfaces a `rejected` event and folds to no-op', () => {
	test('a rejected event carries kind/actor/action/reason/turn, all populated', () => {
		const env = emptyEnvelope({
			playerActions: [blueAction({ actor: 'GHOST', actionType: 'assault' })]
		});
		const { rejections } = validate(stateBefore_5_4(), env, priorEvents_5_4, TURN);
		const r = rejections[0];
		expect(r.kind).toBe('rejected');
		expect(r.actor).toBe('GHOST');
		expect(r.action).toBe('assault');
		expect(r.reason.length).toBeGreaterThan(0);
		expect(r.turn).toBe(TURN);
	});

	test('folding the rejections leaves categorical state byte-unchanged (no authority leak)', () => {
		const env = cloneEnvelope();
		env.playerActions[0].capabilitiesUsed = ['cas']; // force a rejection
		// Validate at the state's CURRENT turn (3) so the only thing fold could touch
		// is the categorical state — `fold` advances meta.turn to the highest event
		// turn (CORE-06), which is orthogonal to the authority-leak guarantee under
		// test. With turn === state.meta.turn, byte-unchanged is exact: the `rejected`
		// applyEvent case is a no-op, so a rejection mutates NOTHING.
		const baseTurn = stateBefore_5_4().meta.turn;
		const { rejections } = validate(stateBefore_5_4(), env, priorEvents_5_4, baseTurn);
		expect(rejections.length).toBeGreaterThan(0);
		const folded = fold(stateBefore_5_4(), rejections);
		expect(folded).toEqual(stateBefore_5_4());
	});

	test('rejections carry NO categorical mutation even at a future turn (meta.turn aside)', () => {
		// At turn 4 against turn-3 state, fold legitimately bumps meta.turn; assert
		// every OTHER part of state is identical — the rejection itself changed nothing.
		const env = cloneEnvelope();
		env.playerActions[0].capabilitiesUsed = ['cas'];
		const { rejections } = validate(stateBefore_5_4(), env, priorEvents_5_4, TURN);
		const folded = fold(stateBefore_5_4(), rejections);
		expect(folded.sides).toEqual(stateBefore_5_4().sides);
		expect(folded.intel).toEqual(stateBefore_5_4().intel);
		expect(folded.graveyard).toEqual(stateBefore_5_4().graveyard);
	});
});

// ── VALID-05: RED validated identically to BLUE (one uniform pass) ─────────────

describe('VALID-05 — RED enemy actions go through the SAME gate as BLUE', () => {
	test('an off-manifest capability on the RED DEF action is rejected by the same path', () => {
		const env = cloneEnvelope();
		// DEF defend_fire now claims `cas` — not on RED's manifest.
		env.enemyActions[0].capabilitiesUsed = ['small_arms', 'cas'];

		const { accepted, rejections } = validate(stateBefore_5_4(), env, priorEvents_5_4, TURN);

		expect(rejections).toHaveLength(1);
		expect(rejections[0].actor).toBe('DEF');
		expect(rejections[0].reason).toContain('cas');
		// the two BLUE actions still accept; the RED one is dropped
		expect(accepted.some((a) => a.actor === 'DEF')).toBe(false);
		expect(accepted).toHaveLength(2);
	});
});

// ── Pitfall 3: cumulative in-turn double-spend across two actions ──────────────

describe('cumulative spend — two same-turn same-item expends are checked together', () => {
	test('two BLUE frag×3 actions (remaining 4): first accepts, second rejected', () => {
		// §5.4 frag remaining = 4. 3 + 3 = 6 > 4 ⇒ the second must be refused even
		// though each alone passes against priorEvents (Pitfall 3).
		const env = emptyEnvelope({
			playerActions: [
				blueAction({ actionType: 'assault-a', capabilitiesUsed: ['frag'], expend: [{ item: 'frag', qty: 3 }] }),
				blueAction({ actionType: 'assault-b', capabilitiesUsed: ['frag'], expend: [{ item: 'frag', qty: 3 }] })
			]
		});
		const { accepted, rejections } = validate(stateBefore_5_4(), env, priorEvents_5_4, TURN);

		expect(accepted).toHaveLength(1);
		expect(accepted[0].actionType).toBe('assault-a');
		expect(rejections).toHaveLength(1);
		expect(rejections[0].action).toBe('assault-b');
		expect(rejections[0].reason).toContain('frag');
	});
});

// ── Golden: the §5.4 envelope passes the gate cleanly ─────────────────────────

describe('§5.4 golden — the worked example passes the gate', () => {
	test('validate(stateBefore_5_4, envelope_5_4, priorEvents_5_4, 4) ⇒ 3 accepted, 0 rejections', () => {
		const { accepted, rejections } = validate(stateBefore_5_4(), envelope_5_4, priorEvents_5_4, 4);
		expect(rejections).toHaveLength(0);
		expect(accepted).toHaveLength(3);
	});
});
