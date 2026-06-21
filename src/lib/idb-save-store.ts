// idb-save-store.ts — the NON-engine `idb`-backed `SaveStore` implementation.
//
// PLACEMENT (CRITICAL — RESEARCH Pitfall 1): this file lives at `src/lib/`, OUTSIDE
// `src/lib/engine/`. `idb`, `Blob`, `FileReader`, and `navigator.storage` are browser
// APIs the pure engine must never import. The CORE-02 ESLint gate is scoped to
// `src/lib/engine/**` and additionally bans `idb` there — placement here keeps the
// engine/non-engine split honest (and lint-enforced) while this impl is free to use
// the browser surfaces the engine cannot.
//
// It implements the pure `SaveStore` seam (engine/save-store.ts) over a normalized
// `{campaigns, snapshots, events}` IndexedDB schema that maps 1:1 to three future
// SQLite tables (SAVE-06). Load composes the audited `fold` (engine/state.ts) — it
// NEVER reimplements replay. Cadence is the pure `SNAPSHOT_CADENCE_N` arithmetic.
//
// CONSTRUCTOR: `new IdbSaveStore(dbName)` — takes a string DB name and opens its own
// DB lazily/internally. Under `fake-indexeddb` (registered globally by the Vitest
// setup file) a plain `openDB(dbName, 1, { upgrade })` works headlessly.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { randomId } from './seed';
import { fold } from './engine/state';
import type { GameState } from './engine/state';
import type { GameEvent } from './engine/events';
import { SNAPSHOT_CADENCE_N } from './engine/save';
import type { Snapshot, SaveEnvelope } from './engine/save';
import { CURRENT_SCHEMA_VERSION, validateSaveEnvelope, migrateForward } from './engine';
import type { SaveStore, SaveResult, CampaignRow } from './engine';
import type { GameSource, CatalogEntry, PersistedGame } from './engine';
import type { Result } from './engine';

// ── Row shapes (the on-disk projections; NOT the engine types) ─────────────────

/** A snapshot row: the materialized state plus the seq of the last event folded in. */
interface SnapshotRow {
	campaignId: string;
	turn: number;
	state: GameState;
	/** The seq of the last event folded into `state` — "events since" is `seq > lastSeq`. */
	lastSeq: number;
	/**
	 * True for a cadence snapshot (turn % N === 0). A campaign's FIRST save also writes
	 * a snapshot — the BASE the fold replays from — but it is NOT a cadence snapshot, so
	 * `isCadence` is false and `snapshotTurns()` (the cadence-assertion hook) excludes it.
	 * `load()` uses the latest snapshot by turn regardless of this flag.
	 */
	isCadence: boolean;
}

/** An event row: a `GameEvent` tagged with its campaign; `seq` is the autoIncrement PK. */
type EventRow = GameEvent & { campaignId: string; seq: number };

/**
 * The normalized 3-store schema. Maps 1:1 to three future SQLite tables (SAVE-06):
 *   campaigns(id PK, …)  ·  snapshots([campaignId,turn] PK, …)  ·  events(seq PK, …)
 * Events order by the monotonic autoIncrement `seq` (NOT `turn` — multiple events
 * share one turn, so `turn` is not a total order; `fold` is an ordered left-fold).
 */
interface FrostyDB extends DBSchema {
	campaigns: {
		key: string;
		value: CampaignRow;
		indexes: { by_updatedAt: number };
	};
	snapshots: {
		key: [string, number];
		value: SnapshotRow;
	};
	events: {
		key: number;
		value: EventRow;
		indexes: { by_campaign_seq: [string, number] };
	};
}

/**
 * The idb-backed `SaveStore`. Construct with a DB name; the DB is opened lazily on
 * first use and cached. The six `SaveStore` methods plus a few test-support hooks
 * (`snapshotTurns`, `events`, `__failNextWriteWith`) the locked suite needs.
 *
 * It ALSO provides the `GameSource` read shape (D-LOCK-04) — but via the `source()`
 * adapter, NOT a direct `implements GameSource`: the class keeps a folded
 * `load(): GameState` for the locked SAVE suite, whereas `GameSource.load` returns an
 * UNFOLDED `PersistedGame`. The two `load` return types cannot coexist on one method, so
 * `loadEnvelope()` is the envelope read and `source()` binds it as the GameSource `load`
 * alongside the `catalog()` projection.
 */
