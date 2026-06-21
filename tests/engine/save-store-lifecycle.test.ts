// save-store-lifecycle.test.ts — the RED store-contract suite for the THREE net-new
// Phase-10 lifecycle verbs (Plan 10-01 / CAMP-03/04/06):
//   deleteCampaign — cascade across { campaigns, snapshots, events }, ZERO orphaned rows (CAMP-04 / D-03)
//   rename         — display-name-only write; id + meta.campaignName untouched (CAMP-03 / D-07 / Phase-8 D-04)
//   duplicate      — verbatim full-history clone under a fresh randomId(), independent (CAMP-06 / D-04 / D-08)
//
// Modeled on save-store.test.ts (fresh unique-named DB per case, fake-indexeddb, the
// §5.4 fixture seed via the existing save() path). The delete-cascade anchor (Test 1)
// is the single highest-stakes item: it asserts ZERO RESIDUAL rows via a RAW IndexedDB
// row count (mirroring countEventRows in flushsave-no-duplicate.svelte.test.ts), not
// only the events()/snapshotTurns() projections — an orphaned-row class the projections
// could miss.
//
// RED CONDITION: deleteCampaign / rename / duplicate do not yet exist on IdbSaveStore
// (Task 2 lands them). The suite fails for "deleteCampaign is not a function" etc., NOT
// a type error — the calls go through a `lifecycle(store)` cast against the extended
// contract so RED compiles without weakening any assertion. The existing
// save-store.test.ts suite stays GREEN (file-disjoint, fresh DB per case).
//
// PURITY: engine modules + the shared §5.4 fixture + the non-engine store; runs headless
// under fake-indexeddb (registered by tests/engine/setup/fake-idb.ts — the engine project).

import { describe, test, expect, beforeEach } from 'vitest';
import { fold } from '../../src/lib/engine/state';
import type { Result } from '../../src/lib/engine';
import { IdbSaveStore } from '../../src/lib/idb-save-store';
import { stateBefore_5_4, events_5_4, priorEvents_5_4 } from './fixtures/worked-example-5.4';

// The three lifecycle verbs Task 2 adds to the SaveStore interface + IdbSaveStore. The
// cast lets the RED suite call them against the extended contract so it fails for the
// missing-method reason (not a TS error) before the impl lands; once Task 2 declares
// them on the class these shapes match the real signatures verbatim.
interface LifecycleStore {
	deleteCampaign(_id: string): Promise<Result<void>>;
	rename(_id: string, _name: string): Promise<Result<void>>;
	duplicate(_id: string): Promise<Result<string>>;
}
const lifecycle = (s: IdbSaveStore): LifecycleStore => s as unknown as LifecycleStore;

let store: IdbSaveStore;
let dbName: string;
let seq = 0;

beforeEach(() => {
	dbName = `frosty-lifecycle-${Date.now()}-${seq++}`;
	store = new IdbSaveStore(dbName);
});

/** Seed a campaign with prior (turn-3 base) + a turn-4 autosave (the §5.4 stream). */
async function seedCampaign(id: string): Promise<void> {
	const base = stateBefore_5_4();
	await store.save(id, 3, priorEvents_5_4, fold(base, priorEvents_5_4));
	const afterTurn4 = fold(fold(base, priorEvents_5_4), events_5_4);
	await store.save(id, 4, events_5_4, afterTurn4);
}

/**
 * Raw-IndexedDB residual-row count for a campaign (mirrors countEventRows in
 * flushsave-no-duplicate.svelte.test.ts, extended to snapshots). Bypasses the
 * events()/snapshotTurns() projections entirely so an orphaned row the projections
 * filter or miss is still counted. Counts over the campaign's full ranges:
 *   events    — every EventRow whose campaignId === id
 *   snapshots — every SnapshotRow over [id, -Infinity]…[id, Infinity]
 *   campaigns — the campaign key itself
 */
