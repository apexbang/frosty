// migrate.ts — the D-05 migrate-forward seam, extracted to the pure engine so EVERY
// load path runs it (LOAD-02), not only `import()`. This is the migration-on-resume fix:
// today the migrate hook fires only on import; lifting `migrateForward` here lets
// `loadGameState` (load.ts) call it on local resume and on scenario load too.
//
// `migrateForward` is an IDENTITY today (CURRENT_SCHEMA_VERSION === 1, no prior on-disk
// shape to fold up — D-LOCK-06). The dispatch point exists so a real per-version
// migration is a PURE ADDITION later (no call-site change). The returned envelope is
// re-stamped at CURRENT so the loaded campaign records the current version (D-05).
//
// PURITY (CORE-02): imports CURRENT_SCHEMA_VERSION (value) from save-schema.ts and a
// TYPE-ONLY SaveEnvelope from save.ts — engine modules only. NO Svelte / idb / Blob /
// navigator. Plan 02 swaps idb-save-store.ts's LOCAL `migrateForward` for an import of
// this module (this plan does NOT touch idb-save-store.ts — it copies the body out).

import { CURRENT_SCHEMA_VERSION } from './save-schema';
import type { SaveEnvelope } from './save';

/**
 * Fold an older-`schemaVersion` envelope up to CURRENT (D-05). An IDENTITY today
 * (CURRENT_SCHEMA_VERSION === 1, no prior shape to migrate); the dispatch point exists
 * so a real per-version migration is a pure addition. Returns the envelope re-stamped at
 * CURRENT so the materialized/loaded campaign records the current version.
 */
export function migrateForward(env: SaveEnvelope): SaveEnvelope {
	// No older shapes exist yet; return the envelope re-stamped at CURRENT.
	return { ...env, schemaVersion: CURRENT_SCHEMA_VERSION };
}
