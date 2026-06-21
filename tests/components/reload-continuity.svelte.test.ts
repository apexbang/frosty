// reload-continuity.svelte.test.ts — CR-03 + CR-04 RED-first at the REAL bridge level.
//
// Phase 5 had no test exercising resupply + reload (the §5.4 example has no resupply) and
// none asserting list() returns exactly ONE campaign across seed→save→reload→save. Both
// gaps are closed here against the REAL game singleton + its REAL IdbSaveStore (DB 'frosty').
//
// CR-03: a resupply produced THROUGH fold (never appended raw to game.events) must survive
//   save → reload — post-reload game.remaining includes the +increment. RED today: fold's
//   resupply case is a no-op so consumables.resupplied is never materialized, and
//   eventsFromExpended drops resupply, so reload reverts to loadout − Σexpend.
// CR-04: a fresh campaign yields exactly one store row across seed→save→reload→save,
//   asserted via the PUBLIC game.listCampaigns() seam. RED today: the seed path keys on a
//   bare UUID while the reload path keys on 'starter-<uuid>' → a second row (fork).

import { describe, test, expect, beforeEach } from 'vitest';

import { game } from '../../src/lib/game.svelte';
import { fold } from '../../src/lib/engine/state';
import { EXAMPLE_ENVELOPE_5_4 } from '../../src/lib/engine/examples';
import { CURRENT_SCHEMA_VERSION } from '../../src/lib/engine';
import { IdbSaveStore } from '../../src/lib/idb-save-store';

function clearDb(): Promise<void> {
	return new Promise<void>((res) => {
		const r = indexedDB.deleteDatabase('frosty');
		r.onsuccess = r.onerror = r.onblocked = () => res(undefined);
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

/** Drive one full §5.4 turn through the bridge (which saves the folded state). */
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
	// Re-point the singleton at a FRESH IdbSaveStore so the prior test's cached IndexedDB
	// connection can never bleed a stale snapshot across the clearDb (deleteDatabase resolves on
	// onblocked without awaiting the cached connection's async close — a fresh store sidesteps the
	// race). Mirrors the boot-resilience afterEach store reset. The DB name is unchanged ('frosty').
	game.__setSaveStoreForTest(new IdbSaveStore('frosty'));
	game.log = [];
	game.machine = 'idle';
	game.loadNotice = null;
	game.saveUnavailable = false;
	installRoller();
});

describe('CR-03 — a resupply THROUGH fold survives save → reload', () => {
	test('post-reload remaining includes the resupply increment', async () => {
		await game.boot();

		// PHASE 8 (LOAD-05): boot mounts the CLEAN turn-0 starterScenario() — full loadout 6, NO
		// baked turn-2 expend (that quirk lives only in the §5.4 canary / seedStarter twin). So frag
		// remaining pre-resupply derives to the full loadout 6 (was 4 under the old turn-3 seed).
		expect(game.remaining['BLUE'].frag).toBe(6);

		// Apply a resupply THROUGH fold (NOT a raw game.events push) — this is what the
		// fix materializes into consumables.resupplied. from/to are NUMBERS (event shape).
		game.state = fold($state.snapshot(game.state!), [
			{ kind: 'resupply', side: 'BLUE', item: 'frag', from: 6, to: 8, source: 'logistics', turn: 5 }
		]);

		// Persist via the REAL save path (a turn through the bridge carries this state).
		await runOneTurn();

		// Reload against the SAME 'frosty' DB.
		await game.boot();

		// The +2 resupply increment must be present post-reload, and counted EXACTLY ONCE:
		// 6 (clean loadout) + 2 (resupply) − 2 (turn-4 frag expend from the §5.4 envelope) = 6.
		// A double-count (resupply summed twice across the reconstructed + live streams) would give
		// 8, masking a ledger-authority breach — so pin the exact value.
		expect(game.remaining['BLUE'].frag).toBe(6);
	});
});

describe('CR-04 — campaign identity is stable across seed → save → reload → save', () => {
	test('listCampaigns() returns exactly one row', async () => {
		await game.boot(); // fresh seed
		await runOneTurn(); // first save

		await game.boot(); // reload path
		await runOneTurn(); // second save

		const rows = await game.listCampaigns();
		expect(rows).toHaveLength(1);
	});
});

describe('UI-06 Slice A — narrative prose survives a full reload', () => {
	test('after a resolved turn, a fresh boot rebuilds game.log from state.narrativeLog', async () => {
		await game.boot(); // fresh seed

		// Resolve a turn whose envelope carries narrative prose (the §5.4 exemplar).
		await runOneTurn();
		expect(game.log.length).toBeGreaterThan(0);
		const prose = game.log[game.log.length - 1].narrative;
		expect(prose).toBeTruthy();

		// Drop the in-memory log to prove the rebuild comes from persisted state, not memory.
		game.log = [];

		// Reload against the SAME 'frosty' DB — boot() must rebuild this.log from
		// state.narrativeLog (the persisted narrative event folded into the saved state).
		await game.boot();

		expect(game.log.length).toBeGreaterThan(0);
		expect(game.log.some((e) => e.narrative === prose)).toBe(true);
	});
});

/** Raw-IndexedDB helper: mutate the persisted snapshot rows to simulate a pre-Phase-6
 *  save by deleting the narrativeLog field from each stored GameState (the field did not
 *  exist before this plan, so an old save's snapshot.state legitimately lacks it). */
function stripNarrativeLogFromSavedSnapshots(): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const open = indexedDB.open('frosty');
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const db = open.result;
			const tx = db.transaction('snapshots', 'readwrite');
			const store = tx.objectStore('snapshots');
			const all = store.getAll();
			all.onsuccess = () => {
				for (const row of all.result as { state: Record<string, unknown> }[]) {
					delete row.state.narrativeLog;
					store.put(row);
				}
			};
			tx.oncomplete = () => {
				db.close();
				resolve();
			};
			tx.onerror = () => reject(tx.error);
		};
	});
}

