// switch-campaign-flush-guard.svelte.test.ts — THE phase-10 correctness anchor (D-02 / CAMP-07).
//
// `switchCampaign(id)` reassigns campaignId + state + events ATOMICALLY through the ONE
// `loadGameState` materialize path, and a `#switchEpoch` token makes a background `flushSave`
// captured under the PRIOR campaign safe: a late flush that began under campaign A while the
// player switches to B is DISCARDED on resolve (epoch/id changed) — it can NEVER write into B's
// event stream nor re-append into A's. This generalizes the 8f23f0e idempotency `const id`
// capture (flushsave-no-duplicate.svelte.test.ts) into an explicit generation token.
//
// Mirrors flushsave-no-duplicate's harness VERBATIM: the REAL `game` singleton + a REAL
// IdbSaveStore (DB 'frosty'), clearDb() between cases, the injected deterministic `__frostyRoller`,
// and a raw-IndexedDB `countEventRows(campaignId)` that bypasses the events() projection to prove
// — at the storage layer — that no stale write landed. Campaign B is seeded via the store's
// `duplicate()` verb (Plan 01) so it is a real, independent on-disk campaign.
//
// RED before Task 2: `switchCampaign is not a function` and the `#switchEpoch` discard does not
// exist yet. Do NOT weaken the cross-write assertion (raw row counts on BOTH A and B) to compile.

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

/** Raw-IndexedDB: total rows in the 'events' store for this campaign (the stale-write witness). */
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

