// round-trip.test.ts — the FULL Phase-3 slice end-to-end (integration).
//
// This is the integration canary that proves the prose→JSON→validate→confirm→resolve
// →fold pipeline composes through a mocked transport. It threads a §5.4 envelope
// (fence-wrapped, as a model would return it) through:
//   extractAndValidate (NEW, envelope-schema.ts) →
//   validate           (Phase 2, validate.ts)    →
//   confirmDiff        (NEW, confirm.ts)          →
//   resolveTurn        (Phase 2, resolve.ts)      →
//   fold               (Phase 1, state.ts)
// and asserts the folded categorical state IS stateAfter_5_4 and the derived ledger
// IS remaining_after_5_4 — mirroring resolve.test.ts's golden so a regression in ANY
// composed module diverges here. The stubRoller is re-declared identically to
// resolve.test.ts (pins faces [3,4], DERIVES net/band via the real clampNet/band).
//
// RED until envelope-schema.ts AND confirm.ts are written (validate/resolve/fold/ledger
// already ship). It MUST fail on the missing NEW modules — not a fixture/syntax error.
//
// PURITY: imports only engine modules + the shared §5.4 fixture. No Svelte / idb.

import { describe, test, expect, vi } from 'vitest';
import * as validateModule from '../../src/lib/engine/validate';
import * as resolveModule from '../../src/lib/engine/resolve';
import { validate } from '../../src/lib/engine/validate';
import { resolveTurn } from '../../src/lib/engine/resolve';
import { fold } from '../../src/lib/engine/state';
import type { GameState } from '../../src/lib/engine/state';
import { remaining } from '../../src/lib/engine/ledger';
import type { DicePayload, Modifier } from '../../src/lib/engine/dice';
import { clampNet, band as bandOf } from '../../src/lib/engine/dice';
import { extractAndValidate } from '../../src/lib/engine/envelope-schema';
import { confirmDiff } from '../../src/lib/engine/confirm';
import {
	stateBefore_5_4,
	envelope_5_4,
	priorEvents_5_4,
	stateAfter_5_4,
	remaining_after_5_4
} from './fixtures/worked-example-5.4';

// Deterministic roller — identical to resolve.test.ts:46. Pins ONLY the faces [3,4];
// net/band are DERIVED from the forwarded modifiers via the real clampNet/band, so the
// golden cannot pass by a stubbed constant.
function stubRoller(actor: string, modifiers: Modifier[], turn: number): DicePayload {
	const roll: [number, number] = [3, 4];
	const net = clampNet(modifiers);
	return { kind: 'dice', actor, roll, modifiers, net, band: bandOf(roll[0] + roll[1] + net), turn };
}

const unitById = (s: GameState, id: string) =>
	s.sides.flatMap((side) => side.units).find((u) => u.id === id);

