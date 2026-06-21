// action-catalog.test.ts — Wave-0 RED contract for ORDER-04 (the pure action catalog).
//
// Engine project (node). RED for "Cannot find module ../../src/lib/engine/action-catalog"
// (or a missing `offerableActions` export) until Plan 07-02 lands the pure verb catalog +
// filter. The pre-Phase-7 engine suite + the §5.4 golden stay GREEN.
//
// Locks the ORDER-04 / D-01 contract — `offerableActions(side, unit, remainingForSide)`
// is a PURE function (no AI, no Svelte, no idb) that returns ONLY the verbs offerable for
// one unit, mirroring the VALID-01 capability gate at menu time:
//   (a) a prohibited capability yields NO verb that requires it;
//   (b) an organic capability yields its verb;
//   (c) a verb whose expended item has remainingForSide[item] === 0 is ABSENT (unofferable,
//       NOT rendered-and-disabled — CONTEXT: "unofferable means not rendered");
//   (d) a dead unit (strength <= 0 or status includes 'destroyed') returns [];
//   (e) free verbs (requiresCapabilities []) are always offerable for a live unit.
//
// Inputs are the REAL §5.4 manifests (BLUE organic: small_arms/frag/smoke/mortar_60mm/at4/
// m240; prohibited: cas/artillery_beyond_60mm; RED organic: small_arms/rpg/pkm) so the
// filter is exercised against the contract-of-record, not a synthetic manifest.

import { describe, test, expect } from 'vitest';
import { offerableActions } from '../../src/lib/engine/action-catalog';
import type { ActionVerb } from '../../src/lib/engine/action-catalog';
import type { Side, Unit } from '../../src/lib/engine/state';
import { stateBefore_5_4 } from './fixtures/worked-example-5.4';

// ── Fixture accessors — the real §5.4 sides/units (the contract-of-record inputs) ──
const sideById = (id: string): Side =>
	stateBefore_5_4().sides.find((s) => s.id === id)!;
const unitOf = (side: Side, id: string): Unit =>
	side.units.find((u) => u.id === id)!;

const BLUE = sideById('BLUE');
const RED = sideById('RED');
const UNIT_1_1 = unitOf(BLUE, '1-1'); // rifle-squad, strength 100, status []
const UNIT_DEF = unitOf(RED, 'DEF'); // defenders, strength 100, status []

// A generous remaining map (nothing at 0) so capability gating is tested in isolation
// from the consumable-exhaustion gate; the 0-remaining case has its own test below.
const FULL_BLUE: Record<string, number> = { frag: 6, smoke: 4, mortar_60mm: 12 };
const FULL_RED: Record<string, number> = { rpg: 8 };

const needs = (v: ActionVerb): string[] => v.requiresCapabilities;
const hasCap = (verbs: ActionVerb[], cap: string): boolean =>
	verbs.some((v) => needs(v).includes(cap));

describe('ORDER-04 — offerableActions is a PURE manifest-filtered catalog', () => {
	test('(b) an organic capability (small_arms) yields its verb for a live BLUE unit', () => {
		const offered = offerableActions(BLUE, UNIT_1_1, FULL_BLUE);
		expect(offered.length).toBeGreaterThan(0);
		// small_arms is organic for BLUE — at least one offered verb requires it.
		expect(hasCap(offered, 'small_arms')).toBe(true);
	});

	test('(a) a prohibited capability (cas / artillery_beyond_60mm) yields NO verb that needs it', () => {
		const offered = offerableActions(BLUE, UNIT_1_1, FULL_BLUE);
		// BLUE.manifest.prohibited === ['cas', 'artillery_beyond_60mm']; no offered verb may
		// require either — the menu-time mirror of the VALID-01 prohibited gate.
		expect(hasCap(offered, 'cas')).toBe(false);
		expect(hasCap(offered, 'artillery_beyond_60mm')).toBe(false);
		// And every offered verb's required caps are organic ∪ supporting, none prohibited.
		const organic = new Set(BLUE.manifest.organicAssets);
		const supporting = new Set(BLUE.manifest.supportingAssets);
		const prohibited = new Set(BLUE.manifest.prohibited);
		for (const v of offered) {
			for (const cap of needs(v)) {
				expect(prohibited.has(cap)).toBe(false);
				expect(organic.has(cap) || supporting.has(cap)).toBe(true);
			}
		}
	});

	test('(c) a verb whose expended item has 0 remaining is ABSENT (unofferable, not disabled)', () => {
		// With frag at 0, any verb that expends frag must NOT appear in the returned list.
		const noFrag: Record<string, number> = { ...FULL_BLUE, frag: 0 };
		const offered = offerableActions(BLUE, UNIT_1_1, noFrag);
		const fragVerbs = offered.filter((v) => v.expends?.item === 'frag');
		expect(fragVerbs).toHaveLength(0);

		// Sanity: with frag available, a frag-expending verb IS offered (proving the gate
		// is the remaining count, not the verb's absence from the catalog).
		const offeredWithFrag = offerableActions(BLUE, UNIT_1_1, FULL_BLUE);
		expect(offeredWithFrag.some((v) => v.expends?.item === 'frag')).toBe(true);
	});

	test('(d) a unit with strength <= 0 OR status including "destroyed" returns []', () => {
		const dead: Unit = { ...UNIT_1_1, strength: 0 };
		expect(offerableActions(BLUE, dead, FULL_BLUE)).toEqual([]);

		const destroyed: Unit = { ...UNIT_1_1, status: ['destroyed'] };
		expect(offerableActions(BLUE, destroyed, FULL_BLUE)).toEqual([]);
	});

	test('(e) free verbs (requiresCapabilities []) are always offerable for a live unit', () => {
		const offered = offerableActions(BLUE, UNIT_1_1, FULL_BLUE);
		const free = offered.filter((v) => needs(v).length === 0);
		// At least one free verb (recon/hold) so a live unit always has >=1 offerable action
		// (no empty-menu edge except a genuinely incapacitated unit, covered by (d)).
		expect(free.length).toBeGreaterThan(0);
		// Free verbs survive even when every consumable is exhausted.
		const exhausted: Record<string, number> = { frag: 0, smoke: 0, mortar_60mm: 0 };
		const stillOffered = offerableActions(BLUE, UNIT_1_1, exhausted);
		expect(stillOffered.filter((v) => needs(v).length === 0).length).toBe(free.length);
	});

	test('the filter is side-scoped — RED offers its rpg verb, never a BLUE-only one', () => {
		const offered = offerableActions(RED, UNIT_DEF, FULL_RED);
		// rpg is organic for RED → at least one offered verb requires it.
		expect(hasCap(offered, 'rpg')).toBe(true);
		// frag is NOT in RED's manifest → no offered verb may require it.
		expect(hasCap(offered, 'frag')).toBe(false);
	});

	test('PURITY — offerableActions does not mutate its inputs', () => {
		const sideCopy = JSON.stringify(BLUE);
		const unitCopy = JSON.stringify(UNIT_1_1);
		const remCopy = JSON.stringify(FULL_BLUE);
		offerableActions(BLUE, UNIT_1_1, FULL_BLUE);
		expect(JSON.stringify(BLUE)).toBe(sideCopy);
		expect(JSON.stringify(UNIT_1_1)).toBe(unitCopy);
		expect(JSON.stringify(FULL_BLUE)).toBe(remCopy);
	});
});
