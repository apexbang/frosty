// flushsave-no-duplicate.svelte.test.ts — REGRESSION for the flushSave event-duplication bug.
//
// BUG (debug session flushsave-event-duplication): game.flushSave() re-appended ALL events the
// per-turn autosave (turn.ts:162) had ALREADY persisted — save(id, currentTurn-1, prior, ...) +
// save(id, currentTurn, tail, ...). Because IdbSaveStore.save() appends every event via the
// non-idempotent events.add() (autoIncrement seq, no dedup), each background flush (pagehide /
// visibilitychange:hidden fires it in production) duplicated the whole post-snapshot event stream.
// On reload load() folds all events with seq > latestSnapshot.lastSeq, so the duplicates replay →
// narrativeLog gains repeated-turn entries → Svelte each_key_duplicate in NarrativePanel.
//
// RED before the fix: the events-store row count GROWS on every flush, and after a flush+reload the
// narrativeLog (folded state) carries duplicate-turn entries. GREEN after: flushing is idempotent —
// no row growth, exactly one narrativeLog entry per resolved turn.
//
// Mirrors reload-continuity's harness: the REAL game singleton + a REAL IdbSaveStore (DB 'frosty'),
// clearDb() between cases, a deterministic injected roller. Asserts on the PUBLIC reload behavior
// (folded narrativeLog) AND on a raw-IndexedDB event-row count (the duplicating write itself).

import { describe, test, expect, beforeEach } from 'vitest';

import { game } from '../../src/lib/game.svelte';
import { EXAMPLE_ENVELOPE_5_4 } from '../../src/lib/engine/examples';
import { IdbSaveStore } from '../../src/lib/idb-save-store';

function clearDb(): Promise<void> {
	return new Promise<void>((res) => {
		const r = indexedDB.deleteDatabase('frosty');
		r.onsuccess = r.onerror = r.onblocked = () => res(undefined);
	});
}

/** Raw-IndexedDB: total rows in the 'events' store for this campaign (the duplicating write). */
function countEventRows(campaignId: string): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const open = indexedDB.open('frosty');
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const db = open.result;
			const tx = db.transaction('events', 'readonly');
			const all = tx.objectStore('events').getAll();
			all.onsuccess = () => {
				const rows = all.result as { campaignId: string }[];
				resolve(rows.filter((r) => r.campaignId === campaignId).length);
			};
			tx.oncomplete = () => db.close();
			tx.onerror = () => reject(tx.error);
		};
	});
}

function installRoller(): void {
	(window as unknown as { __frostyRoller: unknown }).__frostyRoller = (
		actor: string,
		modifiers: { label: string; value: number }[],
		turn: number
	) => {
		const roll: [number, number] = [3, 4];
		const sum = modifiers.reduce((s, m) => s + m.value, 0);
		const net = Math.max(-3, Math.min(3, sum));
		const total = roll[0] + roll[1] + net;
		const band =
			total >= 10 ? 'success_clean' : total >= 7 ? 'success_costly' : total >= 5 ? 'stalled' : 'failure';
		return { kind: 'dice', actor, roll, modifiers, net, band, turn };
	};
}

async function awaitMachine(target: string): Promise<void> {
	for (let i = 0; i < 200; i++) {
		if (game.machine === target) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error(`machine never reached ${target} (stuck at ${game.machine})`);
}

/** Drive one full §5.4 turn through the bridge (which per-turn-saves the folded state). */
async function runOneTurn(): Promise<void> {
	game.startTurn('1st squad assaults the compound, two frags.');
	await awaitMachine('awaitingPaste');
	game.submitPaste(JSON.stringify(EXAMPLE_ENVELOPE_5_4));
	await awaitMachine('confirming');
	game.confirm();
	await new Promise((r) => setTimeout(r, 30));
}

beforeEach(async () => {
	await clearDb();
	game.__setSaveStoreForTest(new IdbSaveStore('frosty'));
	game.log = [];
	game.machine = 'idle';
	game.loadNotice = null;
	game.saveUnavailable = false;
	installRoller();
});

describe('flushSave is idempotent — backgrounding never duplicates the event stream', () => {
	test('repeated flushSave does not grow the persisted event-row count', async () => {
		await game.boot(); // fresh seed
		await runOneTurn(); // turn 1 — per-turn-saved incrementally
		await runOneTurn(); // turn 2 — per-turn-saved incrementally

		const id = game.campaignId;
		const baseline = await countEventRows(id);
		expect(baseline).toBeGreaterThan(0);

		// Background the tab three times (each fires flushSave). NOTHING new was resolved, so a
		// correct flush re-appends NO events. The buggy flush re-appends prior+tail every time.
		await game.flushSave();
		await game.flushSave();
		await game.flushSave();

		const afterFlushes = await countEventRows(id);
		expect(afterFlushes).toBe(baseline);
	});

	test('after flush + reload the folded narrativeLog has exactly one entry per resolved turn', async () => {
		await game.boot();
		await runOneTurn(); // narrative for turn 1
		await runOneTurn(); // narrative for turn 2

		// Background several times, then reload — the exact play-test sequence that surfaced the bug.
		await game.flushSave();
		await game.flushSave();
		await game.boot();

		const log = game.state!.narrativeLog;
		const turns = log.map((e) => e.turn);
		// Exactly one narrative entry per resolved turn, in order, no duplicates.
		expect(turns).toEqual([1, 2]);
		// The Svelte each-key invariant the NarrativePanel depends on: turns are unique.
		expect(new Set(turns).size).toBe(turns.length);
	});
});
