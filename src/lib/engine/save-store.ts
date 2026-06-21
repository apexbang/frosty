// save-store.ts — the PERSISTENCE SEAM: the `SaveStore` interface + `SaveResult`
// / `CampaignRow` types (SAVE-01..05, D-06). PURE, framework-free TS.
//
// `SaveStore` is the storage swap seam exactly as `Narrator` is the transport swap
// seam (PROJECT.md Key Decision: SaveStore is a Promise-based / normalized interface
// so an M4 SQLite store is a pure drop-in). v1 ships the idb-backed implementation
// (`src/lib/idb-save-store.ts`, NON-engine, Plan 02); M8 slots a `SqliteStore`
// behind this same five-method contract with ZERO engine call-site changes.
//
// PURITY (CORE-02): type-only sibling imports of GameState/GameEvent/SaveEnvelope/
// Snapshot — NO valibot, NO idb, NO Blob/navigator. This file imports nothing but
// engine types, so it passes the engine-purity gate trivially. The actual idb /
// Blob / navigator.storage surfaces live in the NON-engine impl, never here.
//
// The `_`-prefixed method params are load-bearing: eslint.config.js no-unused-vars
// is configured `argsIgnorePattern: '^_'`, so an interface method's parameter names
// MUST be `_`-prefixed to lint clean (they document intent, not a binding).

import type { GameState } from './state';
import type { GameEvent } from './events';
// Re-import (do NOT redefine) SaveEnvelope/Snapshot from save.ts — the shapes this
// store reads/writes — and the shared recoverable Result<T> from envelope-schema.ts.
import type { SaveEnvelope, Snapshot } from './save';
import type { Result } from './envelope-schema';
import type { PersistedGame } from './source';

// Surface these so a downstream consumer importing the store contract gets the
// envelope shapes from one place; they remain OWNED by save.ts (not redefined here).
export type { SaveEnvelope, Snapshot };

// The GameSource READ shape (an UNFOLDED envelope-returning `loadEnvelope` + a
// `catalog()` projection) is OWNED by engine/source.ts (D-LOCK-02/04), not here.
// `IdbSaveStore` (the non-engine impl) provides it via a `source()` adapter — the class
// keeps a folded `load(): GameState` for this `SaveStore` contract, so the
// envelope-returning GameSource `load` is bound through the adapter rather than a
// clashing second `load` signature. Re-export the source seam from one place for callers
// that want the storage + source contracts together; the types stay owned by source.ts.
export type { GameSource, PersistedGame, CatalogEntry } from './source';

/**
 * The non-blocking write-failure signal (D-06). A persistence write can fail at the
 * durable boundary (quota exhausted / eviction, or a generic I/O fault). That failure
 * is a RETURN VALUE, never a throw-and-lose: `save()` returns `{ ok:false, reason }`
 * so the caller can surface "couldn't save — export your campaign" WITHOUT corrupting
 * or discarding the in-memory turn. Mirrors how `submitPaste` returns a recoverable
 * `{ ok:false }` rather than throwing (narrator.ts).
 */
export type SaveResult = { ok: true } | { ok: false; reason: 'quota' | 'io'; detail?: string };

/**
 * One row of `list()` — the campaign-picker projection (D-02: a REAL list, never a
 * stub). Carries only the metadata the chooser renders; the full event stream /
 * snapshots stay in the store until a campaign is `load()`ed.
 */
export interface CampaignRow {
	id: string;
	name: string;
	schemaVersion: number;
	createdAt: number;
	updatedAt: number;
	currentTurn: number;
}

/**
 * The storage swap seam (SAVE-01). Six Promise-returning methods so the Phase-5
 * Svelte glue `await`s them and the M8 `SqliteStore` is a pure drop-in:
 *
 *   - save         — append this turn's new events; snapshot on the cadence; returns the
 *                    D-06 SaveResult (quota is a recoverable return, not a throw).
 *   - loadEnvelope — the UNFOLDED read (LOAD-02 / D-LOCK-04): the latest snapshot + events-since
 *                    + the stored `schemaVersion`, for `loadGameState` (engine/load.ts) to
 *                    validate → migrate → fold. Carrying the version is the migration-on-resume
 *                    mechanism (the folded GameState has no version to gate on). null when the
 *                    campaign / any campaign does not exist. boot() crosses THIS, not load().
 *   - load         — the THIN folded-state wrapper over loadEnvelope (fold(latestSnapshot,
 *                    eventsSince)); kept for undoLastTurn / exportToString / the locked SAVE
 *                    suite. null when the campaign / any campaign does not exist.
 *   - list         — the campaign-picker rows (D-02 real list).
 *   - export       — write the campaign out as a downloadable `.frosty.json` (side effect).
 *   - import       — read an uploaded `.frosty.json`, shape-validate it, create a NEW
 *                    campaign (D-04 — never overwrite), and return the new campaign id.
 *   - undoLastTurn — drop EXACTLY the tail turn (every event row whose `turn === _currentTurn`
 *                    within this campaign's seq range) plus any cadence SNAPSHOT row taken AT
 *                    that turn, decrement the campaign's `currentTurn`, then return the prior-
 *                    turn fold via the UNCHANGED `load()` fold-forward (UI-07 / D-03). It is a
 *                    TAIL-delete on the append-only log — never a middle splice — and reuses the
 *                    audited forward fold rather than any reverse-fold replay. Returns the
 *                    historical pre-`_currentTurn` GameState, or null when the campaign is
 *                    unknown / has no remaining base after the drop.
 *   - deleteCampaign — IRREVERSIBLE cascade delete (CAMP-04 / D-03): remove the campaign row
 *                    AND every snapshot AND every event for the id in ONE atomic transaction,
 *                    leaving ZERO orphaned rows across all three stores. A recoverable
 *                    `Result<void>` — an I/O fault is a returned `{ok:false}`, never a throw.
 *   - rename       — display-name-only write (CAMP-03 / D-07): set ONLY `campaigns.name` and bump
 *                    `updatedAt`; NEVER touch `id` or the frozen `meta.campaignName` seed label
 *                    (the Phase-8 decoupling LOCK). An empty/whitespace name is a recoverable reject.
 *   - duplicate    — full-history clone (CAMP-06 / D-04 / D-08): copy the campaign row + every
 *                    snapshot + every event verbatim under a FRESH `randomId()` id with a
 *                    non-colliding `<name> (copy)` name; the copy is fully independent. Returns the
 *                    new campaign id (`Result<string>`, mirroring `import`).
 */
export interface SaveStore {
	save(
		_campaignId: string,
		_turn: number,
		_newEvents: GameEvent[],
		_state: GameState
	): Promise<SaveResult>;
	loadEnvelope(_campaignId?: string): Promise<PersistedGame | null>;
	load(_campaignId?: string): Promise<GameState | null>;
	list(): Promise<CampaignRow[]>;
	export(_campaignId: string): Promise<void>;
	import(_file: File): Promise<Result<string>>;
	undoLastTurn(_campaignId: string, _currentTurn: number): Promise<GameState | null>;
	deleteCampaign(_campaignId: string): Promise<Result<void>>;
	rename(_campaignId: string, _name: string): Promise<Result<void>>;
	duplicate(_campaignId: string): Promise<Result<string>>;
}