export class IdbSaveStore implements SaveStore {
	private readonly dbName: string;
	private dbPromise: Promise<IDBPDatabase<FrostyDB>> | null = null;
	/** Campaigns that have already requested durability (persist() once — SAVE-05). */
	private readonly persistRequested = new Set<string>();
	/** One-shot fault injector for the D-06 quota test; cleared after it fires once. */
	private failNextWrite: unknown = null;
	/**
	 * The download sink — defaults to the real Blob/anchor/objectURL path. Injectable so
	 * the headless unit test (fake-indexeddb has no DOM anchor) asserts the produced
	 * envelope without a DOM. All Blob/anchor/URL APIs are browser APIs, fine in this
	 * NON-engine file (the engine never touches them — CORE-02).
	 */
	private download: (_json: string, _filename: string) => void = defaultDownload;

	constructor(dbName: string) {
		this.dbName = dbName;
	}

	/** Open (once) and cache the DB, creating the normalized schema on first open. */
	private db(): Promise<IDBPDatabase<FrostyDB>> {
		if (!this.dbPromise) {
			this.dbPromise = openDB<FrostyDB>(this.dbName, 1, {
				upgrade(db) {
					const campaigns = db.createObjectStore('campaigns', { keyPath: 'id' });
					campaigns.createIndex('by_updatedAt', 'updatedAt');
					db.createObjectStore('snapshots', { keyPath: ['campaignId', 'turn'] });
					const events = db.createObjectStore('events', {
						keyPath: 'seq',
						autoIncrement: true
					});
					events.createIndex('by_campaign_seq', ['campaignId', 'seq']);
				},
				// Close this cached connection when another connection (a deleteDatabase or a
				// version upgrade) needs exclusive access — otherwise the cached handle blocks it
				// indefinitely. Close the live connection and drop the cache so the next db()
				// reopens fresh. Harmless in production (a single tab never deletes its own DB);
				// essential for tests that clear the DB between cases (else deleteDatabase blocks).
				blocking: () => {
					const pending = this.dbPromise;
					this.dbPromise = null;
					void pending?.then((db) => db.close()).catch(() => {});
				}
			});
		}
		return this.dbPromise;
	}

	// ── SaveStore surface (Task 2 implements save/load/list; Plan 03 export/import) ──

	async save(
		campaignId: string,
		turn: number,
		newEvents: GameEvent[],
		state: GameState
	): Promise<SaveResult> {
		// ALL non-idb work happens BEFORE opening the transaction (Pitfall 2 — an
		// IndexedDB transaction auto-commits once the microtask queue drains, so a
		// non-idb await between `db.transaction(...)` and `tx.done` closes it early).
		const db = await this.db();
		const now = Date.now();

		// Read the existing campaign row (to preserve createdAt / first-seen) BEFORE the
		// write transaction — a separate read tx, fully settled here.
		const existing = await db.get('campaigns', campaignId);

		// Snapshot on the cadence (turn % N === 0) OR on the FIRST save of a campaign:
		// the first save establishes the base the fold replays from (without it there is
		// no state to load — load = fold(latestSnapshot.state, events-since)). The passed
		// `state` is the folded state-AFTER this turn's events, so `lastSeq` (the last
		// event appended below) marks the boundary "events since" picks up from.
		const isFirstSave = existing === undefined;
		const isCadence = turn % SNAPSHOT_CADENCE_N === 0;
		const writeSnapshot = isCadence || isFirstSave;

		// Durability is a one-time, best-effort request per campaign (SAVE-05). It is a
		// non-idb promise, so it MUST resolve before the write transaction opens.
		if (!this.persistRequested.has(campaignId)) {
			this.persistRequested.add(campaignId);
			await requestDurability(); // a false / throw is a non-fatal hint — never blocks
		}

		// One-shot fault injection (D-06 quota test): pull and clear the pending error
		// here so the throw lands inside the write transaction below.
		const injected = this.failNextWrite;
		this.failNextWrite = null;

		try {
			const stores = writeSnapshot
				? (['events', 'snapshots', 'campaigns'] as const)
				: (['events', 'campaigns'] as const);
			const tx = db.transaction(stores, 'readwrite');

			// If a fault was injected, throw it INSIDE the transaction so the catch maps
			// it to a non-blocking signal and the partial tx aborts (prior state intact).
			if (injected) throw injected;

			// Append each event in order; capture the last assigned seq for the snapshot's
			// `lastSeq` (the "events since" cursor key). `add` resolves to the autoIncrement
			// key — these are idb awaits, safe inside the transaction.
			const events = tx.objectStore('events');
			let lastSeq = -Infinity;
			for (const e of newEvents) {
				lastSeq = (await events.add({ campaignId, ...e } as EventRow & {
					seq?: number;
				})) as number;
			}

			const writes: Promise<unknown>[] = [];
			if (writeSnapshot) {
				writes.push(
					tx.objectStore('snapshots').put({ campaignId, turn, state, lastSeq, isCadence })
				);
			}
			const row: CampaignRow = {
				id: campaignId,
				name: existing?.name ?? campaignId,
				schemaVersion: existing?.schemaVersion ?? CURRENT_SCHEMA_VERSION,
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
				currentTurn: turn
			};
			writes.push(tx.objectStore('campaigns').put(row));

			await Promise.all([...writes, tx.done]); // tx.done = the atomic commit
			return { ok: true };
		} catch (err) {
			// D-06: a write failure is a RETURNED signal, never a throw-and-lose. The
			// fold already happened; the caller keeps the resolved turn in memory.
			if (err instanceof DOMException && err.name === 'QuotaExceededError') {
				return { ok: false, reason: 'quota' };
			}
			return { ok: false, reason: 'io', detail: String(err) };
		}
	}

