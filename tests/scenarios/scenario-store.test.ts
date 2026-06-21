// scenario-store.test.ts — the ScenarioStore CONTRACT suite (SCEN-06/07).
//
// Proves the bundled-scenario read seam: `ScenarioStore` lists the two shipped scenarios with
// readable extended metadata, materializes each as a turn-0 `PersistedGame`, and that EACH
// materialized scenario both PASSES the Plan-01 seed validator AND folds cleanly through the
// ONE `loadGameState` path (`ok: true`). It also locks the `GameSource` contract edges:
// unknown id → null, and deep-distinctness (two loads of the same id are non-identical refs).
//
// The dedicated CI gate over the WHOLE bundled set is Plan 04; THIS suite proves the store
// contract + that "Hold the Crossing"'s non-empty `prohibited` is a proven conflict-free case.
//
// PURITY: imports the (non-engine) ScenarioStore + engine modules only. No Svelte / idb.

import { describe, test, expect } from 'vitest';
import { ScenarioStore } from '../../src/lib/scenarios';
import { loadGameState } from '../../src/lib/engine/load';

describe('ScenarioStore — bundled scenario read seam', () => {
	test('list() returns the two shipped scenarios with extended metadata', async () => {
		const store = new ScenarioStore();
		const rows = await store.list();

		expect(rows).toHaveLength(2);

		const byId = new Map(rows.map((r) => [r.id, r]));
		expect(byId.has('starter')).toBe(true);
		expect(byId.has('hold-the-crossing')).toBe(true);

		const starter = byId.get('starter')!;
		expect(starter.name).toBe('Starter');
		expect(starter.currentTurn).toBe(0);

		const hold = byId.get('hold-the-crossing')!;
		expect(hold.name).toBe('Hold the Crossing');
		expect(hold.currentTurn).toBe(0);

		// Extended metadata (D-07) — terrain, per-side summaries with objectives + forces.
		for (const row of rows) {
			expect(typeof row.terrain).toBe('string');
			expect(row.terrain!.length).toBeGreaterThan(0);
			expect(row.sides).toBeDefined();
			expect(row.sides!.length).toBeGreaterThanOrEqual(2);
			for (const side of row.sides!) {
				expect(side.objectives.length).toBeGreaterThan(0);
				expect(side.forces.length).toBeGreaterThan(0);
			}
		}

		// The schema-generality proof: Hold the Crossing inverts the starter — non-'urban' terrain.
		expect(hold.terrain).not.toBe('urban');
	});

	test('every shipped scenario loads as a turn-0 PersistedGame that folds cleanly (ok: true)', async () => {
		const store = new ScenarioStore();
		const rows = await store.list();

		for (const row of rows) {
			const persisted = await store.load(row.id);
			expect(persisted, `load("${row.id}") should materialize a PersistedGame`).not.toBeNull();

			// A scenario IS a save at turn 0: empty events, highest snapshot at turn 0.
			expect(persisted!.events).toEqual([]);
			const highestTurn = persisted!.snapshots.reduce((m, s) => Math.max(m, s.turn), -Infinity);
			expect(highestTurn).toBe(0);

			// Crosses the ONE unified path: shape + Plan-01 seed validator + fold — all ok.
			const result = loadGameState(persisted);
			expect(result.ok, `loadGameState("${row.id}") should be ok`).toBe(true);
		}
	});

	test('Hold the Crossing specifically loads ok (its non-empty prohibited is conflict-free)', async () => {
		const store = new ScenarioStore();
		const persisted = await store.load('hold-the-crossing');
		expect(persisted).not.toBeNull();

		const result = loadGameState(persisted);
		expect(result.ok).toBe(true);

		// Sanity: BLUE's prohibited is non-empty (D-02) and disjoint from its allow-set, so the
		// seed validator (run inside loadGameState above) accepted it.
		const blue = persisted!.snapshots[0].state.sides.find((s) => s.id === 'BLUE')!;
		expect(blue.manifest.prohibited.length).toBeGreaterThan(0);
		const allow = new Set([
			...blue.manifest.organicAssets,
			...blue.manifest.supportingAssets
		]);
		for (const p of blue.manifest.prohibited) expect(allow.has(p)).toBe(false);
	});

	test('load() of an unknown id resolves null', async () => {
		const store = new ScenarioStore();
		await expect(store.load('no-such-scenario')).resolves.toBeNull();
		await expect(store.load(undefined)).resolves.toBeNull();
	});

	test('repeated load() of the same id returns deep-distinct objects (factory discipline)', async () => {
		const store = new ScenarioStore();
		const a = await store.load('hold-the-crossing');
		const b = await store.load('hold-the-crossing');

		expect(a).not.toBeNull();
		expect(b).not.toBeNull();
		// Non-identical references at every nesting level we mutate.
		expect(a).not.toBe(b);
		expect(a!.snapshots).not.toBe(b!.snapshots);
		expect(a!.snapshots[0].state).not.toBe(b!.snapshots[0].state);

		// Mutating one must not touch the other (deep-distinct proof).
		a!.snapshots[0].state.sides[0].units.push({
			id: 'X',
			type: 'phantom',
			strength: 100,
			morale: 'steady',
			supply: { ammo: 'high', fuel: 'high', rations: 'high', medical: 'high' },
			position: 'unknown',
			posture: 'staged',
			status: []
		});
		expect(a!.snapshots[0].state.sides[0].units.length).not.toBe(
			b!.snapshots[0].state.sides[0].units.length
		);
	});
});
