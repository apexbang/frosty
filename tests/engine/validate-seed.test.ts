// validate-seed.test.ts — the RED suite locking the seed well-formedness validator
// (SCEN-03 / SCEN-04) + its composition into the unified load boundary.
//
// `validateSeed(state)` is the DOMAIN gate (legality + coherence ONLY) that every seed
// crosses AT LOAD — a shipped scenario, an AI-generated paste, a resumed save. It checks
// two manifest-internal categorical invariants and NOTHING about balance/winnability/
// plausibility (SCEN-04 — a guerrilla legally fielding close_air_support is ACCEPTED):
//   (1) PROHIBITED CONFLICT (the NEW check) — no capability may sit in BOTH a side's
//       allow-set (organicAssets ∪ supportingAssets) AND that side's `prohibited`.
//   (2) COHERENT REFERENCE — every capability a side's loadout/units reference resolves
//       into that side's allow-set (the validate.ts:101 membership family, reused).
//
// The reject surfaces AT LOAD: loadGameState composes validateSeed and returns the new
// `reason: 'illegal-seed'` arm before fold ("never three turns later"). The starter still
// loads end-to-end through the same gate.
//
// RED CONDITION: imports `validateSeed`/`SeedResult` from `../../src/lib/engine/validate-seed`,
// which lands in Task 2, and asserts the `illegal-seed` LoadResult arm wired in Task 3.
// Until then the suite fails for "Cannot find module ../../src/lib/engine/validate-seed" —
// NOT a fixture/syntax error. The pre-existing engine suite + the §5.4 golden stay green.
//
// PURITY: imports engine modules + the engine-side starter factory only. No Svelte / idb.

import { describe, test, expect } from 'vitest';
import { validateSeed } from '../../src/lib/engine/validate-seed';
import type { SeedResult } from '../../src/lib/engine/validate-seed';
import { loadGameState } from '../../src/lib/engine/load';
import type { LoadResult } from '../../src/lib/engine/load';
import { starterScenario } from '../../src/lib/scenarios/starter';
import type { GameState } from '../../src/lib/engine/state';
import type { PersistedGame } from '../../src/lib/engine/source';

// A deep-distinct copy of the clean turn-0 starter STATE — every fixture mutates its OWN
// copy so the cases stay independent (structuredClone, the same discipline applyEvent uses).
function starterStateCopy(): GameState {
	return structuredClone(starterScenario().snapshots[0].state);
}

// A deep-distinct copy of the starter PersistedGame envelope (snapshot + events). Mutating
// the returned snapshot's state lets a load-composition case craft an illegal seed without
// touching another fixture.
function starterEnvelopeCopy(): PersistedGame {
	return structuredClone(starterScenario());
}

describe('validateSeed — ACCEPT (legality/coherence pass, never throws)', () => {
	test('the clean turn-0 starter state is ACCEPTED (the standing canary)', () => {
		const result: SeedResult = validateSeed(starterScenario().snapshots[0].state);
		expect(result.ok).toBe(true);
	});

	test('a legal-but-implausible seed (close_air_support IN manifest, NOT prohibited) is ACCEPTED (SCEN-04)', () => {
		// The validator judges LEGALITY ONLY — never balance/plausibility. A force that lists
		// `close_air_support` in its own allow-set and does NOT prohibit it is well-formed,
		// however "implausible" the described force. This case is the standing guard that the
		// validator's scope is never widened to plausibility judgement (T-09A-03).
		const state = starterStateCopy();
		const blue = state.sides.find((s) => s.id === 'BLUE')!;
		blue.manifest.supportingAssets = [...blue.manifest.supportingAssets, 'close_air_support'];
		// close_air_support is NOT in blue.manifest.prohibited and is NOT referenced by any
		// loadout key, so it is a legal, coherent addition.
		const result = validateSeed(state);
		expect(result.ok).toBe(true);
	});

	test('returns a discriminated result, never throws, on a malformed-but-shape-valid seed', () => {
		// An empty-manifest side (no assets, no prohibited, no loadout) has no conflict and
		// no unresolved reference — it is vacuously well-formed. The point is totality: the
		// validator returns a result, it never throws.
		const state = starterStateCopy();
		const blue = state.sides.find((s) => s.id === 'BLUE')!;
		blue.manifest.organicAssets = [];
		blue.manifest.supportingAssets = [];
		blue.manifest.prohibited = [];
		blue.consumables.loadout = {};
		let result!: SeedResult;
		expect(() => {
			result = validateSeed(state);
		}).not.toThrow();
		expect(result.ok).toBe(true);
	});
});

describe('validateSeed — REJECT (the prohibited-conflict + incoherent-reference checks)', () => {
	test('a capability in BOTH the allow-set AND prohibited is REJECTED, reason names it (the NEW check)', () => {
		const state = starterStateCopy();
		const blue = state.sides.find((s) => s.id === 'BLUE')!;
		// `frag` is already in BLUE's organicAssets — also list it as prohibited to force the
		// conflict. (allow-set ∩ prohibited = { frag })
		blue.manifest.prohibited = [...blue.manifest.prohibited, 'frag'];
		const result = validateSeed(state);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toContain('frag');
	});

	test('a loadout key that does NOT resolve into the allow-set is REJECTED, reason names it (coherence)', () => {
		const state = starterStateCopy();
		const blue = state.sides.find((s) => s.id === 'BLUE')!;
		// Add a consumable `javelin` that is NOT in organicAssets ∪ supportingAssets — an
		// incoherent reference (a loadout for a capability the side does not field).
		blue.consumables.loadout = { ...blue.consumables.loadout, javelin: 3 };
		const result = validateSeed(state);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toContain('javelin');
	});
});

describe('loadGameState — composes validateSeed at the load boundary (SCEN-03)', () => {
	test('a prohibited-conflict PersistedGame is rejected AT LOAD with reason "illegal-seed"', () => {
		const env = starterEnvelopeCopy();
		const blue = env.snapshots[0].state.sides.find((s) => s.id === 'BLUE')!;
		blue.manifest.prohibited = [...blue.manifest.prohibited, 'frag'];
		let result!: LoadResult;
		expect(() => {
			result = loadGameState(env);
		}).not.toThrow();
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('illegal-seed');
		expect(result.error).toContain('frag');
	});

	test('loadGameState(starterScenario()) still loads ok and folds to the canonical starter state', () => {
		const result = loadGameState(starterScenario());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.state.meta.turn).toBe(0);
		expect(result.state.meta.campaignName).toBe('Starter');
		// the clean turn-0 starter has no prior history — events fold to the snapshot state
		expect(result.events).toEqual([]);
		const blue = result.state.sides.find((s) => s.id === 'BLUE')!;
		expect(blue.consumables.loadout.frag).toBe(6);
	});
});