	/**
	 * The INVERTED read (LOAD-02 / D-LOCK-04): return an UNFOLDED `PersistedGame`
	 * envelope (the latest snapshot + the events-since + the stored `schemaVersion`)
	 * instead of a folded `GameState`. Migrate + fold move UP into `loadGameState`
	 * (engine/load.ts, Plan 08-01) — the store now only reads rows and assembles the
	 * envelope.
	 *
	 * CRITICAL (RESEARCH Pitfall 1 — the migration-on-resume disk fix): the returned
	 * envelope carries `campaignRow.schemaVersion`. The OLD `load()` folded to a
	 * `GameState`, which has no `schemaVersion` — so `loadGameState`'s migrate gate had
	 * nothing to gate on and migration silently never fired on local resume. Carrying the
	 * stored version is the entire LOAD-02 mechanism.
	 *
	 * The envelope carries only the latest SNAPSHOT + the events-since (not the full
	 * stream); `loadGameState` folds `fold(snap.state, events-since)`, which reproduces
	 * exactly the state the old in-store fold returned (the equivalence test proves it).
	 * Returns null on the same conditions the old `load()` returned null (no campaign /
	 * no snapshot). The `_id?`-default resolves the most-recent campaign (D-01 auto-resume).
	 */
	async loadEnvelope(campaignId?: string): Promise<PersistedGame | null> {
		const db = await this.db();

		// Resolve the target campaign: the given id, else the most-recent by max
		// updatedAt (D-01 auto-resume) via a 'prev' cursor over the by_updatedAt index
		// (Pitfall 4 — never getAll().sort()).
		let id = campaignId;
		if (id === undefined) {
			const cursor = await db
				.transaction('campaigns')
				.store.index('by_updatedAt')
				.openCursor(null, 'prev');
			if (!cursor) return null;
			id = cursor.value.id;
		}

		// Latest snapshot for the campaign: first row of a 'prev' cursor over the
		// [campaignId, turn] key range (highest turn first — base or cadence, whichever
		// is newest). The first save always writes a base snapshot, so a campaign with
		// no snapshot is genuinely unknown/empty → null.
		const snapCursor = await db
			.transaction('snapshots')
			.store.openCursor(IDBKeyRange.bound([id, -Infinity], [id, Infinity]), 'prev');
		if (!snapCursor) return null;
		const snap: SnapshotRow = snapCursor.value;

		// The campaign row (already keyed by id) — carries the stored schemaVersion the
		// envelope must preserve (Pitfall 1) and the campaign name. Absent row → null.
		const campaignRow = await db.get('campaigns', id);
		if (!campaignRow) return null;

		// Events strictly after the snapshot (seq > snap.lastSeq), in seq order, for THIS
		// campaign. The compound-range getAllFromIndex returns exactly the post-snapshot
		// events (RESEARCH Open Question 1 — the ordering test proves this syntax). The
		// store assembles the envelope; loadGameState composes the audited `fold`.
		const rows = await db.getAllFromIndex(
			'events',
			'by_campaign_seq',
			IDBKeyRange.bound([id, snap.lastSeq + 1], [id, Infinity])
		);

		return {
			schemaVersion: campaignRow.schemaVersion, // Pitfall 1: carry the stored version.
			campaignName: campaignRow.name,
			snapshots: [{ turn: snap.turn, state: snap.state }],
			events: rows.map(stripRow)
		};
	}

	/**
	 * The THIN folded-state wrapper kept for the locked SAVE suite + every existing
	 * caller (`undoLastTurn`, `exportToString`). It composes `loadEnvelope` and folds
	 * the audited `fold` over the carried snapshot + events — preserving the old
	 * `load(): Promise<GameState | null>` contract verbatim. New boot paths (Plan 08-03)
	 * call `loadEnvelope` + `loadGameState` instead of this wrapper.
	 */
	async load(campaignId?: string): Promise<GameState | null> {
		const env = await this.loadEnvelope(campaignId);
		if (!env) return null;
		// The envelope carries the latest (highest-turn) snapshot as snapshots[0]; fold the
		// events-since over it. `fold` is the audited replay — never reimplemented here.
		const snap = env.snapshots.reduce((latest, s) => (s.turn >= latest.turn ? s : latest));
		return fold(snap.state, env.events);
	}

