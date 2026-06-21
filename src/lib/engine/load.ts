// load.ts — the ONE validated load entry point (LOAD-01, LOAD-02, LOAD-03, LOAD-05).
//
// `loadGameState(persisted)` is the single path every game source crosses — a resumed save
// (turn N), a shipped scenario (turn 0), the §5.4 canary. It composes the trust-boundary
// idiom verbatim from `import()`: validate (shape) → migrate (if schemaVersion < CURRENT)
// → fold (latest snapshot + events since). It returns a discriminated `LoadResult` and
// NEVER throws — the function is TOTAL (the DoS mitigation, T-08-03). A scenario IS a save
// at turn 0 (D-LOCK-01), so turn-0 and turn-N take the identical path; "two flows would
// drift" is structurally impossible here.
//
// SHAPE GATE FIRST (Pitfall 5 / T-08-01/02): `validateSaveEnvelope` (valibot strictObject
// allow-list) runs before ANY field is read — `persisted.schemaVersion` is never touched on
// untrusted input until the gate returns ok. The migrate hook (LOAD-02) now runs on EVERY
// load, not only `import()` (the migration-on-resume fix). The no-base envelope is rejected
// as shape-invalid (Open Question 2 / T-08-04 phantom-state guard).
//
// PURITY (CORE-02): imports engine modules only — validateSaveEnvelope + CURRENT_SCHEMA_VERSION
// (save-schema.ts), migrateForward (migrate.ts), fold (state.ts), and TYPE-ONLY shapes. NO
// Svelte / idb / valibot directly. It composes the audited `fold`; it NEVER reimplements
// replay (mirrors idb-save-store.ts:230-249 over the envelope's arrays).

import { validateSaveEnvelope, CURRENT_SCHEMA_VERSION } from './save-schema';
import { migrateForward } from './migrate';
import { validateSeed } from './validate-seed';
import { fold } from './state';
import type { GameState } from './state';
import type { GameEvent } from './events';

/**
 * The result of crossing the load boundary (D-03 — a recoverable discriminated union, never
 * a throw, modelled on the envelope-schema.ts `Result<T>` trust idiom but richer: the ok arm
 * carries the FOLDED state plus the event stream so the bridge can adopt both without a
 * second fold). The two reject arms carry a `reason` discriminant the bridge maps to a
 * non-destructive UI message ("saved by a newer version" vs "couldn't read this save").
 */
export type LoadResult =
	| { ok: true; state: GameState; events: GameEvent[] }
	| { ok: false; reason: 'shape-invalid'; error: string }
	| { ok: false; reason: 'newer-version'; error: string }
	| { ok: false; reason: 'illegal-seed'; error: string };

/**
 * `loadGameState(persisted)` — validate → migrate → fold → `LoadResult`. TOTAL: every input
 * (a valid envelope, a forged shape, a future-version save, a no-base envelope) returns a
 * `LoadResult`; it NEVER throws (LOAD-03 / T-08-03).
 *
 *   1. SHAPE GATE FIRST — `validateSaveEnvelope`; a bad shape (extra key, missing/forged
 *      schemaVersion, wrong type) → `shape-invalid` (T-08-01/02, Pitfall 5).
 *   2. VERSION GATE — `schemaVersion > CURRENT` → `newer-version` (a save from a newer build
 *      this code cannot understand; LOAD-03). Recoverable, never a throw.
 *   3. MIGRATE — `schemaVersion < CURRENT` → `migrateForward` (LOAD-02 — now on EVERY load).
 *   4. NO-BASE GUARD — `snapshots: []` → `shape-invalid` (Open Question 2 / T-08-04: no base
 *      to fold means a phantom state; reject rather than fabricate one).
 *   4b. SEED GATE — `validateSeed` over the highest-turn snapshot's state (the seed/base).
 *      A structurally-illegal seed (a capability also in `prohibited`; a loadout referencing
 *      an off-manifest capability) → `illegal-seed`, the rejection surfacing AT LOAD with a
 *      clear reason naming the conflict (SCEN-03 — "never three turns later"). The SAME
 *      validator therefore gates EVERY source crossing this ONE path (shipped + generated +
 *      resumed). Legality/coherence ONLY — never plausibility (SCEN-04).
 *   5. FOLD — pick the highest-turn snapshot, fold `events` over it (composes the audited
 *      `fold`; never a hand-rolled replay). Return `{ ok:true, state, events }`.
 */
export function loadGameState(persisted: unknown): LoadResult {
	// 1. SHAPE GATE FIRST — never read persisted.schemaVersion before this (Pitfall 5).
	const validated = validateSaveEnvelope(persisted);
	if (!validated.ok) {
		return { ok: false, reason: 'shape-invalid', error: validated.error };
	}

	// 2. VERSION GATE — a save from a NEWER build cannot be understood here (LOAD-03).
	if (validated.value.schemaVersion > CURRENT_SCHEMA_VERSION) {
		return {
			ok: false,
			reason: 'newer-version',
			error: 'This save is from a newer version of Frosty.'
		};
	}

	// 3. MIGRATE — older shapes fold up to CURRENT; identity today, on EVERY load (LOAD-02).
	const env =
		validated.value.schemaVersion < CURRENT_SCHEMA_VERSION
			? migrateForward(validated.value)
			: validated.value;

	// 4. NO-BASE GUARD — no snapshot means no base to fold; reject rather than fabricate
	//    a phantom state (Open Question 2 / T-08-04). Defensive even though the schema's
	//    minLength(1) already rejects this — load.ts stays correct without the schema guard.
	if (env.snapshots.length === 0) {
		return { ok: false, reason: 'shape-invalid', error: 'Save has no snapshot to load from.' };
	}

	// Highest-turn snapshot is the seed/base for BOTH the domain gate and the fold.
	const snap = env.snapshots.reduce(
		(best, s) => (s.turn >= best.turn ? s : best),
		env.snapshots[0]
	);

	// 4b. SEED GATE — domain well-formedness (legality + coherence) on the base state,
	//     BEFORE fold so an illegal seed is rejected up front with a clear reason (SCEN-03),
	//     not three turns later. Unbypassable: composed inside the ONE load path (T-09A-01).
	const seed = validateSeed(snap.state);
	if (!seed.ok) {
		return { ok: false, reason: 'illegal-seed', error: seed.reason };
	}

	// 5. FOLD — fold the events over the base (mirror idb-save-store.ts:249 over the
	//    envelope's arrays; NEVER reimplement replay).
	const state = fold(snap.state, env.events);
	// Phase 13 (OBJ-04) boot default — parity with the `narrativeLog ??= []` discipline. `briefing`
	// is OPTIONAL, so there is NO meaningful non-empty default to fabricate: the normalizer is a
	// no-op that leaves an absent briefing absent (a briefing-less seed loads cleanly, no schema
	// bump). Downstream UI guards `state.briefing` for undefined.
	state.briefing ??= undefined;
	return { ok: true, state, events: env.events };
}
