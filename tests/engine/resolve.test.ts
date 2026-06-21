// resolve.test.ts — the §5.4 END-TO-END GOLDEN + the per-REQ resolve suite.
//
// The golden frames the whole phase as one test: feed the §5.4 `MoveEnvelope` +
// `stateBefore_5_4()` through validate → resolveTurn (with a DETERMINISTIC injected
// roller so the [3,4] roll is reproducible) → fold, and assert the folded state IS
// `stateAfter_5_4` AND the derived ledger IS `remaining_after_5_4`. A wrongful
// `rejected` (T-02-02) diverges the folded state and fails the assertion — the
// golden cannot pass "by rejection".
//
// Plan 02-04 reconciles the Wave-1 scaffold call sites to the SHIPPED contracts:
//   validate(state, envelope, priorEvents, turn) → { accepted, rejections }
//   resolveTurn(state, accepted, reveals, turn, roller) → GameEvent[]
//
// PURITY: imports only engine modules + the shared fixture. No Svelte / idb / valibot.

import { describe, test, expect } from 'vitest';
import { fold } from '../../src/lib/engine/state';
import type { GameState } from '../../src/lib/engine/state';
import { remaining } from '../../src/lib/engine/ledger';
import type { GameEvent } from '../../src/lib/engine/events';
import type { DicePayload, Modifier } from '../../src/lib/engine/dice';
import { clampNet, band as bandOf } from '../../src/lib/engine/dice';
import type { MoveEnvelope, ResolvedActionProposal } from '../../src/lib/engine/envelope';
import { validate } from '../../src/lib/engine/validate';
import { resolveTurn, capDelta } from '../../src/lib/engine/resolve';
import {
	stateBefore_5_4,
	envelope_5_4,
	priorEvents_5_4,
	events_5_4,
	stateAfter_5_4,
	remaining_after_5_4
} from './fixtures/worked-example-5.4';

// ── Deterministic roller stub ────────────────────────────────────────────────
// The §5.4 contest is ONE roll: 2d6 = [3,4] = 7, attacker-frame net = +2 −1 = +1,
// total 8 → success_costly. `resolveTurn` accepts an injectable roller so the golden
// is reproducible without touching real Web Crypto entropy.
//
// WR-04 — the stub pins ONLY the dice faces ([3,4]); it DERIVES `net` and `band`
// from the modifiers it is actually handed, via the REAL `clampNet` / `band`. So it
// is no longer a tautology: if the resolver double-counted the defender's +1 (the
// Pitfall-2 bug), the stub would receive [+2,−1,+1] → net 2, and the golden's
// `net === 1` assertion would FAIL. With the correct initiator-only modifiers
// ([+2,−1]) it yields net 1, total 8 → success_costly, matching the §5.4 contract.
export function stubRoller(actor: string, modifiers: Modifier[], turn: number): DicePayload {
	const roll: [number, number] = [3, 4];
	const net = clampNet(modifiers); // summed + clamped from the FORWARDED modifiers
	return { kind: 'dice', actor, roll, modifiers, net, band: bandOf(roll[0] + roll[1] + net), turn };
}