describe('switchCampaign — atomic swap + epoch-guarded late flush (D-02 / CAMP-07)', () => {
	test('a late flush captured under the prior campaign does NOT cross-write (raw rows, BOTH A and B)', async () => {
		// Boot campaign A and resolve two turns so A has a real persisted event stream.
		await game.boot();
		await runOneTurn();
		await runOneTurn();
		const idA = game.campaignId;

		// Seed campaign B as a real, independent on-disk campaign (Plan-01 store verb).
		const store = new IdbSaveStore('frosty');
		const dup = await store.duplicate(idA);
		expect(dup.ok).toBe(true);
		const idB = dup.ok ? dup.value : '';
		expect(idB).not.toBe('');
		expect(idB).not.toBe(idA);

		const baselineA = await countEventRows(idA);
		const baselineB = await countEventRows(idB);
		expect(baselineA).toBeGreaterThan(0);
		expect(baselineB).toBeGreaterThan(0);

		// Stage a late flush: capture a flushSave promise on A BEFORE switching, do NOT await it
		// yet. The epoch bump inside switchCampaign(B) must happen "under" this in-flight flush so
		// its resolve-time guard discards it (it was captured under A's epoch/id).
		const lateFlush = game.flushSave();
		await game.switchCampaign(idB);
		await lateFlush; // let the prior-campaign flush settle — it must NOT write anywhere.

		// The stale flush wrote into NEITHER campaign's event stream.
		expect(await countEventRows(idA)).toBe(baselineA);
		expect(await countEventRows(idB)).toBe(baselineB);
		// After the swap, the live campaign is B.
		expect(game.campaignId).toBe(idB);
	});

	test('atomic swap — a single live id: campaignId + state + events all correspond to B together', async () => {
		await game.boot();
		await runOneTurn(); // A at turn 1
		await runOneTurn(); // A at turn 2
		const idA = game.campaignId;
		const turnsA = game.state!.meta.turn;

		// B is a duplicate captured at A's turn-2 — then we advance A so the two campaigns DIVERGE
		// (A's live turn moves on; B stays at the duplicated turn). After switchCampaign(B) every
		// field (campaignId, state.meta.turn, events) must read B together, never a mix of A and B.
		const store = new IdbSaveStore('frosty');
		const dup = await store.duplicate(idA);
		const idB = dup.ok ? dup.value : '';

		// What B folds to through the EXACT path switchCampaign uses (loadEnvelope → fold). Capturing
		// it here (before we advance A) pins the self-consistency target without hard-coding the
		// persistence layer's fold arithmetic.
		const bEnvelope = await store.loadEnvelope(idB);
		const bFoldedTurn = bEnvelope!.snapshots[bEnvelope!.snapshots.length - 1].state.meta.turn;
		const bMaxEventTurn = bEnvelope!.events.reduce((m, e) => Math.max(m, e.turn), 0);

		await runOneTurn(); // A advances to turn 3; B's persisted row is unchanged.
		const advancedTurnA = game.state!.meta.turn;
		expect(advancedTurnA).toBeGreaterThan(turnsA);

		await game.switchCampaign(idB);

		// The atomic quartet: id is B, the live folded state corresponds to B's persisted fold, and
		// the live event stream is B's — no field still reads A (the live state diverged from A's
		// advanced turn, proving the swap is whole, not a partial mix).
		expect(game.campaignId).toBe(idB);
		const liveTurn = game.state!.meta.turn;
		const maxEventTurn = game.events.reduce((m, e) => Math.max(m, e.turn), 0);
		expect(liveTurn).toBe(bFoldedTurn); // state reads B, not A.
		expect(maxEventTurn).toBe(bMaxEventTurn); // events read B, not A.
		expect(maxEventTurn).not.toBe(advancedTurnA); // provably NOT A's diverged stream.
	});

	test('switch goes through loadGameState; a missing/degenerate row is recoverable (no throw, id unchanged)', async () => {
		await game.boot();
		await runOneTurn();
		const idA = game.campaignId;

		// Switching to a non-existent id: loadEnvelope returns null → recoverable, campaignId stays A.
		await expect(game.switchCampaign('no-such-campaign-id')).resolves.toBeUndefined();
		expect(game.campaignId).toBe(idA);
		// The live campaign is untouched and still usable.
		expect(game.state).not.toBeNull();

		// A valid switch (round-trip to a duplicate) resumes through the folded path.
		const store = new IdbSaveStore('frosty');
		const dup = await store.duplicate(idA);
		const idB = dup.ok ? dup.value : '';
		await game.switchCampaign(idB);
		expect(game.campaignId).toBe(idB);
		expect(game.state).not.toBeNull();
	});

	test('deleting the ACTIVE campaign does NOT resurrect it on the fallback switch flush (CR-01)', async () => {
		// Boot campaign A and resolve a turn so A has a real persisted event stream (currentTurn ≥ 1).
		// This is the exact precondition under which the bug fired: flushSave's "behind" branch
		// (persisted === null after the cascade) re-wrote the deleted base+tail back to disk.
		await game.boot();
		await runOneTurn();
		const idA = game.campaignId;

		// Seed campaign B as a real, independent on-disk campaign so the active-delete fallback has a
		// next-most-recent row to switch to (it drives switchCampaign(B), whose step-2 flush is the
		// resurrecting write).
		const store = new IdbSaveStore('frosty');
		const dup = await store.duplicate(idA);
		expect(dup.ok).toBe(true);
		const idB = dup.ok ? dup.value : '';
		expect(idB).not.toBe('');
		expect(idB).not.toBe(idA);

		// Both rows exist before the delete.
		const before = await store.list();
		expect(before.some((r) => r.id === idA)).toBe(true);
		expect(before.some((r) => r.id === idB)).toBe(true);

		// Delete the ACTIVE campaign (A). The bridge cascade-deletes A, then — because A was live —
		// falls to the next-most-recent (B) via switchCampaign, whose flushSave settles BEFORE the
		// swap. The deleted A must STAY deleted: flushSave must not re-create its row.
		await game.deleteCampaign(idA);

		// The fallback switch settled the live campaign onto B.
		expect(game.campaignId).toBe(idB);

		// THE ASSERTION (RED before the CR-01 fix): the deleted A is gone for good — list() no longer
		// contains it. Before the fix, flushSave's "behind"(null) branch re-persisted A's base+events
		// and IdbSaveStore.save's isFirstSave path re-created the campaigns row, so A reappeared here.
		const after = await store.list();
		expect(after.some((r) => r.id === idA)).toBe(false);
		expect(after.some((r) => r.id === idB)).toBe(true);
		expect(await countEventRows(idA)).toBe(0);
	});

	test('boot resilience preserved — a normal boot still auto-resumes to usable state', async () => {
		await game.boot();
		await runOneTurn();
		// Re-boot (the device-hardening auto-resume arm) lands on non-null usable state.
		await game.boot();
		expect(game.state).not.toBeNull();
		expect(game.machine).toBe('idle');
	});
});