function rawResidualCounts(
	id: string
): Promise<{ events: number; snapshots: number; campaign: number }> {
	return new Promise((resolve, reject) => {
		const open = indexedDB.open(dbName);
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const db = open.result;
			const tx = db.transaction(['events', 'snapshots', 'campaigns'], 'readonly');
			const evAll = tx.objectStore('events').getAll();
			const snapAll = tx
				.objectStore('snapshots')
				.getAll(IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
			const campGet = tx.objectStore('campaigns').get(id);
			tx.oncomplete = () => {
				const events = (evAll.result as { campaignId: string }[]).filter(
					(r) => r.campaignId === id
				).length;
				const snapshots = (snapAll.result as unknown[]).length;
				const campaign = campGet.result === undefined ? 0 : 1;
				db.close();
				resolve({ events, snapshots, campaign });
			};
			tx.onerror = () => reject(tx.error);
		};
	});
}

// ── Test 1 (THE anchor): delete cascade leaves ZERO residual rows; sibling untouched ──
describe('CAMP-04 — deleteCampaign cascades across all three stores (zero orphaned rows)', () => {
	test('the ZERO-RESIDUAL ANCHOR: every event + snapshot + campaign row for the id is gone (raw count); a sibling campaign is untouched', async () => {
		const target = 'campaign-delete-target';
		const sibling = 'campaign-delete-sibling';
		await seedCampaign(target);
		await seedCampaign(sibling);

		// Pre-delete sanity: the target carries real rows (events + a base snapshot).
		const before = await rawResidualCounts(target);
		expect(before.events).toBeGreaterThan(1); // N>1 turns of events
		expect(before.snapshots).toBeGreaterThanOrEqual(1);
		expect(before.campaign).toBe(1);

		const res = await lifecycle(store).deleteCampaign(target);
		expect(res.ok).toBe(true);

		// The list() projection no longer contains the id.
		const rows = await store.list();
		expect(rows.find((r) => r.id === target)).toBeUndefined();

		// The store projections report zero for the deleted id.
		expect(await store.events(target)).toEqual([]);
		expect(await store.snapshotTurns(target)).toEqual([]);

		// RAW row count (bypasses the projections): exactly zero residual rows in ALL
		// three stores — no orphaned event/snapshot row survives the cascade.
		const after = await rawResidualCounts(target);
		expect(after.events).toBe(0);
		expect(after.snapshots).toBe(0);
		expect(after.campaign).toBe(0);

		// The sibling campaign is FULLY untouched — its rows survive verbatim.
		const siblingAfter = await rawResidualCounts(sibling);
		expect(siblingAfter.events).toBe(before.events);
		expect(siblingAfter.snapshots).toBe(before.snapshots);
		expect(siblingAfter.campaign).toBe(1);
		expect((await store.list()).find((r) => r.id === sibling)).toBeDefined();
	});
});

// ── Test 2: delete result shape + unknown-id is recoverable (never throws) ──────
describe('CAMP-04 — deleteCampaign returns the recoverable Result idiom', () => {
	test('deleteCampaign returns { ok: true } on a real campaign', async () => {
		const id = 'campaign-delete-ok';
		await seedCampaign(id);
		const res = await lifecycle(store).deleteCampaign(id);
		expect(res.ok).toBe(true);
	});

	test('deleteCampaign of an unknown id never throws (recoverable ok or {ok:false})', async () => {
		let threw = false;
		let res: Result<void> | undefined;
		try {
			res = await lifecycle(store).deleteCampaign('no-such-campaign');
		} catch {
			threw = true;
		}
		expect(threw).toBe(false); // recoverable — never throw-and-lose.
		expect(res).toBeDefined();
		expect(typeof res!.ok).toBe('boolean');
	});
});