	async list(): Promise<CampaignRow[]> {
		const db = await this.db();
		return db.getAll('campaigns');
	}

	/**
	 * The `GameSource` read-shape adapter (D-LOCK-04). The class itself keeps a folded
	 * `load(): GameState` for the locked SAVE suite, so the envelope-returning `GameSource`
	 * (whose `load` returns a `PersistedGame`) is exposed through this small adapter — it
	 * binds `loadEnvelope` as the GameSource `load` and projects `list()`'s `CampaignRow[]`
	 * to the minimal `CatalogEntry[]` the picker (Phase 9/10) consumes. ZERO call-site
	 * change for any source: idb here, a scenario store in Phase 9, the same contract.
	 */
	source(): GameSource {
		return {
			list: () => this.catalog(),
			load: (id?: string) => this.loadEnvelope(id)
		};
	}

	/**
	 * The `CatalogEntry` projection of `list()` (D-LOCK-02 — the picker rows). Maps each
	 * `CampaignRow` to the minimal `{ id, name, currentTurn }` a chooser needs; the full
	 * snapshots / event stream stay in the store until `loadEnvelope`d.
	 */
	async catalog(): Promise<CatalogEntry[]> {
		const rows = await this.list();
		return rows.map((r) => ({ id: r.id, name: r.name, currentTurn: r.currentTurn }));
	}