describe('UI-06 Slice A — a pre-Phase-6 save lacking narrativeLog boots to [] (Pitfall 5)', () => {
	test('boot() loads a persisted state without narrativeLog and defaults to [] without throwing', async () => {
		await game.boot(); // fresh seed
		await runOneTurn(); // persist a snapshot (a complete state)

		// Simulate the OLD save: strip narrativeLog from the persisted snapshot state so the
		// next load() returns a field-less GameState (exactly a pre-Phase-6 save).
		await stripNarrativeLogFromSavedSnapshots();

		// Reload against the SAME 'frosty' DB — boot()'s defensive default must apply.
		await expect(game.boot()).resolves.toBeUndefined();
		expect(game.state!.narrativeLog).toEqual([]);
	});
});

// ── Phase 8 live-bridge proofs (LOAD-02 / LOAD-03 / LOAD-04) ─────────────────────
//
// These cases prove the behaviors the engine units (load.test.ts) cannot: the migrate hook
// firing on a LOCAL RESUME (not only import), the forward-incompatible reject PRESERVING the
// rejected rows, and the rename-stable campaignId. They drive the REAL game singleton + its
// REAL IdbSaveStore (DB 'frosty') and manipulate the campaigns row schemaVersion/name directly
// via raw IndexedDB — the seam Phase 10's rename will write through.

/** Raw-IndexedDB: patch the single persisted `campaigns` row, returning its id. Used to
 *  simulate an older/newer save (set schemaVersion) and a Phase-10 rename (set name). */
function patchCampaignRow(patch: Partial<{ schemaVersion: number; name: string }>): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const open = indexedDB.open('frosty');
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const db = open.result;
			const tx = db.transaction('campaigns', 'readwrite');
			const store = tx.objectStore('campaigns');
			const all = store.getAll();
			let id = '';
			all.onsuccess = () => {
				const rows = all.result as { id: string; schemaVersion: number; name: string }[];
				const row = rows[0];
				id = row.id;
				store.put({ ...row, ...patch });
			};
			tx.oncomplete = () => {
				db.close();
				resolve(id);
			};
			tx.onerror = () => reject(tx.error);
		};
	});
}

/** Raw-IndexedDB: read a single `campaigns` row by id (null if absent) — proves a rejected
 *  campaign's rows survive (LOAD-03) without going through the bridge. */
function getCampaignRow(id: string): Promise<{ id: string; schemaVersion: number } | null> {
	return new Promise((resolve, reject) => {
		const open = indexedDB.open('frosty');
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const db = open.result;
			const tx = db.transaction('campaigns', 'readonly');
			const req = tx.objectStore('campaigns').get(id);
			req.onsuccess = () => {
				db.close();
				resolve((req.result as { id: string; schemaVersion: number }) ?? null);
			};
			req.onerror = () => {
				db.close();
				reject(req.error);
			};
		};
	});
}