// ── Test 3: rename is display-name-only (id stable, meta.campaignName frozen, updatedAt bumped) ──
describe('CAMP-03 — rename writes ONLY campaigns.name + updatedAt (id + meta.campaignName untouched)', () => {
	test('rename floats the row name, leaves id byte-identical, leaves the frozen seed meta.campaignName unchanged, bumps updatedAt', async () => {
		const id = 'campaign-rename';
		await seedCampaign(id);

		const rowBefore = (await store.list()).find((r) => r.id === id)!;
		const envBefore = await store.loadEnvelope(id);
		expect(envBefore).not.toBeNull();
		// The FROZEN seed label lives INSIDE the snapshot state (meta.campaignName) — the
		// Phase-8 decoupling LOCK. The envelope's TOP-LEVEL campaignName is derived from the
		// campaign ROW name (loadEnvelope: `campaignName: campaignRow.name`) and SO it
		// reflects a rename; meta.campaignName must NOT. Assert against the frozen state field.
		const frozenSeedName = envBefore!.snapshots[0].state.meta.campaignName;

		// A clock tick so updatedAt can strictly increase even on a fast machine.
		await new Promise((r) => setTimeout(r, 2));

		const res = await lifecycle(store).rename(id, 'New Name');
		expect(res.ok).toBe(true);

		const rowAfter = (await store.list()).find((r) => r.id === id)!;
		expect(rowAfter.name).toBe('New Name'); // the display name changed …
		expect(rowAfter.id).toBe(rowBefore.id); // … the id is byte-identical …
		expect(rowAfter.updatedAt).toBeGreaterThanOrEqual(rowBefore.updatedAt); // … updatedAt bumped …

		// … and the frozen seed label (the snapshot state's meta.campaignName) is UNCHANGED
		// — rename never touches it (Phase-8 D-04 decoupling LOCK). The envelope's top-level
		// campaignName tracks the row name and SO equals the new display name (proving the
		// two are decoupled: the row name moved, the frozen seed label did not).
		const envAfter = await store.loadEnvelope(id);
		expect(envAfter!.snapshots[0].state.meta.campaignName).toBe(frozenSeedName);
		expect(envAfter!.campaignName).toBe('New Name');
	});
});

// ── Test 4: rename empty/whitespace is a recoverable reject; stored name unchanged ──
describe('CAMP-03 — rename rejects an empty name (recoverable, no write)', () => {
	test('rename(id, "") returns { ok: false } and the stored name is unchanged', async () => {
		const id = 'campaign-rename-empty';
		await seedCampaign(id);
		const nameBefore = (await store.list()).find((r) => r.id === id)!.name;

		const res = await lifecycle(store).rename(id, '');
		expect(res.ok).toBe(false);

		const nameAfter = (await store.list()).find((r) => r.id === id)!.name;
		expect(nameAfter).toBe(nameBefore); // no write happened.
	});
});

// ── Test 5: duplicate is a verbatim, independent full-history clone under a fresh id ──
describe('CAMP-06 — duplicate clones the full history under a fresh id; the copy is independent (D-04)', () => {
	test('duplicate returns a NEW id with a "(copy)" name; events + snapshotTurns deep-equal the source; deleting the COPY leaves the source intact', async () => {
		const id = 'campaign-duplicate';
		await seedCampaign(id);

		const srcRow = (await store.list()).find((r) => r.id === id)!;
		const srcEvents = await store.events(id);
		const srcSnapTurns = await store.snapshotTurns(id);

		const res = await lifecycle(store).duplicate(id);
		expect(res.ok).toBe(true);
		if (!res.ok) return;

		const newId = res.value;
		expect(newId).not.toBe(id); // a FRESH id, never the source id.

		const copyRow = (await store.list()).find((r) => r.id === newId)!;
		expect(copyRow).toBeDefined();
		expect(copyRow.name).toBe(`${srcRow.name} (copy)`); // D-08 "(copy)" suffix.

		// The clone is VERBATIM: the same events (in append order) + the same cadence snapshots.
		expect(await store.events(newId)).toEqual(srcEvents);
		expect(await store.snapshotTurns(newId)).toEqual(srcSnapTurns);

		// The copy is FULLY INDEPENDENT (D-04): deleting it leaves the source untouched.
		const del = await lifecycle(store).deleteCampaign(newId);
		expect(del.ok).toBe(true);
		expect((await store.list()).find((r) => r.id === newId)).toBeUndefined();
		// Source survives verbatim — events + the campaign row + the rename target all intact.
		expect((await store.list()).find((r) => r.id === id)).toBeDefined();
		expect(await store.events(id)).toEqual(srcEvents);
	});

	test('a "(copy)" name collision is suffixed further so every campaign name is unique', async () => {
		const id = 'campaign-duplicate-collision';
		await seedCampaign(id);

		// Two duplicates of the same source: the first is "<name> (copy)", the second must
		// disambiguate further (never a silent duplicate name).
		const first = await lifecycle(store).duplicate(id);
		const second = await lifecycle(store).duplicate(id);
		expect(first.ok && second.ok).toBe(true);

		const names = (await store.list()).map((r) => r.name);
		expect(new Set(names).size).toBe(names.length); // all names unique.
	});
});