	/**
	 * Serialize a campaign to a `schemaVersion`-stamped `SaveEnvelope` JSON string —
	 * the DOM-FREE seam (SAVE-04). Forces a FRESH snapshot of current folded state
	 * (D-03 "always snapshot on export"; RESEARCH A6) so import reconstructs the
	 * campaign with a single fold over a current snapshot. Reads all events in seq
	 * (append) order, strips them back to bare `GameEvent`, and stamps
	 * `CURRENT_SCHEMA_VERSION`. The produced string is import-legal — it passes
	 * `validateSaveEnvelope` (export output IS the canonical shape).
	 */
	async exportToString(campaignId: string): Promise<string> {
		const db = await this.db();

		const campaign = await db.get('campaigns', campaignId);
		if (!campaign) {
			throw new Error(`IdbSaveStore.exportToString: unknown campaign "${campaignId}"`);
		}

		// Reconstruct the current folded state and snapshot it fresh (D-03; A6) so the
		// envelope always carries a current snapshot — import then folds the carried
		// events over it. `load` composes the audited `fold`; it never reimplements replay.
		const state = await this.load(campaignId);
		if (state === null) {
			throw new Error(`IdbSaveStore.exportToString: campaign "${campaignId}" has no state`);
		}
		const freshSnapshot: Snapshot = { turn: campaign.currentTurn, state };

		// All events for the campaign in seq order (the by_campaign_seq range), stripped
		// of the row-only fields back to bare GameEvent — the source of truth import replays.
		const events = await this.events(campaignId);

		const envelope: SaveEnvelope = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			campaignName: campaign.name,
			snapshots: [freshSnapshot],
			events
		};
		return JSON.stringify(envelope, null, 2);
	}

	/**
	 * Export a campaign as a downloadable `.frosty.json` (SAVE-04, the user-controlled
	 * backup / D-06 escape hatch). Builds the envelope via the DOM-free `exportToString`
	 * seam, wraps it in a `Blob`, and triggers a browser download through the injectable
	 * `download` sink (default = the real anchor-click path) — the sink lets the headless
	 * unit test assert the envelope without a DOM. The blob URL is revoked immediately to
	 * avoid a leak.
	 */
	async export(campaignId: string): Promise<void> {
		const db = await this.db();
		const campaign = await db.get('campaigns', campaignId);
		const json = await this.exportToString(campaignId);
		const filename = `${campaign?.name ?? campaignId}-t${campaign?.currentTurn ?? 0}.frosty.json`;
		this.download(json, filename);
	}

	/**
	 * Import an uploaded `.frosty.json` (SAVE-04, the SECOND untrusted boundary in v1).
	 * Reads the file text, `JSON.parse` in try/catch (bad JSON → recoverable `{ok:false}`),
	 * then runs `validateSaveEnvelope` (the strict-object allow-list) BEFORE any use —
	 * `parsed.schemaVersion` is NEVER read before this gate (Pitfall 5) and there is no
	 * `as SaveEnvelope` cast on untrusted input. On a valid envelope it applies the D-05
	 * schemaVersion gate (`> CURRENT` → recoverable reject; `<` → `migrateForward` stub;
	 * `===` → accept) and materializes a NEW campaign id (D-04 — NEVER overwrites a local
	 * campaign), suffixing a name collision. Returns `{ok:true, value: newCampaignId}`.
	 */
	async import(file: File): Promise<Result<string>> {
		const text = await file.text();

		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return { ok: false, error: 'That file was not valid JSON.' };
		}

		// SHAPE GATE FIRST (Pitfall 5): never touch parsed.schemaVersion before the
		// valibot pass. An extra key, a missing/forged schemaVersion, or a garbage value
		// all surface here as a recoverable {ok:false} — no cast, no pre-gate read.
		const validated = validateSaveEnvelope(parsed);
		if (!validated.ok) return validated;

		// D-05 schemaVersion gate: a save from a NEWER build cannot be understood here.
		// Recoverable {ok:false}, never a throw.
		if (validated.value.schemaVersion > CURRENT_SCHEMA_VERSION) {
			return { ok: false, error: 'This save is from a newer version of Frosty.' };
		}

		// === accept directly; < route through the migrate-forward seam (identity today).
		const env =
			validated.value.schemaVersion < CURRENT_SCHEMA_VERSION
				? migrateForward(validated.value)
				: validated.value;

		const newId = await this.materializeNewCampaign(env);
		return { ok: true, value: newId };
	}

	/**
	 * Undo the last resolved turn (UI-07 / D-03, RESEARCH Pattern 5). Drops EXACTLY the
	 * tail turn — every event row whose stripped `turn === currentTurn` within THIS
	 * campaign's `by_campaign_seq` range — plus any cadence SNAPSHOT row taken AT that
	 * turn (the Pitfall-1 trap: leave it and `load()` would fold the dropped turn back
	 * in). It is a TAIL-delete on the append-only log, NEVER a middle splice: only rows
	 * keyed `=== currentTurn` are removed, so a prior turn's events are untouched.
	 *
	 * Pitfall 2 (tx auto-commit): ALL non-idb work (`now`) is computed BEFORE the tx; the
	 * fold-forward `this.load(campaignId)` is awaited only AFTER `tx.done` — never inside
	 * the deletion tx (an inter-await would auto-commit it early). Undo REUSES the audited
	 * `load()` fold-forward (no new replay engine): after the tail is gone, `load()`
	 * reconstructs the historical pre-`currentTurn` state from the latest surviving
	 * snapshot + the surviving events. Returns that historical state (or null if the
	 * campaign / its base no longer resolves).
	 */
	async undoLastTurn(campaignId: string, currentTurn: number): Promise<GameState | null> {
		const db = await this.db();
		// Pitfall 2: compute every non-idb value BEFORE opening the write transaction.
		const now = Date.now();

		const tx = db.transaction(['events', 'snapshots', 'campaigns'], 'readwrite');

		// (1) TAIL-delete: walk the campaign's by_campaign_seq range and delete each row
		// whose stripped event.turn === currentTurn. Keyed strictly on the dropped turn
		// within ONE campaign's seq range — never a middle splice of the append-only log.
		const eventsIndex = tx.objectStore('events').index('by_campaign_seq');
		let cur = await eventsIndex.openCursor(
			IDBKeyRange.bound([campaignId, -Infinity], [campaignId, Infinity])
		);
		while (cur) {
			if (stripRow(cur.value).turn === currentTurn) {
				await cur.delete();
			}
			cur = await cur.continue();
		}

		// (2) Delete any SNAPSHOT row AT the dropped turn (the cadence case). A no-op when
		// absent (the non-cadence case); essential at a cadence boundary or load() would
		// fold the dropped turn straight back in (Pitfall 1).
		await tx.objectStore('snapshots').delete([campaignId, currentTurn]);

		// (3) Decrement the campaign's currentTurn (the picker / availability gate reads it).
		const campaign = await tx.objectStore('campaigns').get(campaignId);
		if (campaign) {
			campaign.currentTurn = currentTurn - 1;
			campaign.updatedAt = now;
			await tx.objectStore('campaigns').put(campaign);
		}

		await tx.done; // atomic commit of the tail-delete BEFORE the fold-forward read.

		// (4) Reuse the UNCHANGED load() fold-forward — it reconstructs the historical
		// pre-currentTurn state from the surviving snapshot + events. NO reimplemented replay.
		return this.load(campaignId);
	}

	/**
	 * Write an imported `SaveEnvelope` as a NEW campaign (D-04 create-new, never
	 * overwrite). Generates a fresh `crypto.randomUUID` id and a non-colliding name
	 * (a duplicate `campaignName` is suffixed), then writes the envelope's snapshots and
	 * events under the new id (events re-appended in order so the new autoIncrement seq
	 * becomes the campaign-local ordering; each snapshot's `lastSeq` is recomputed against
	 * the NEW seq range). NEVER mutates an existing campaign's rows. Returns the new id.
	 */
	private async materializeNewCampaign(env: SaveEnvelope): Promise<string> {
		const db = await this.db();
		const now = Date.now();
		const newId =
			typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `import-${now}-${Math.random().toString(36).slice(2)}`;

		// Non-colliding name: suffix if the campaignName already exists in campaigns.
		const existing = await db.getAll('campaigns');
		const usedNames = new Set(existing.map((c) => c.name));
		let name = env.campaignName;
		if (usedNames.has(name)) {
			let n = 2;
			let candidate = `${env.campaignName} (imported)`;
			while (usedNames.has(candidate)) {
				candidate = `${env.campaignName} (imported ${n++})`;
			}
			name = candidate;
		}

		const latestSnapshotTurn = env.snapshots.reduce((max, s) => Math.max(max, s.turn), 0);
		const currentTurn = env.events.reduce((max, e) => Math.max(max, e.turn), latestSnapshotTurn);

		const tx = db.transaction(['events', 'snapshots', 'campaigns'], 'readwrite');
		const eventsStore = tx.objectStore('events');

		// Re-append events in order under the new id; capture each assigned seq so the
		// snapshot lastSeq is recomputed against the NEW campaign-local seq range.
		const newSeqs: number[] = [];
		for (const e of env.events) {
			const seq = (await eventsStore.add({ campaignId: newId, ...e } as EventRow & {
				seq?: number;
			})) as number;
			newSeqs.push(seq);
		}
		const lastSeq = newSeqs.length > 0 ? newSeqs[newSeqs.length - 1] : -Infinity;

		const snapshotsStore = tx.objectStore('snapshots');
		const writes: Promise<unknown>[] = [];
		for (const snap of env.snapshots) {
			// The newest snapshot covers the full re-appended stream (export carries a
			// single current snapshot taken after all events). isCadence mirrors the
			// turn % N rule so snapshotTurns reports cadence-only consistently.
			writes.push(
				snapshotsStore.put({
					campaignId: newId,
					turn: snap.turn,
					state: snap.state,
					lastSeq,
					isCadence: snap.turn % SNAPSHOT_CADENCE_N === 0
				})
			);
		}

		const row: CampaignRow = {
			id: newId,
			name,
			schemaVersion: CURRENT_SCHEMA_VERSION,
			createdAt: now,
			updatedAt: now,
			currentTurn
		};
		writes.push(tx.objectStore('campaigns').put(row));

		await Promise.all([...writes, tx.done]);
		return newId;
	}

	// ── Phase-10 lifecycle verbs (CAMP-03/04/06) ───────────────────────────────────

	/**
	 * IRREVERSIBLE cascade delete (CAMP-04 / D-03). Removes the campaign row AND every
	 * snapshot AND every event for the id in ONE atomic `['events','snapshots','campaigns']`
	 * transaction so the delete either fully cascades or fully aborts — NEVER orphans rows
	 * (T-10-01). Mirrors `undoLastTurn`'s multi-store single-tx shape, but with NO turn
	 * filter: it cursor-walks the campaign's FULL `by_campaign_seq` event range and the FULL
	 * snapshots bound range, deleting EVERY row, then deletes the campaigns key.
	 *
	 * Pitfall 2 (tx auto-commit): no non-idb await between `db.transaction()` and `tx.done`.
	 * A blocked/I-O reject is a recoverable `{ok:false, reason:'io'}` — never a throw
	 * (Result idiom). Deleting an unknown id is a harmless no-op `{ok:true}` (the ranges are
	 * empty; `campaigns.delete` of an absent key is a no-op).
	 */
	async deleteCampaign(campaignId: string): Promise<Result<void>> {
		try {
			const db = await this.db();
			const tx = db.transaction(['events', 'snapshots', 'campaigns'], 'readwrite');

			// (1) Cursor-walk the campaign's by_campaign_seq event range and delete EVERY row
			// (no turn filter — unlike undoLastTurn's tail-only delete).
			const eventsIndex = tx.objectStore('events').index('by_campaign_seq');
			let evCur = await eventsIndex.openCursor(
				IDBKeyRange.bound([campaignId, -Infinity], [campaignId, Infinity])
			);
			while (evCur) {
				await evCur.delete();
				evCur = await evCur.continue();
			}

			// (2) Cursor-walk the snapshots bound range (the same range snapshotTurns uses)
			// and delete ALL snapshot rows for the campaign (base + every cadence snapshot).
			let snapCur = await tx
				.objectStore('snapshots')
				.openCursor(IDBKeyRange.bound([campaignId, -Infinity], [campaignId, Infinity]));
			while (snapCur) {
				await snapCur.delete();
				snapCur = await snapCur.continue();
			}

			// (3) Delete the campaign row itself (a no-op if the id is unknown).
			await tx.objectStore('campaigns').delete(campaignId);

			await tx.done; // atomic commit — the cascade is all-or-nothing.
			return { ok: true, value: undefined };
		} catch (err) {
			// A durable-boundary fault (blocked store, I/O) is a RETURNED signal, never a
			// throw-and-lose — the caller surfaces a recoverable warning and keeps playing.
			return { ok: false, error: String(err) };
		}
	}

	/**
	 * Display-name-only rename (CAMP-03 / D-07 / Phase-8 D-04 LOCK). Writes ONLY
	 * `campaigns.name` + bumps `updatedAt` (so the row floats to the top of `by_updatedAt` —
	 * D-06); it NEVER touches `id` and NEVER touches the frozen `meta.campaignName` seed label
	 * (that lives inside the snapshot state and is the Phase-8 decoupling LOCK). An
	 * empty/whitespace-only name is rejected BEFORE the write as a recoverable `{ok:false}`.
	 * Single-store `['campaigns']` read-mutate-put (the undoLastTurn step-3 shape).
	 */
	async rename(campaignId: string, name: string): Promise<Result<void>> {
		// Reject an empty / whitespace-only name before any write — a recoverable reject,
		// never a throw. The UI also guards this; the store is the authoritative gate.
		if (name.trim() === '') {
			return { ok: false, error: 'A campaign name cannot be empty.' };
		}
		try {
			const db = await this.db();
			const now = Date.now();
			const tx = db.transaction(['campaigns'], 'readwrite');
			const campaign = await tx.objectStore('campaigns').get(campaignId);
			if (!campaign) {
				await tx.done;
				return { ok: false, error: `Unknown campaign "${campaignId}".` };
			}
			// ONLY name + updatedAt — id and the snapshot's meta.campaignName are untouched.
			campaign.name = name;
			campaign.updatedAt = now;
			await tx.objectStore('campaigns').put(campaign);
			await tx.done;
			return { ok: true, value: undefined };
		} catch (err) {
			return { ok: false, error: String(err) };
		}
	}

	/**
	 * Full-history clone (CAMP-06 / D-04 / D-08). Copies the campaign row + every snapshot +
	 * every event VERBATIM under a FRESH `randomId()` id (the insecure-context-safe generator
	 * — CONTEXT lock, not an inline `crypto.randomUUID`) with a non-colliding `<name> (copy)`
	 * name (suffixed `(copy 2)`… if taken). The clone of `materializeNewCampaign`, reading the
	 * source from DISK instead of an envelope.
	 *
	 * Pitfall 2: ALL source reads (row, events, snapshots) settle BEFORE the write tx opens;
	 * the events are then re-appended under the new id (capturing each new seq), `lastSeq` is
	 * recomputed against the NEW seq range, and each snapshot is re-put under the new id with
	 * the recomputed lastSeq + preserved isCadence. The copy is fully INDEPENDENT thereafter
	 * (a delete/rename of the copy never touches the source — D-04). Returns the new id.
	 */
	async duplicate(campaignId: string): Promise<Result<string>> {
		try {
			const db = await this.db();
			const now = Date.now();

			// Read EVERYTHING off the source BEFORE the write tx (Pitfall 2): the row, the
			// snapshots, the events, and the existing names for the collision suffix.
			const source = await db.get('campaigns', campaignId);
			if (!source) {
				return { ok: false, error: `Unknown campaign "${campaignId}".` };
			}
			const sourceSnapshots = await db.getAll(
				'snapshots',
				IDBKeyRange.bound([campaignId, -Infinity], [campaignId, Infinity])
			);
			const sourceEvents = await db.getAllFromIndex(
				'events',
				'by_campaign_seq',
				IDBKeyRange.bound([campaignId, -Infinity], [campaignId, Infinity])
			);
			const existing = await db.getAll('campaigns');

			// Fresh insecure-context-safe id (CONTEXT lock — randomId from ./seed).
			const newId = randomId();

			// Non-colliding name: `<name> (copy)`, suffixed `(copy 2)`… if taken (D-08).
			const usedNames = new Set(existing.map((c) => c.name));
			let name = `${source.name} (copy)`;
			if (usedNames.has(name)) {
				let n = 2;
				let candidate = `${source.name} (copy ${n})`;
				while (usedNames.has(candidate)) {
					candidate = `${source.name} (copy ${++n})`;
				}
				name = candidate;
			}

			const tx = db.transaction(['events', 'snapshots', 'campaigns'], 'readwrite');
			const eventsStore = tx.objectStore('events');

			// Re-append each source event verbatim under the new id, capturing each new seq so
			// the snapshot lastSeq is recomputed against the NEW campaign-local seq range.
			const newSeqs: number[] = [];
			for (const row of sourceEvents) {
				const event = stripRow(row);
				const seq = (await eventsStore.add({ campaignId: newId, ...event } as EventRow & {
					seq?: number;
				})) as number;
				newSeqs.push(seq);
			}
			const lastSeq = newSeqs.length > 0 ? newSeqs[newSeqs.length - 1] : -Infinity;

			const snapshotsStore = tx.objectStore('snapshots');
			const writes: Promise<unknown>[] = [];
			for (const snap of sourceSnapshots) {
				// Re-put each snapshot under the new id with the recomputed lastSeq (the new
				// stream covers exactly the re-appended events) + the preserved isCadence flag.
				writes.push(
					snapshotsStore.put({
						campaignId: newId,
						turn: snap.turn,
						state: snap.state,
						lastSeq,
						isCadence: snap.isCadence
					})
				);
			}

			const row: CampaignRow = {
				id: newId,
				name,
				schemaVersion: source.schemaVersion,
				createdAt: now,
				updatedAt: now,
				currentTurn: source.currentTurn
			};
			writes.push(tx.objectStore('campaigns').put(row));

			await Promise.all([...writes, tx.done]);
			return { ok: true, value: newId };
		} catch (err) {
			return { ok: false, error: String(err) };
		}
	}

	// ── Test-support hooks (the locked suite depends on these; impl detail) ─────────

	/**
	 * The turns that have a CADENCE snapshot row, for the cadence assertion. Excludes
	 * the first-save base snapshot (isCadence === false) so "a snapshot exists at turn N,
	 * not before" holds even though the campaign's base was snapshotted at its first turn.
	 */
	async snapshotTurns(campaignId: string): Promise<number[]> {
		const db = await this.db();
		const rows = await db.getAll(
			'snapshots',
			IDBKeyRange.bound([campaignId, -Infinity], [campaignId, Infinity])
		);
		return rows.filter((r) => r.isCadence).map((r) => r.turn);
	}

	/** The appended events in seq (append) order, stripped back to GameEvent shape. */
	async events(campaignId: string): Promise<GameEvent[]> {
		const db = await this.db();
		const rows = await db.getAllFromIndex(
			'events',
			'by_campaign_seq',
			IDBKeyRange.bound([campaignId, -Infinity], [campaignId, Infinity])
		);
		return rows.map(stripRow);
	}

	/** One-shot fault injector: the NEXT save() write throws `err`, then resets. */
	__failNextWriteWith(err: unknown): void {
		this.failNextWrite = err;
	}
}