describe('LOAD-02 — the migrate hook runs on LOCAL RESUME (not only import)', () => {
	test('a campaign stored at schemaVersion < CURRENT loads through the migrate branch on resume', async () => {
		await game.boot(); // fresh seed
		await runOneTurn(); // persist a real campaign

		// Patch the stored campaigns row to an OLDER schemaVersion (CURRENT - 1). This is the disk
		// shape a campaign written by a previous build has; on resume boot()'s loadEnvelope carries
		// that version into loadGameState, whose migrate gate fires because schemaVersion < CURRENT.
		const oldVersion = CURRENT_SCHEMA_VERSION - 1;
		const id = await patchCampaignRow({ schemaVersion: oldVersion });

		// Sanity: the disk row is genuinely at the older version (the migrate gate's input).
		const before = await getCampaignRow(id);
		expect(before?.schemaVersion).toBe(oldVersion);

		// Resume: boot() reads loadEnvelope (carrying schemaVersion oldVersion) and crosses
		// loadGameState — the migrate branch is taken because oldVersion < CURRENT. migrateForward
		// is identity TODAY (D-LOCK-06), so the assertion is that the campaign RESUMES SUCCESSFULLY
		// through the migrate path: a non-null, usable state, no reject notice. When a real
		// per-version migration lands, this test asserts the TRANSFORMED state — the mechanism
		// (migrate-on-resume, the latent gap closed) is what is proven here.
		await game.boot();
		expect(game.state).not.toBeNull();
		expect(game.loadNotice).toBeNull(); // an older save migrates forward — it is NOT rejected
		// The resumed campaign is the one we stored (campaignId is the stable row id, LOAD-04).
		expect(game.campaignId).toBe(id);
	});
});

describe('LOAD-03 — a newer-version save is rejected non-destructively; its rows are preserved', () => {
	test('boot lands on a usable starter + a recoverable notice + the rejected rows survive', async () => {
		await game.boot(); // fresh seed
		await runOneTurn(); // persist a real campaign

		// Patch the stored row to a NEWER schemaVersion (CURRENT + 1) — a save from a future build
		// this code cannot understand. On resume loadGameState returns { ok:false, reason:'newer-version' }.
		const rejectedId = await patchCampaignRow({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 });

		await game.boot();

		// (a) boot did NOT crash and landed on a usable, non-null state (the fresh starter).
		expect(game.state).not.toBeNull();
		expect(game.machine).toBe('idle');

		// (b) a non-destructive, recoverable notice is set (the LOAD-03 field).
		expect(game.loadNotice).toBeTruthy();

		// (c) boot mounted a FRESH campaign under a NEW id — NOT the rejected one (never reuse a
		// row you couldn't read).
		expect(game.campaignId).not.toBe(rejectedId);

		// (d) THE invariant (D-03): the rejected campaign's rows still exist on disk, untouched —
		// "never overwrite a campaign you couldn't read." A future build can still read it.
		const survivor = await getCampaignRow(rejectedId);
		expect(survivor).not.toBeNull();
		expect(survivor?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 1);
	});
});

describe('LOAD-04 — campaignId is stable across a display-name rename (Phase-10 rename seam)', () => {
	test('renaming only campaigns.name leaves campaignId unchanged + exactly one row', async () => {
		await game.boot(); // fresh seed
		await runOneTurn(); // first save → one campaign row
		const idBeforeRename = game.campaignId;
		expect(idBeforeRename.length).toBeGreaterThan(0);

		// Simulate the Phase-10 rename hook: write ONLY the display name on the SAME row id (the
		// campaignId/meta.campaignName decoupling means the row id is untouched by a rename).
		const renamedId = await patchCampaignRow({ name: 'My Renamed Campaign' });
		expect(renamedId).toBe(idBeforeRename); // the rename did not change the row id

		// Run another autosave (a turn through the bridge) AFTER the rename — autosave must keep
		// hitting the SAME row, not fork a second campaign keyed off the new name.
		await runOneTurn();

		// campaignId is UNCHANGED by the rename (it was never derived from meta.campaignName).
		expect(game.campaignId).toBe(idBeforeRename);

		// EXACTLY ONE campaign row across seed → save → rename → save (the rename did not fork).
		const rows = await game.listCampaigns();
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe(idBeforeRename);
		expect(rows[0].name).toBe('My Renamed Campaign'); // the rename did take effect on the row
	});
});