/** A roller that pins a chosen band (and a representative roll) for the per-REQ blocks. */
function bandRoller(band: DicePayload['band']) {
	return (actor: string, modifiers: Modifier[], turn: number): DicePayload => ({
		kind: 'dice',
		actor,
		roll: [3, 3],
		modifiers,
		net: 0,
		band,
		turn
	});
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const unitById = (s: GameState, id: string) =>
	s.sides.flatMap((side) => side.units).find((u) => u.id === id);

/**
 * Compare emitted events to the §5.4 fixture on the CATEGORICAL fields (kind +
 * values + order). The `strength.reason` is descriptive narrative the resolver
 * derives generically (`"<actionType> casualties"`) — it never reaches folded state,
 * so the golden is authoritative on the OUTCOME, not on the prose of the reason.
 */
function categorical(e: GameEvent): unknown {
	if (e.kind === 'strength') {
		const { reason: _reason, ...rest } = e;
		return rest;
	}
	if (e.kind === 'expend') {
		const { reason: _reason, ...rest } = e;
		return rest;
	}
	if (e.kind === 'dice') {
		// The modifier LABEL is itemized prose (the resolver carries the envelope's exact
		// label, e.g. "enemy in prepared cover"; the fixture abbreviates it "enemy cover").
		// What is categorical is the VALUE / net / band / roll — assert those, not the prose.
		return { ...e, modifiers: e.modifiers.map((m) => m.value) };
	}
	return e;
}

// ── The §5.4 golden ──────────────────────────────────────────────────────────
describe('§5.4 golden — validate→resolveTurn→fold reproduces stateAfter_5_4', () => {
	const base = stateBefore_5_4();
	const { accepted, rejections } = validate(base, envelope_5_4, priorEvents_5_4, 4);
	const turnEvents = resolveTurn(base, accepted, envelope_5_4.reveals, 4, stubRoller);
	// The derived ledger sees prior history + this turn (the turn-2 frag expend).
	const fullStream = [...priorEvents_5_4, ...turnEvents];
	const after = fold(base, turnEvents);

	test('all three §5.4 actions are accepted (no wrongful rejection — T-02-02)', () => {
		expect(rejections).toEqual([]);
		expect(accepted).toHaveLength(3);
	});

	test('emitted events equal events_5_4 (same kinds/values/order)', () => {
		expect(turnEvents.map(categorical)).toEqual(events_5_4.map(categorical));
	});

	test('contest net === 1 (defender modifiers surfaced, not re-added — Pitfall 2)', () => {
		const dice = turnEvents.find((e) => e.kind === 'dice');
		expect(dice).toBeDefined();
		if (dice?.kind === 'dice') {
			// WR-04 — the stub DERIVES net from the modifiers it received (real clampNet),
			// so this is no longer the stub's hardcoded constant: net is 1 iff exactly the
			// initiator's [+2,−1] reached the roller. If DEF's +1 were re-added, net would
			// be 2 here and this fails.
			expect(dice.net).toBe(1);
			// And net must equal the clamped sum of the emitted modifier VALUES — locking
			// the summation arithmetic end-to-end (not just the stub's pinned number).
			expect(dice.net).toBe(clampNet(dice.modifiers));
		}
	});

	test('WR-05: the emitted dice carries the INITIATOR modifier set (labels + values)', () => {
		const dice = turnEvents.find((e) => e.kind === 'dice');
		expect(dice).toBeDefined();
		if (dice?.kind === 'dice') {
			// The golden's event-equality maps modifiers to bare values, which a resolver
			// that forwarded the WRONG set (same values, different labels) could still pass.
			// Assert the full forwarded set — labels AND values — IS the §5.4 initiator's
			// proposedModifiers, so the resolver is pinned to forward 1-1's set, not DEF's.
			expect(dice.modifiers).toEqual(envelope_5_4.playerActions[0].proposedModifiers);
			// And it must NOT carry the defender's "prepared position" modifier.
			expect(dice.modifiers.some((m) => m.label === 'prepared position')).toBe(false);
		}
	});

	test('every emitted event carries turn:4', () => {
		for (const e of turnEvents) expect(e.turn).toBe(4);
	});

	test('meta: turn 4, clock "D1 0720", phase consolidation', () => {
		expect(after.meta.turn).toBe(stateAfter_5_4.meta.turn);
		expect(after.meta.clock).toBe(stateAfter_5_4.meta.clock);
		expect(after.meta.phase).toBe(stateAfter_5_4.meta.phase);
	});

	test('1-1: strength 75, posture consolidating', () => {
		const u = unitById(after, '1-1')!;
		expect(u.strength).toBe(stateAfter_5_4.units['1-1'].strength);
		expect(u.posture).toBe(stateAfter_5_4.units['1-1'].posture);
	});

	test('MTR: strength 100 unchanged', () => {
		expect(unitById(after, 'MTR')!.strength).toBe(stateAfter_5_4.units.MTR.strength);
	});

	test('DEF: strength 25, morale broken, posture broken', () => {
		const u = unitById(after, 'DEF')!;
		expect(u.strength).toBe(stateAfter_5_4.units.DEF.strength);
		expect(u.morale).toBe(stateAfter_5_4.units.DEF.morale);
		expect(u.posture).toBe(stateAfter_5_4.units.DEF.posture);
	});

	test('derived ledger: frag 2, smoke 4 (canary), mortar_60mm 10, rpg 7', () => {
		const blue = after.sides.find((s) => s.id === 'BLUE')!;
		const red = after.sides.find((s) => s.id === 'RED')!;
		expect(remaining(blue.consumables.loadout, fullStream, 'frag', 'BLUE')).toBe(
			remaining_after_5_4.frag
		);
		expect(remaining(blue.consumables.loadout, fullStream, 'smoke', 'BLUE')).toBe(
			remaining_after_5_4.smoke
		);
		expect(remaining(blue.consumables.loadout, fullStream, 'mortar_60mm', 'BLUE')).toBe(
			remaining_after_5_4.mortar_60mm
		);
		expect(remaining(red.consumables.loadout, fullStream, 'rpg', 'RED')).toBe(
			remaining_after_5_4.rpg
		);
	});

	test('resolveTurn does not mutate the input state (CORE-03)', () => {
		const pristine = stateBefore_5_4();
		const local = stateBefore_5_4();
		resolveTurn(local, accepted, envelope_5_4.reveals, 4, stubRoller);
		expect(local).toEqual(pristine);
	});
});

// ── WR-02: contest pairing is side-aware (no actor-id collapse) ───────────────
describe('WR-02 — a cross-side duplicate actor id does not mis-pair the contest', () => {
	test('the contest binds 1-1↔DEF even when a same-id RED distractor exists later', () => {
		// Build a state where RED also fields a unit literally named '1-1' (a cross-side
		// id collision). The genuine contest is BLUE 1-1 ⇄ RED DEF. A bare actor-keyed
		// pairing map would collapse the two '1-1' entries (keeping the LAST = RED's),
		// so resolving DEF's opposes:'1-1' would bind to the wrong proposal and mis-pair
		// or drop the contest. The side-aware pairing must still bind BLUE 1-1 ⇄ RED DEF.
		const base = stateBefore_5_4();
		const red = base.sides.find((s) => s.id === 'RED')!;
		// RED fields a SECOND unit also named 'DEF' (a cross-action id collision). The
		// genuine defender is the real DEF that opposes 1-1; the distractor DEF is solo.
		red.units.push({
			id: 'DEF',
			type: 'decoy',
			strength: 100,
			morale: 'steady',
			supply: { ammo: 'high', fuel: 'high', rations: 'high', medical: 'high' },
			position: 'unknown',
			posture: 'staged',
			status: []
		});
		const env: MoveEnvelope = {
			narrative: '',
			playerActions: [
				{
					actor: '1-1',
					side: 'BLUE',
					actionType: 'assault',
					opposes: 'DEF',
					capabilitiesUsed: ['small_arms'],
					expend: [],
					proposedModifiers: [],
					proposedOutcome: { casualties: [{ unit: '1-1', deltaBand: -1 }] }
				}
			],
			enemyActions: [
				// The REAL defender — opposes 1-1, proposes its own −3.
				{
					actor: 'DEF',
					side: 'RED',
					actionType: 'defend_fire',
					opposes: '1-1',
					capabilitiesUsed: ['small_arms'],
					expend: [],
					proposedModifiers: [],
					proposedOutcome: { casualties: [{ unit: 'DEF', deltaBand: -3 }] }
				},
				// A LATER same-id 'DEF' distractor (solo, opposes nothing). A bare actor-keyed
				// map would overwrite the real defender with THIS entry; resolving 1-1's
				// opposes:'DEF' would then find a non-mutual action and DROP the contest,
				// leaving 1-1 to roll solo with no opposer. Side-aware pairing must still
				// bind 1-1 to the real (mutual) DEF.
				{
					actor: 'DEF',
					side: 'RED',
					actionType: 'reposition',
					capabilitiesUsed: ['small_arms'],
					expend: [],
					proposedModifiers: [],
					proposedOutcome: {}
				}
			],
			reveals: []
		};
		const { accepted } = validate(base, env, [], 4);
		const events = resolveTurn(base, accepted, [], 4, stubRoller); // success_costly
		// The contest must resolve as a mutual pair: BLUE 1-1 is the initiator and DEF the
		// opposer. With the bug, 1-1's opposes:'DEF' resolves to the non-mutual distractor,
		// the pair is dropped, and DEF takes NO casualty (stays 100). The side-aware fix
		// re-pairs 1-1 ⇄ the real DEF, so DEF takes the opposer −3 (→ 25).
		const after = fold(base, events);
		const redDefs = after.sides.find((s) => s.id === 'RED')!.units.filter((u) => u.id === 'DEF');
		// At least one DEF is driven to 25 by the contest (the real defender's −3).
		expect(redDefs.some((u) => u.strength === 25)).toBe(true);
	});
});

// ── DICE-04: single-roll contest, initiator frame ────────────────────────────
describe('DICE-04 — opposes pair resolves on ONE roll, initiator modifiers only', () => {
	const base = stateBefore_5_4();
	const { accepted } = validate(base, envelope_5_4, priorEvents_5_4, 4);

	test('exactly one dice event for the 1-1↔DEF contest', () => {
		const events = resolveTurn(base, accepted, [], 4, stubRoller);
		expect(events.filter((e) => e.kind === 'dice')).toHaveLength(1);
	});

	test('the roller receives the INITIATOR (1-1) modifiers only — not DEF’s +1', () => {
		const seen: { actor: string; modifiers: Modifier[] }[] = [];
		const spy = (actor: string, modifiers: Modifier[], turn: number): DicePayload => {
			seen.push({ actor, modifiers });
			return stubRoller(actor, modifiers, turn);
		};
		resolveTurn(base, accepted, [], 4, spy);
		expect(seen).toHaveLength(1);
		expect(seen[0].actor).toBe('1-1');
		// 1-1's two modifiers; DEF's "prepared position" +1 is NOT among them.
		expect(seen[0].modifiers).toEqual(envelope_5_4.playerActions[0].proposedModifiers);
		expect(seen[0].modifiers.some((m) => m.label === 'prepared position')).toBe(false);
	});
});

// ── WR-01: AI-authored morale must be outcome-coherent ────────────────────────
describe('WR-01 — a non-prevailing side cannot author a free morale recovery', () => {
	test('a broken DEF cannot be authored back to steady on a contest it did not win', () => {
		// DEF starts broken and the contest is `stalled` (neither side prevails). DEF
		// (opposer) authors moraleShift DEF → steady — a free recovery driven purely by
		// AI prose. The coherence guard refuses an IMPROVEMENT for the non-prevailing
		// side, so DEF stays broken; no improving morale event is emitted.
		function brokenDefBase(): GameState {
			const s = stateBefore_5_4();
			const def = s.sides.find((x) => x.id === 'RED')!.units.find((u) => u.id === 'DEF')!;
			def.morale = 'broken';
			return s;
		}
		const env: MoveEnvelope = {
			narrative: '',
			playerActions: [
				{
					actor: '1-1',
					side: 'BLUE',
					actionType: 'assault',
					opposes: 'DEF',
					capabilitiesUsed: ['small_arms'],
					expend: [],
					proposedModifiers: [],
					proposedOutcome: { casualties: [{ unit: '1-1', deltaBand: -1 }] }
				}
			],
			enemyActions: [
				{
					actor: 'DEF',
					side: 'RED',
					actionType: 'defend_fire',
					opposes: '1-1',
					capabilitiesUsed: ['small_arms'],
					expend: [],
					proposedModifiers: [],
					proposedOutcome: {
						casualties: [{ unit: 'DEF', deltaBand: -1 }],
						moraleShift: [{ unit: 'DEF', to: 'steady' }] // free recovery — must be refused
					}
				}
			],
			reveals: []
		};
		const base = brokenDefBase();
		const { accepted } = validate(base, env, [], 4);
		const events = resolveTurn(base, accepted, [], 4, bandRoller('stalled'));
		// No morale event improves DEF toward steady.
		const defImproved = events.some(
			(e) => e.kind === 'morale' && e.unit === 'DEF' && e.to === 'steady'
		);
		expect(defImproved).toBe(false);
		const after = fold(base, events);
		expect(unitById(after, 'DEF')!.morale).toBe('broken'); // recovery refused
	});

	test('a worsening authored morale shift on the loser still passes (only improvements are gated)', () => {
		// Same losing side, but the AI authors a WORSENING shift (steady → broken):
		// outcome-coherent, so it is applied normally.
		const env: MoveEnvelope = {
			narrative: '',
			playerActions: [
				{
					actor: '1-1',
					side: 'BLUE',
					actionType: 'assault',
					opposes: 'DEF',
					capabilitiesUsed: ['small_arms'],
					expend: [],
					proposedModifiers: [],
					proposedOutcome: { casualties: [{ unit: '1-1', deltaBand: -1 }] }
				}
			],
			enemyActions: [
				{
					actor: 'DEF',
					side: 'RED',
					actionType: 'defend_fire',
					opposes: '1-1',
					capabilitiesUsed: ['small_arms'],
					expend: [],
					proposedModifiers: [],
					proposedOutcome: {
						casualties: [{ unit: 'DEF', deltaBand: -1 }],
						moraleShift: [{ unit: 'DEF', to: 'broken' }] // worsening — allowed
					}
				}
			],
			reveals: []
		};
		const base = stateBefore_5_4();
		const { accepted } = validate(base, env, [], 4);
		const events = resolveTurn(base, accepted, [], 4, bandRoller('stalled'));
		const after = fold(base, events);
		expect(unitById(after, 'DEF')!.morale).toBe('broken'); // worsening applied
	});
});

// ── DICE-05: bounded, direction-sane deltas ──────────────────────────────────
describe('DICE-05 — capDelta bounds magnitude direction-sane (no resurrection)', () => {
	test('capDelta is negative-only: a positive proposed delta is a no-op', () => {
		expect(capDelta('failure', 'initiator', 2)).toBe(0);
		expect(capDelta('success_clean', 'opposer', 3)).toBe(0);
	});

	test('success_clean: the winning initiator takes NO own-casualties (a −2 → 0)', () => {
		expect(capDelta('success_clean', 'initiator', -2)).toBe(0);
		expect(capDelta('success_clean', 'opposer', -3)).toBe(-3); // opposer takes the full hit
	});

	test('success_costly caps the initiator at −1; opposer takes up to proposed (§5.4)', () => {
		expect(capDelta('success_costly', 'initiator', -3)).toBe(-1);
		expect(capDelta('success_costly', 'opposer', -3)).toBe(-3);
	});

	test('stalled caps both sides at −1; failure: initiator heavy, opposer ≤ −1', () => {
		expect(capDelta('stalled', 'initiator', -3)).toBe(-1);
		expect(capDelta('stalled', 'opposer', -3)).toBe(-1);
		expect(capDelta('failure', 'initiator', -3)).toBe(-3);
		expect(capDelta('failure', 'opposer', -3)).toBe(-1);
	});

	test('a success_clean contest emits NO own-loss strength event for the initiator', () => {
		// Initiator proposes a −2 own-casualty; the band clamps it to 0 → no strength event.
		const env: MoveEnvelope = {
			narrative: '',
			playerActions: [
				{
					actor: '1-1',
					side: 'BLUE',
					actionType: 'assault',
					opposes: 'DEF',
					capabilitiesUsed: ['small_arms'],
					expend: [],
					proposedModifiers: [],
					proposedOutcome: { casualties: [{ unit: '1-1', deltaBand: -2 }] }
				}
			],
			enemyActions: [
				{
					actor: 'DEF',
					side: 'RED',
					actionType: 'defend_fire',
					opposes: '1-1',
					capabilitiesUsed: ['small_arms'],
					expend: [],
					proposedModifiers: [],
					proposedOutcome: { casualties: [{ unit: 'DEF', deltaBand: -1 }] }
				}
			],
			reveals: []
		};
		const base = stateBefore_5_4();
		const { accepted } = validate(base, env, [], 4);
		const events = resolveTurn(base, accepted, [], 4, bandRoller('success_clean'));
		const oneOneStrength = events.find((e) => e.kind === 'strength' && e.unit === '1-1');
		expect(oneOneStrength).toBeUndefined(); // capped to 0 — no event emitted
	});
});

// ── Finding 3: a deltaBand:0-only action is a TRUE silent no-op (no roll, no strength) ─
describe('Finding 3 — a deltaBand:0-only casualty drops before the roll (silent no-op)', () => {
	test('a solo action whose only casualty is deltaBand:0 emits ZERO dice + no strength change', () => {
		// A solo (unpaired) BLUE action lists exactly one casualty against its own actor at
		// deltaBand:0 (no real loss, no opposed contest, no expend). With the cosmetic-roll
		// bug this still produced a `dice` event (and a misleading band) like the §5.4
		// unpaired MTR fire_support would if its casualty were non-empty. The Phase-6 filter
		// counts only deltaBand<0 casualties, so this action contests nothing → rolls no
		// dice, mutates no strength — a true silent no-op.
		const env: MoveEnvelope = {
			narrative: '',
			playerActions: [
				{
					actor: '1-1',
					side: 'BLUE',
					actionType: 'move',
					capabilitiesUsed: ['small_arms'],
					expend: [],
					proposedModifiers: [],
					proposedOutcome: { casualties: [{ unit: '1-1', deltaBand: 0 }] }
				}
			],
			enemyActions: [],
			reveals: []
		};
		const base = stateBefore_5_4();
		const { accepted } = validate(base, env, [], 4);
		const events = resolveTurn(base, accepted, [], 4, stubRoller);
		// ZERO dice events — the no-op never reaches the roll decision.
		expect(events.filter((e) => e.kind === 'dice')).toHaveLength(0);
		// And no strength event / no strength change for 1-1 (or anyone).
		expect(events.some((e) => e.kind === 'strength')).toBe(false);
		const after = fold(base, events);
		expect(unitById(after, '1-1')!.strength).toBe(stateBefore_5_4().sides
			.flatMap((s) => s.units)
			.find((u) => u.id === '1-1')!.strength);
	});
});

// ── CR-01: casualties are owner-gated, not authoring-action gated ─────────────
describe('CR-01 — a losing side cannot wound the winner via its own casualty entry', () => {
	test('opposer naming the winning initiator gets the INITIATOR cap, not the opposer cap', () => {
		// BLUE 1-1 wins a success_costly assault and proposes ZERO own-casualties.
		// RED DEF (the opposer/loser) tries to author a −3 hit on the winning 1-1.
		// Old behaviour (the exploit): the casualty was gated by DEF's OPPOSER role,
		// which permits the full −3, so 1-1 was driven 100→25 — the AI wounding the
		// player's winning unit, a direct ledger-authority breach.
		// Fixed behaviour: the casualty is gated by the OWNER of 1-1 (the initiator
		// side), so success_costly caps it at −1; 1-1 can never fall below 75 here,
		// and the 3-band exploit is closed.
		const env: MoveEnvelope = {
			narrative: '',
			playerActions: [
				{
					actor: '1-1',
					side: 'BLUE',
					actionType: 'assault',
					opposes: 'DEF',
					capabilitiesUsed: ['small_arms'],
					expend: [],
					proposedModifiers: [],
					proposedOutcome: { casualties: [] } // winner proposes NO own loss
				}
			],
			enemyActions: [
				{
					actor: 'DEF',
					side: 'RED',
					actionType: 'defend_fire',
					opposes: '1-1',
					capabilitiesUsed: ['small_arms'],
					expend: [],
					proposedModifiers: [],
					// The loser tries to wound the winner by −3 through its own casualty list.
					proposedOutcome: { casualties: [{ unit: '1-1', deltaBand: -3 }] }
				}
			],
			reveals: []
		};
		const base = stateBefore_5_4();
		const { accepted } = validate(base, env, [], 4);
		const events = resolveTurn(base, accepted, [], 4, stubRoller); // success_costly
		const after = fold(base, events);
		// EXPLOIT CLOSED: 1-1 is owner-gated as the initiator (cap −1), never −3.
		// It cannot be driven to 25 by the loser's authored casualty.
		expect(unitById(after, '1-1')!.strength).toBe(75);
		// And no strength event may drive 1-1 below the initiator cap.
		const oneOneHits = events.filter((e) => e.kind === 'strength' && e.unit === '1-1');
		for (const e of oneOneHits) if (e.kind === 'strength') expect(e.to).toBeGreaterThanOrEqual(75);
	});
});

// ── CR-02: casualties may only name genuine contest participants ──────────────
describe('CR-02 — a casualty naming a non-participant / unknown unit is refused', () => {
	test('a casualty against an off-contest unit emits NO strength event and is not materialized', () => {
		// A solo BLUE action (rolls as initiator) lists a casualty against MTR — a
		// BLUE unit that is NOT a participant in THIS contest (it is uninvolved) — and
		// against a wholly-unknown 'GHOST' id. Old behaviour: MTR took an initiator-
		// capped hit and GHOST defaulted to a phantom 100% strength event (WR-03).
		// Fixed behaviour: neither is a participant of the resolved contest, so both
		// are refused — no strength event, no phantom unit materialized.
		const env: MoveEnvelope = {
			narrative: '',
			playerActions: [
				{
					actor: '1-1',
					side: 'BLUE',
					actionType: 'assault',
					capabilitiesUsed: ['small_arms'],
					expend: [],
					proposedModifiers: [],
					proposedOutcome: {
						casualties: [
							{ unit: 'MTR', deltaBand: -1 }, // a real but NON-participant friendly unit
							{ unit: 'GHOST', deltaBand: -3 } // a unit the engine has never seen
						]
					}
				}
			],
			enemyActions: [],
			reveals: []
		};
		const base = stateBefore_5_4();
		const { accepted } = validate(base, env, [], 4);
		const events = resolveTurn(base, accepted, [], 4, bandRoller('success_costly'));
		// No strength event for the off-contest MTR nor the phantom GHOST.
		expect(events.some((e) => e.kind === 'strength' && e.unit === 'MTR')).toBe(false);
		expect(events.some((e) => e.kind === 'strength' && e.unit === 'GHOST')).toBe(false);
		// And MTR is untouched in folded state; GHOST never materializes.
		const after = fold(base, events);
		expect(unitById(after, 'MTR')!.strength).toBe(100);
		expect(unitById(after, 'GHOST')).toBeUndefined();
	});
});

// ── DICE-06: code-decided hand-off; AI note has zero authority ────────────────
describe('DICE-06 — phase flip is read from post-casualty strength, not the AI note', () => {
	test('§5.4: RED breaks (DEF 25% + broken) → phase engagement→consolidation', () => {
		const base = stateBefore_5_4();
		const { accepted } = validate(base, envelope_5_4, priorEvents_5_4, 4);
		const events = resolveTurn(base, accepted, [], 4, stubRoller);
		const phase = events.find((e) => e.kind === 'phase');
		expect(phase).toBeDefined();
		if (phase?.kind === 'phase') {
			expect(phase.from).toBe('engagement');
			expect(phase.to).toBe('consolidation');
		}
	});

	test('a non-breaking outcome emits NO phase change even if the AI note claims one', () => {
		// Both sides stay healthy (stalled, light losses) — no side below threshold.
		const env: MoveEnvelope = {
			narrative: '',
			playerActions: [
				{
					actor: '1-1',
					side: 'BLUE',
					actionType: 'assault',
					opposes: 'DEF',
					capabilitiesUsed: ['small_arms'],
					expend: [],
					proposedModifiers: [],
					proposedOutcome: {
						casualties: [{ unit: '1-1', deltaBand: -1 }],
						note: 'the enemy breaks and the engagement is over' // AI claim — ignored
					}
				}
			],
			enemyActions: [
				{
					actor: 'DEF',
					side: 'RED',
					actionType: 'defend_fire',
					opposes: '1-1',
					capabilitiesUsed: ['small_arms'],
					expend: [],
					proposedModifiers: [],
					proposedOutcome: { casualties: [{ unit: 'DEF', deltaBand: -1 }] }
				}
			],
			reveals: []
		};
		const base = stateBefore_5_4();
		const { accepted } = validate(base, env, [], 4);
		const events = resolveTurn(base, accepted, [], 4, bandRoller('stalled'));
		// DEF 100→75, 1-1 100→75 — neither side ≤25% → no phase event despite the AI note.
		expect(events.some((e) => e.kind === 'phase')).toBe(false);
	});
});

// ── STATE-04: destroyed emitted LAST; fold collapses to graveyard ─────────────
describe('STATE-04 — a unit resolved to 0 emits destroyed LAST and is graveyarded', () => {
	// DEF starts at 25% (already wounded); a −3 finishes it (25 → 0).
	function woundedBase(): GameState {
		const s = stateBefore_5_4();
		const def = s.sides.find((x) => x.id === 'RED')!.units.find((u) => u.id === 'DEF')!;
		def.strength = 25;
		return s;
	}
	const env: MoveEnvelope = {
		narrative: '',
		playerActions: [
			{
				actor: '1-1',
				side: 'BLUE',
				actionType: 'assault',
				opposes: 'DEF',
				capabilitiesUsed: ['small_arms'],
				expend: [],
				proposedModifiers: [],
				proposedOutcome: { casualties: [{ unit: '1-1', deltaBand: -1 }] }
			}
		],
		enemyActions: [
			{
				actor: 'DEF',
				side: 'RED',
				actionType: 'defend_fire',
				opposes: '1-1',
				capabilitiesUsed: ['small_arms'],
				expend: [],
				proposedModifiers: [],
				proposedOutcome: { casualties: [{ unit: 'DEF', deltaBand: -3 }] }
			}
		],
		reveals: []
	};

	test('destroyed event for DEF is emitted AFTER its strength/morale/posture events', () => {
		const base = woundedBase();
		const { accepted } = validate(base, env, [], 5);
		const events = resolveTurn(base, accepted, [], 5, stubRoller);
		const idxDestroyed = events.findIndex((e) => e.kind === 'destroyed' && e.unit === 'DEF');
		const idxStrength = events.findIndex((e) => e.kind === 'strength' && e.unit === 'DEF');
		expect(idxDestroyed).toBeGreaterThan(-1);
		expect(idxStrength).toBeGreaterThan(-1);
		expect(idxDestroyed).toBeGreaterThan(idxStrength);
		// destroyed is the LAST event for DEF (no DEF event after it).
		const after = events.slice(idxDestroyed + 1);
		expect(after.some((e) => 'unit' in e && e.unit === 'DEF')).toBe(false);
	});

	test('after fold the unit is gone from units and a graveyard line exists', () => {
		const base = woundedBase();
		const { accepted } = validate(base, env, [], 5);
		const events = resolveTurn(base, accepted, [], 5, stubRoller);
		const after = fold(base, events);
		expect(unitById(after, 'DEF')).toBeUndefined();
		expect(after.graveyard.some((g) => g.includes('DEF'))).toBe(true);
	});
});

// ── FOG-02: reveal emitted; fold moves the report into knows ──────────────────
describe('FOG-02 — a reveal moves a report from unconfirmedReports into knows', () => {
	function intelBase(): GameState {
		const s = stateBefore_5_4();
		s.intel.unconfirmedReports = ['possible mortar in the treeline'];
		return s;
	}
	const env: MoveEnvelope = {
		narrative: '',
		playerActions: [],
		enemyActions: [],
		reveals: [
			{
				report: 'possible mortar in the treeline',
				resolvesTo: 'enemy 82mm mortar confirmed at grid 1234',
				confirmedBy: 'BLUE'
			}
		]
	};

	test('resolveTurn emits one reveal event from reveals[]', () => {
		const base = intelBase();
		const { accepted } = validate(base, env, [], 4);
		const events = resolveTurn(base, accepted, env.reveals, 4, stubRoller);
		const reveal = events.filter((e) => e.kind === 'reveal');
		expect(reveal).toHaveLength(1);
		if (reveal[0].kind === 'reveal') {
			expect(reveal[0].report).toBe('possible mortar in the treeline');
			expect(reveal[0].confirmedBy).toBe('BLUE');
			expect(reveal[0].turn).toBe(4);
		}
	});

	test('after fold the report moves into knows[BLUE] and out of unconfirmedReports', () => {
		const base = intelBase();
		const { accepted } = validate(base, env, [], 4);
		const events = resolveTurn(base, accepted, env.reveals, 4, stubRoller);
		const after = fold(base, events);
		expect(after.intel.unconfirmedReports).not.toContain('possible mortar in the treeline');
		expect(after.intel.knows.BLUE).toContain('enemy 82mm mortar confirmed at grid 1234');
	});
});

// Reference the imported type so noUnusedLocals stays satisfied in strict configs.
export type _AcceptedProposal = ResolvedActionProposal;