/**
 * The default download sink: Blob → objectURL → anchor `.click()` → revoke (RESEARCH
 * Pattern 4). Revoked immediately to free the blob (no leak). Browser-only — guarded so
 * a non-DOM environment (the headless test path injects a stub instead) degrades to a
 * no-op rather than throwing.
 */
function defaultDownload(json: string, filename: string): void {
	const hasDom =
		typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof Blob !== 'undefined';
	if (!hasDom) return; // non-DOM environment (the headless test injects a stub instead)
	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	try {
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** Strip the row-only fields (`campaignId`, `seq`) back to a bare `GameEvent`. */
function stripRow(row: EventRow): GameEvent {
	const { campaignId: _c, seq: _s, ...event } = row;
	void _c;
	void _s;
	return event as GameEvent;
}

/**
 * Request persistent storage once at campaign start (SAVE-05). Feature-guarded and
 * try/catch'd: `navigator.storage.persist()` returns `Promise<boolean>` where `false`
 * means "evictable under pressure" — a NORMAL browser-policy outcome, NOT an error
 * (Pitfall 3) — and can throw `TypeError` on opaque origins / disabled storage. The
 * boolean is a durability HINT; persistence is a mitigation, never a guarantee, so a
 * false/throw must never block play. The export escape hatch (plan 03) pairs with it.
 */
async function requestDurability(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !('storage' in navigator)) return false;
	const storage = navigator.storage as StorageManager | undefined;
	if (!storage || typeof storage.persist !== 'function') return false;
	try {
		return await storage.persist();
	} catch {
		return false;
	}
}
