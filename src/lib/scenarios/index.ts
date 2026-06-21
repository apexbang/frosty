// scenarios/index.ts — `ScenarioStore implements GameSource`: the read seam over the
// BUNDLED scenario data files (SCEN-07 / SCEN-08). It enumerates every `src/lib/scenarios/*.ts`
// data file via Vite's `import.meta.glob`, projects each into a readable `CatalogEntry` for
// the picker (D-07), and materializes a chosen scenario as a fresh `PersistedGame` for the
// unified load path.
//
// SAME CONTRACT, ZERO call-site change (D-LOCK-04): `ScenarioStore` is a drop-in `GameSource`
// exactly like `IdbSaveStore.source()` — `list()` returns the picker rows, `load(id)` returns
// the UNFOLDED `PersistedGame` envelope. validate → migrate → fold happen UP in
// `loadGameState` (load.ts), NOT here — the store never bypasses the unified gate (D-LOCK-03).
//
// PURITY BOUNDARY (CORE-02): `import.meta.glob` is a VITE / bundler feature, so this module is
// NON-engine — it lives under `src/lib/scenarios/`, NOT `/lib/engine/` (mirrors
// `idb-save-store.ts` being non-engine). The glob is CONFINED to this file so the engine
// (`src/lib/engine/**`) stays pure and imports nothing bundler-dependent.
//
// FACTORY DISCIPLINE (deep-distinct per call): each module's exported factory returns a fresh
// `PersistedGame`, so `load(id)` materializes deep-distinct objects every call — two booted
// games from the same scenario never share mutable structure (mirrors starter.ts / second.ts).

import type { GameSource, PersistedGame, CatalogEntry, ScenarioSideSummary } from '../engine';
import type { GameState, Side } from '../engine/state';

/** A scenario data module exposes ONE zero-arg factory returning a turn-0 `PersistedGame`. */
type ScenarioFactory = () => PersistedGame;

/**
 * BUNDLE-TIME enumeration of every scenario data file via Vite's `import.meta.glob`
 * (eager, so the factories are available synchronously). `index.ts` (this file) is NOT matched
 * by `./*.ts` only when… — Vite DOES include `index.ts` in `./*.ts`, so it is filtered out
 * below by skipping any module that does not export a recognizable scenario factory (this file
 * exports a class, not a `*Scenario` factory). Each matched module exports exactly one factory
 * whose name ends in `Scenario` (e.g. `starterScenario`, `holdTheCrossingScenario`).
 */
const SCENARIO_MODULES = import.meta.glob<Record<string, unknown>>('./*.ts', { eager: true });

/** Slugify a campaign name into a stable, URL-safe scenario id (e.g. 'Hold the Crossing' → 'hold-the-crossing'). */
function slug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** Pull the single `*Scenario` factory out of a globbed module, or `null` if there is none (e.g. index.ts). */
function factoryOf(mod: Record<string, unknown>): ScenarioFactory | null {
	for (const [key, value] of Object.entries(mod)) {
		if (typeof value === 'function' && key.endsWith('Scenario')) {
			return value as ScenarioFactory;
		}
	}
	return null;
}

/** Project one side into a readable card summary (D-07) — a PURE projection, no new data. */
function summarizeSide(side: Side): ScenarioSideSummary {
	// '2× rifle-squad, 1× weapons-squad' — count units by type, stable insertion order.
	const counts = new Map<string, number>();
	for (const unit of side.units) counts.set(unit.type, (counts.get(unit.type) ?? 0) + 1);
	const forces = Array.from(counts, ([type, n]) => `${n}× ${type}`).join(', ');
	return {
		id: side.id,
		commander: side.commander,
		objectives: [...side.objectives],
		forces
	};
}

/** Project a bundled turn-0 `GameState` into the picker's extended `CatalogEntry` metadata. */
function projectCatalog(id: string, state: GameState): CatalogEntry {
	return {
		id,
		name: state.meta.campaignName,
		currentTurn: state.meta.turn,
		terrain: state.meta.terrain,
		weather: state.meta.weather,
		sides: state.sides.map(summarizeSide)
	};
}

/**
 * `ScenarioStore` — the bundled-scenario `GameSource` (SCEN-07/08). Builds a stable
 * `id → factory` map once from the glob at construction, then:
 *   • `list()` — call each factory, project its turn-0 state into an extended `CatalogEntry`.
 *   • `load(id)` — call the matching factory to materialize a FRESH (deep-distinct) UNFOLDED
 *     `PersistedGame`; `null` for an unknown id. The engine folds it up in `loadGameState`.
 */
export class ScenarioStore implements GameSource {
	/** Stable scenario id → its turn-0 `PersistedGame` factory (deep-distinct per call). */
	readonly #factories: Map<string, ScenarioFactory>;

	constructor() {
		this.#factories = new Map();
		for (const mod of Object.values(SCENARIO_MODULES)) {
			const factory = factoryOf(mod);
			if (!factory) continue; // skip this index module (no scenario factory) defensively
			// Derive a stable id from the materialized campaignName slug. A single fresh call
			// here is only to read the name; load(id) materializes a fresh one again per call.
			const id = slug(factory().campaignName);
			this.#factories.set(id, factory);
		}
	}

	/** The picker rows — a REAL list (never a stub), each with extended scenario metadata (D-07). */
	async list(): Promise<CatalogEntry[]> {
		const rows: CatalogEntry[] = [];
		for (const [id, factory] of this.#factories) {
			const persisted = factory();
			// A scenario carries a single turn-0 snapshot; project its state into the card metadata.
			const snap = persisted.snapshots[0];
			rows.push(projectCatalog(id, snap.state));
		}
		return rows;
	}

	/**
	 * Materialize the chosen scenario as a FRESH, UNFOLDED `PersistedGame` (D-LOCK-04). Returns
	 * `null` for an unknown id (the `GameSource` contract). Validate → migrate → fold happen UP
	 * in `loadGameState`, never here.
	 */
	async load(_id?: string): Promise<PersistedGame | null> {
		if (_id === undefined) return null;
		const factory = this.#factories.get(_id);
		return factory ? factory() : null;
	}
}
