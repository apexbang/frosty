// canary-5.4-persisted.ts — the §5.4 worked example as its OWN turn-3 `PersistedGame`
// (D-02). A scenario IS a save at turn 0 (D-LOCK-01); by the same token the §5.4 canary
// is a save at turn 3 — snapshot @ turn 3 + the §5.4 turn-4 event list — that must fold
// THROUGH the unified `loadGameState` path to the canonical §5.4 state-after
// (Success-Criterion 1 / must-have #6: remaining('frag') → 2, remaining('smoke') → 4).
//
// PITFALL 5 (do NOT hand-re-author the numbers): the snapshot state is built FROM
// `stateBefore_5_4()` (the shared engine fixture) and the events ARE `events_5_4`
// (the canonical turn-4 list). Re-authoring either by hand would let this drift from
// the §5.4 contract of record. The §5.4 frag→2 derive is only REACHABLE when the
// turn-4 events fold over the turn-3 base (6 − 2(turn-2, baked in the snapshot's
// `consumables.expended`) − 2(turn-4, in `events_5_4`) = 2), so the canary carries the
// turn-4 events — an empty events array would derive frag → 4 and could never satisfy
// must-have #6.  smoke (4) appears in NO expend entry and is the immovable canary.
//
// PURITY: imports the shared §5.4 fixture + the engine `PersistedGame` alias only.
// NO Svelte / idb / valibot.

import type { PersistedGame } from '../../../src/lib/engine/source';
import { CURRENT_SCHEMA_VERSION } from '../../../src/lib/engine/save-schema';
import { stateBefore_5_4, events_5_4 } from './worked-example-5.4';

/**
 * The §5.4 worked example as a turn-3 `PersistedGame` (D-02). A fresh value every call
 * (`stateBefore_5_4()` is a factory) so a test that folds it never mutates a shared base.
 *
 *   - snapshots: [{ turn: 3, state: stateBefore_5_4() }] — the turn-3 base, carrying the
 *     baked turn-2 frag expend in `consumables.expended`.
 *   - events: events_5_4 — the canonical §5.4 turn-4 event list, folded over the base by
 *     `loadGameState` to produce the state-after (frag → 2, smoke → 4).
 */
export function canary5_4Persisted(): PersistedGame {
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		campaignName: 'worked-example-5.4',
		snapshots: [{ turn: 3, state: stateBefore_5_4() }],
		events: events_5_4
	};
}
