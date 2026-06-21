// source.ts — the game-SOURCE seam: `GameSource` + `PersistedGame` alias + `CatalogEntry`.
// PURE, framework-free TS (CORE-02), mirroring the `save-store.ts` interface-module style.
//
// `GameSource` is the read seam every load source crosses — a resumed save (idb), a
// shipped scenario data file, the §5.4 canary — all `list()` their available games and
// `load(id)` an UNFOLDED `PersistedGame` envelope that `loadGameState` (load.ts) then
// validates → migrates → folds (D-LOCK-03/04). `IdbSaveStore` implements this read shape
// in Plan 02; a scenario store implements it in Phase 9 — same contract, ZERO call-site
// change (exactly as `SaveStore` is the storage swap seam, `Narrator` the transport seam).
//
// PURITY (CORE-02): a single TYPE-ONLY import of SaveEnvelope from save.ts — engine types
// only. NO valibot, NO idb, NO Blob / navigator. The actual idb / file-fetch surfaces live
// in the NON-engine implementations, never here.
//
// The `_`-prefixed method param is load-bearing: eslint.config.js no-unused-vars is
// configured `argsIgnorePattern: '^_'`, so an interface method's parameter name MUST be
// `_`-prefixed to lint clean (it documents intent, not a binding) — see save-store.ts:14-17.

import type { SaveEnvelope } from './save';

/**
 * A scenario IS a save at turn 0 (D-LOCK-01) — `PersistedGame` is the `SaveEnvelope` shape,
 * a pure ALIAS, no new wrapper and no second schema. A scenario is a `PersistedGame` with
 * `meta.turn 0` and an empty `events` array; a resumed save is a `PersistedGame` at turn N.
 * Both cross the ONE `loadGameState` path.
 */
export type PersistedGame = SaveEnvelope;

/**
 * A readable summary of one side, projected PURELY from the bundled `GameState` for the
 * scenario picker cards (D-07). No new data model — every field is a projection of an
 * existing `Side` / `Unit` / `Manifest` value. Untrusted at render (a generated scenario's
 * metadata may originate from an AI paste) — the picker escapes all of it.
 */
export interface ScenarioSideSummary {
	/** The side id (e.g. 'BLUE' / 'RED'). */
	id: string;
	/** 'player' | 'ai' — who commands this side. */
	commander: string;
	/** The side's prose objectives, verbatim (rendered escaped). */
	objectives: string[];
	/** A starting-forces summary line: unit types + counts (e.g. '2× rifle-squad, 1× weapons-squad'). */
	forces: string;
}

/**
 * One row of `GameSource.list()` — the picker projection (D-LOCK-02 / D-07). The required
 * trio (`id` / `name` / `currentTurn`) is what EVERY source (idb save store, scenario store)
 * provides. Phase 9 EXTENDS it (per source.ts's invitation) with OPTIONAL readable scenario
 * metadata projected from the bundled `GameState` — present on a scenario row, absent on an
 * idb save row (which has no need to re-derive it). Keeping the additions optional means the
 * idb `catalog()` projection stays valid unchanged: a `CatalogEntry` is still satisfied by
 * the bare trio.
 */
export interface CatalogEntry {
	id: string;
	name: string;
	currentTurn: number;
	/** Scenario picker metadata (D-07) — OPTIONAL: only the scenario store populates these. */
	terrain?: string;
	weather?: string;
	/** Per-side readable summaries (sides · objectives · starting forces) for the card. */
	sides?: ScenarioSideSummary[];
	/** An optional flat one-line blurb / difficulty label (no system, D-disc). */
	blurb?: string;
}

/**
 * The game-source read seam (D-LOCK-02/04). Two Promise-returning methods so the Svelte
 * boot glue `await`s them and any source (idb save store, scenario store) is a pure drop-in:
 *
 *   - list — the picker rows (a REAL list, never a stub).
 *   - load — the UNFOLDED `PersistedGame` envelope for a source (validate → migrate → fold
 *            happen UP in `loadGameState`, not in the source — D-LOCK-04); null when the
 *            requested / default game does not exist.
 */
export interface GameSource {
	list(): Promise<CatalogEntry[]>;
	load(_id?: string): Promise<PersistedGame | null>;
}