describe('Phase-3 round-trip — paste→extract→validate→confirm→resolve→fold == stateAfter_5_4', () => {
	const TURN = 4;
	// A model returns the envelope fenced inside prose, exactly as the clipboard transport sees it.
	const raw = 'Here:\n```json\n' + JSON.stringify(envelope_5_4) + '\n```';

	test('the fenced paste extracts and validates to a MoveEnvelope', () => {
		const out = extractAndValidate(raw);
		expect(out.ok).toBe(true);
	});

	test('confirmDiff over the extracted envelope is non-empty', () => {
		const out = extractAndValidate(raw);
		expect(out.ok).toBe(true);
		if (out.ok) expect(confirmDiff(out.value).length).toBeGreaterThan(0);
	});

	test('the full slice folds to stateAfter_5_4 and remaining_after_5_4', () => {
		const out = extractAndValidate(raw);
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		const env = out.value;

		const base = stateBefore_5_4();
		const { accepted, rejections } = validate(base, env, priorEvents_5_4, TURN);
		expect(rejections).toEqual([]);
		expect(accepted).toHaveLength(3);

		// The confirm gate sits between validate and resolve — assert it projects the move.
		expect(confirmDiff(env).length).toBeGreaterThan(0);

		const turnEvents = resolveTurn(base, accepted, env.reveals, TURN, stubRoller);
		const after = fold(base, turnEvents);
		const fullStream = [...priorEvents_5_4, ...turnEvents];

		// Categorical state matches the canonical §5.4 state-after.
		expect(after.meta.turn).toBe(stateAfter_5_4.meta.turn);
		expect(after.meta.clock).toBe(stateAfter_5_4.meta.clock);
		expect(after.meta.phase).toBe(stateAfter_5_4.meta.phase);

		expect(unitById(after, '1-1')!.strength).toBe(stateAfter_5_4.units['1-1'].strength);
		expect(unitById(after, '1-1')!.posture).toBe(stateAfter_5_4.units['1-1'].posture);
		expect(unitById(after, 'MTR')!.strength).toBe(stateAfter_5_4.units.MTR.strength);
		expect(unitById(after, 'DEF')!.strength).toBe(stateAfter_5_4.units.DEF.strength);
		expect(unitById(after, 'DEF')!.morale).toBe(stateAfter_5_4.units.DEF.morale);
		expect(unitById(after, 'DEF')!.posture).toBe(stateAfter_5_4.units.DEF.posture);

		// Derived ledger matches the canonical post-turn-4 counts (smoke is the canary).
		const blue = after.sides.find((s) => s.id === 'BLUE')!;
		const red = after.sides.find((s) => s.id === 'RED')!;
		expect(remaining(blue.consumables.loadout, fullStream, 'frag', 'BLUE')).toBe(remaining_after_5_4.frag);
		expect(remaining(blue.consumables.loadout, fullStream, 'smoke', 'BLUE')).toBe(remaining_after_5_4.smoke);
		expect(remaining(blue.consumables.loadout, fullStream, 'mortar_60mm', 'BLUE')).toBe(
			remaining_after_5_4.mortar_60mm
		);
		expect(remaining(red.consumables.loadout, fullStream, 'rpg', 'RED')).toBe(remaining_after_5_4.rpg);
	});
});

describe('Phase-3 round-trip — atomic rejection (NARR-03 / T-03-13)', () => {
	const TURN = 4;
	// A shape-valid-LOOKING but type-wrong paste: `narrative` is a number, not a string.
	// A chatty model wrapped it in prose + a fence, exactly as the transport sees it.
	const badRaw = 'Sure! ```json\n{ "narrative": 5 }\n```';

	test('a malformed fenced paste is rejected at the shape gate (ok:false)', () => {
		const out = extractAndValidate(badRaw);
		expect(out.ok).toBe(false);
	});

	test('the slice STOPS at the gate — validate/resolveTurn are never reached on a bad paste', () => {
		const validateSpy = vi.spyOn(validateModule, 'validate');
		const resolveSpy = vi.spyOn(resolveModule, 'resolveTurn');
		try {
			// The slice's only state-touching steps are validate → resolveTurn, and they
			// run ONLY when extractAndValidate succeeds. A bad paste short-circuits here.
			const out = extractAndValidate(badRaw);
			expect(out.ok).toBe(false);
			if (out.ok) {
				// Unreachable on a bad paste — but proves the structural guard if it ever drifts.
				const base = stateBefore_5_4();
				const { accepted } = validate(base, out.value, priorEvents_5_4, TURN);
				resolveTurn(base, accepted, out.value.reveals, TURN, stubRoller);
			}
			expect(validateSpy).not.toHaveBeenCalled();
			expect(resolveSpy).not.toHaveBeenCalled();
		} finally {
			validateSpy.mockRestore();
			resolveSpy.mockRestore();
		}
	});

	test('stateBefore_5_4 is byte-unchanged after a rejected paste (structural atomicity)', () => {
		// The slice never mutates state before resolveTurn; a rejected paste cannot
		// corrupt the ledger. A fresh state deep-equals the pristine snapshot.
		const pristine = stateBefore_5_4();
		const out = extractAndValidate(badRaw);
		expect(out.ok).toBe(false);
		// No state-touching step ran, so a freshly-built state still equals the snapshot.
		expect(stateBefore_5_4()).toEqual(pristine);
	});

	test('a non-JSON paste is also rejected without reaching state', () => {
		const out = extractAndValidate('total garbage, no json here');
		expect(out.ok).toBe(false);
	});
});
