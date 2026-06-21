// save.ts — the save/export ENVELOPE type carrying `schemaVersion` (CORE-05) and
// the snapshot cadence constant N (CORE-04).
//
// Phase 1 establishes only the *type* + cadence constant; the actual persistence
// write path (idb) is Phase 4. Adding `schemaVersion` and `turn` now is nearly
// free and catastrophic to retrofit once real campaigns exist on disk
// (RESEARCH Pitfall 4). NO I/O, NO Svelte, NO idb import here.

import type { GameState } from './state';
import type { GameEvent } from './events';

/**
 * Snapshot cadence: snapshot every N turns (start N=10, tune later — CORE-04).
 * Always snapshot on export/migrate regardless of cadence (RESEARCH Pattern 1).
 */
export const SNAPSHOT_CADENCE_N = 10 as const;

/** A point-in-time materialized GameState plus the turn it was taken at. */
export interface Snapshot {
	turn: number;
	state: GameState;
}

/**
 * The save/export envelope. `schemaVersion` (CORE-05) versions the on-disk shape
 * so a future migration (Phase 4+) can fold older campaigns forward. The event
 * stream is the source of truth; snapshots keep replay cheap.
 */
export interface SaveEnvelope {
	schemaVersion: number;
	campaignName: string;
	/** Snapshots taken every SNAPSHOT_CADENCE_N turns (plus on export). */
	snapshots: Snapshot[];
	/** The append-only event log — the authority replay folds over. */
	events: GameEvent[];
}
