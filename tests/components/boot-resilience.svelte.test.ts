// boot-resilience.svelte.test.ts — T-r7j-01: boot() survives a blocked/unavailable
// IndexedDB at the REAL bridge level.
//
// Mobile browsers (Firefox private / strict tracking protection / tunneled origins)
// can make `IdbSaveStore.load()` REJECT (openDB throws) instead of resolving null.
// Before the fix, boot() had no try/catch, so the rejection aborted boot BEFORE
// `this.state` was assigned — `game.state` stayed null and StatePanel rendered its
// 2-box skeleton forever (the game was unusable, a denial-of-service).
//
// This test swaps the singleton's private store for a stub whose load() rejects (via
// the minimal `__setSaveStoreForTest` test seam), boots, and asserts the boot-catch
// fallback: a seeded in-memory campaign + `saveUnavailable === true`, machine idle,
// and a derivable `remaining`. A second case proves the REAL store (no stub) keeps
// the happy path (`saveUnavailable === false`).

import { describe, test, expect, beforeEach, afterEach } from 'vitest';

import { game } from '../../src/lib/game.svelte';
import { IdbSaveStore } from '../../src/lib/idb-save-store';
import type { SaveStore } from '../../src/lib/engine/save-store';

function clearDb(): Promise<void> {
	return new Promise<void>((res) => {
		const r = indexedDB.deleteDatabase('frosty');
		r.onsuccess = r.onerror = r.onblocked = () => res(undefined);
	});
}

/** A SaveStore stub whose loadEnvelope() (the boot read path, Phase 8) rejects — a blocked
 *  IndexedDB at the openDB boundary. list() also rejects so the resume-id resolution that boot
 *  runs FIRST routes to the same fallback. Every other method is a benign no-op returning the
 *  minimal valid shape so nothing else can throw. */
function blockedStore(): SaveStore {
	return {
		list: () => Promise.reject(new Error('IndexedDB blocked')),
		loadEnvelope: () => Promise.reject(new Error('IndexedDB blocked')),
		load: () => Promise.reject(new Error('IndexedDB blocked')),
		save: async () => ({ ok: true }),
		export: async () => undefined,
		import: async () => ({ ok: true, value: 'stub' }),
		undoLastTurn: async () => null,
		deleteCampaign: () => Promise.reject(new Error('IndexedDB blocked')),
		rename: () => Promise.reject(new Error('IndexedDB blocked')),
		duplicate: () => Promise.reject(new Error('IndexedDB blocked'))
	};
}

/** A SaveStore stub whose resume read NEVER settles — the PROVEN S23 Ultra Firefox Nightly hang
 *  (a forever-pending promise that neither resolves NOR rejects). boot() resolves the resume id
 *  via list() FIRST, then loadEnvelope(id), so list() is the arm that must hang to reproduce the
 *  device bug (the boot read promise is the whole #resolveResume chain). Mirrors blockedStore()
 *  in every other (benign no-op) method. The boot() timeout race is the only thing that can
 *  rescue this — the try/catch never fires because the promise never throws (T-s02-01). */
function hangingStore(): SaveStore {
	return {
		list: () => new Promise<never>(() => {}),
		loadEnvelope: () => new Promise<never>(() => {}),
		load: () => new Promise<import('../../src/lib/engine/state').GameState | null>(() => {}),
		save: async () => ({ ok: true }),
		export: async () => undefined,
		import: async () => ({ ok: true, value: 'stub' }),
		undoLastTurn: async () => null,
		deleteCampaign: () => new Promise<never>(() => {}),
		rename: () => new Promise<never>(() => {}),
		duplicate: () => new Promise<never>(() => {})
	};
}

beforeEach(async () => {
	await clearDb();
	game.log = [];
	game.machine = 'idle';
	game.saveUnavailable = false;
});

afterEach(() => {
	// Restore a real store so the stub never leaks into other suites importing the singleton.
	game.__setSaveStoreForTest(new IdbSaveStore('frosty'));
	// Restore the production boot-load timeout so the shrunk value never leaks to sibling suites.
	game.__setBootLoadTimeoutForTest(3000);
	game.saveUnavailable = false;
});

describe('T-r7j-01 — boot() survives a rejecting (blocked) IndexedDB load', () => {
	test('load() rejects → state is seeded in-memory + saveUnavailable true + idle', async () => {
		game.__setSaveStoreForTest(blockedStore());

		await expect(game.boot()).resolves.toBeUndefined();

		// Fallback seeded a fresh starter — the forces render instead of an endless skeleton.
		expect(game.state).not.toBeNull();
		expect(game.saveUnavailable).toBe(true);
		expect(game.machine).toBe('idle');

		// remaining derives for the seeded sides (the ledger floor still folds).
		const blue = game.state!.sides.find((s) => s.commander === 'player');
		expect(blue).toBeDefined();
		expect(game.remaining[blue!.id]).toBeDefined();
	});

	test('load() HANGS (never settles) → state is seeded in-memory + saveUnavailable true + idle', async () => {
		game.__setSaveStoreForTest(hangingStore());
		// Shrink the timeout via the seam so the race resolves in ~1ms (no real 3s wait).
		game.__setBootLoadTimeoutForTest(1);

		await expect(game.boot()).resolves.toBeUndefined();

		// The hang fallback seeded a fresh §5.4 starter — turn is a real number (stateBefore).
		expect(game.state).not.toBeNull();
		expect(typeof game.state!.meta.turn).toBe('number');
		expect(game.saveUnavailable).toBe(true);
		expect(game.machine).toBe('idle');
	});

	test('happy path (real store, no stub) keeps saveUnavailable false', async () => {
		game.__setSaveStoreForTest(new IdbSaveStore('frosty'));

		await game.boot();

		expect(game.state).not.toBeNull();
		expect(game.saveUnavailable).toBe(false);
		expect(game.machine).toBe('idle');
	});
});
