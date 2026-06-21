// bundled-scenarios.test.ts — the SCEN-09 CI GATE: shape + domain validation on EVERY
// bundled scenario, each build (T-09D-01).
//
// A bundled scenario is developer/AI-authored data that ships to a player's phone. This gate
// is the STATIC guard that a scenario drifting from the `GameState` type or violating the
// seed validator's well-formedness fails CI — NOT a player's phone (FEATURES "graceful
// at-load rejection" elevated to build time; SCEN-09).
//
// It iterates the BUNDLED set via `ScenarioStore.list()`, loads each scenario's UNFOLDED
// `PersistedGame` (via `store.load(id)`), and per scenario asserts BOTH gates the unified
// load path runs:
//   (1) SHAPE  — `validateSaveEnvelope(persisted).ok === true`. A scenario drifting from the
//       `GameState`/`SaveEnvelope` type (extra/missing/wrong-typed field) fails HERE.
//   (2) DOMAIN — `loadGameState(persisted).ok === true`. This runs the Plan-01 `validateSeed`
//       well-formedness gate; a prohibited-conflict or off-manifest loadout fails here with
//       `reason: 'illegal-seed'`.
//
// Each scenario is an individually-named `test.each` case (keyed by id), so a CI failure NAMES
// the offending scenario rather than reporting an anonymous failure.
//
// EMPTY-GLOB GUARD (T-09D-02): the bundled set is asserted non-empty AND asserted to include
// "Hold the Crossing" — an empty `test.each` cannot pass this gate as a silent no-op (a
// mis-globbed/empty bundled set is a build-integrity failure, not a vacuous green).
//
// PURITY: imports the (non-engine) ScenarioStore + engine modules only. No Svelte / idb.
// Collected by the standard `npx vitest run` under the existing node `engine` project
// (tests/scenarios/** is already wired into its include glob) — CI picks it up, no config change.

import { describe, test, expect } from 'vitest';
import { ScenarioStore } from '../../src/lib/scenarios';
import { validateSaveEnvelope } from '../../src/lib/engine/save-schema';
import { loadGameState } from '../../src/lib/engine/load';

const store = new ScenarioStore();

// Enumerate the bundled set ONCE, at module load, so `test.each` is keyed by the REAL bundled
// rows (each scenario id becomes a named case). The store reads `import.meta.glob({ eager })`,
// so `list()` resolves synchronously-available data; a top-level `await` materializes the
// rows before `test.each` collects them (`test.each` requires a concrete array at collect
// time — a lazy thunk is not accepted in this runner).
const rows = await store.list();

describe('bundled scenarios — CI gate (shape + domain, every build) [SCEN-09]', () => {
	// EMPTY-GLOB GUARD (T-09D-02): a mis-globbed/empty bundled set is a build-integrity
	// failure, never a vacuous pass. The set must be non-empty AND include the proven
	// conflict-free "Hold the Crossing" case (D-02) — an empty test.each cannot satisfy this.
	test('the bundled set is non-empty and includes "Hold the Crossing"', () => {
		expect(rows.length).toBeGreaterThan(0);
		const names = rows.map((r) => r.name);
		expect(names).toContain('Hold the Crossing');
	});

	// One individually-named case PER bundled scenario (keyed by id) — a CI failure NAMES the
	// offending scenario.
	test.each(rows.map((r) => [r.id, r] as const))(
		'scenario "%s" passes the shape + domain gate',
		async (id, row) => {
			// Materialize the chosen scenario's UNFOLDED PersistedGame (validate/migrate/fold
			// stay UP in loadGameState; the store returns the raw envelope).
			const persisted = await store.load(id);
			expect(persisted, `load("${id}") should materialize a PersistedGame`).not.toBeNull();

			// (1) SHAPE GATE — a scenario drifting from the GameState/SaveEnvelope type fails here.
			const shape = validateSaveEnvelope(persisted);
			expect(
				shape.ok,
				`scenario "${id}" (${row.name}) failed the SHAPE gate (validateSaveEnvelope): ${
					shape.ok ? '' : shape.error
				}`
			).toBe(true);

			// (2) DOMAIN GATE — runs the Plan-01 validateSeed well-formedness check inside the
			// ONE unified load path. A prohibited-conflict / off-manifest loadout fails here as
			// reason: 'illegal-seed'.
			const loaded = loadGameState(persisted);
			expect(
				loaded.ok,
				`scenario "${id}" (${row.name}) failed the DOMAIN gate (loadGameState): ${
					loaded.ok ? '' : `${loaded.reason} — ${loaded.error}`
				}`
			).toBe(true);
		}
	);
});
