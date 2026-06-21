// seed-insecure-context.svelte.test.ts — quick-260620-sgg: seedStarter() must NOT crash in an
// INSECURE context (plain http://), the real device bug.
//
// `crypto.randomUUID()` is ONLY defined in a SECURE context (https / localhost). On a phone
// hitting the app over a plain `http://` LAN/Tailscale origin it is `undefined`, so the old
// `campaignName: \`starter-${crypto.randomUUID()}\`` THREW — `load()` returned null, boot took
// the no-data seed branch, `seedStarter()` crashed, `state` stayed null, and the StatePanel
// skeleton rendered forever.
//
// This suite stubs `globalThis.crypto` so `randomUUID` is undefined but `getRandomValues` is
// still present (the real insecure-context shape), then asserts: (1) seedStarter() no longer
// throws and yields a non-empty `starter-` campaignName; (2) two calls produce DISTINCT names
// (uniqueness preserved through the getRandomValues fallback); (3) boot() over a no-data store
// under the same stub lands a non-null state at machine 'idle'. The real crypto is restored in
// afterEach so the stub never leaks to sibling suites importing the singleton.

import { describe, test, expect, beforeEach, afterEach } from 'vitest';

import { seedStarter } from '../../src/lib/seed';
import { game } from '../../src/lib/game.svelte';
import { IdbSaveStore } from '../../src/lib/idb-save-store';
import type { SaveStore } from '../../src/lib/engine/save-store';

function clearDb(): Promise<void> {
	return new Promise<void>((res) => {
		const r = indexedDB.deleteDatabase('frosty');
		r.onsuccess = r.onerror = r.onblocked = () => res(undefined);
	});
}

/** A SaveStore stub whose list() resolves [] (no campaign to resume) — drives boot's fresh-starter
 *  branch under the insecure-context crypto stub. loadEnvelope/load resolve null (never reached
 *  once list() is empty). Every other method is a benign no-op returning a valid shape. */
function noDataStore(): SaveStore {
	return {
		list: async () => [],
		loadEnvelope: async () => null,
		load: async () => null,
		save: async () => ({ ok: true }),
		export: async () => undefined,
		import: async () => ({ ok: true, value: 'stub' }),
		undoLastTurn: async () => null,
		deleteCampaign: async () => ({ ok: true, value: undefined }),
		rename: async () => ({ ok: true, value: undefined }),
		duplicate: async () => ({ ok: true, value: 'stub-copy' })
	};
}

// The real crypto, restored after each test so the randomUUID-undefined stub never leaks.
const realCrypto = globalThis.crypto;

beforeEach(async () => {
	await clearDb();
	game.log = [];
	game.machine = 'idle';
	game.saveUnavailable = false;

	// Insecure-context shape: randomUUID undefined, getRandomValues present (wrap the real one so
	// the fallback produces genuine entropy). Define as a configurable own property so afterEach
	// can restore the original (Node exposes crypto via a getter).
	const insecureCrypto = {
		...realCrypto,
		getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
		randomUUID: undefined
	} as unknown as Crypto;
	Object.defineProperty(globalThis, 'crypto', {
		value: insecureCrypto,
		configurable: true,
		writable: true
	});
});

afterEach(() => {
	// Restore the real crypto so randomUUID is defined again for sibling suites.
	Object.defineProperty(globalThis, 'crypto', {
		value: realCrypto,
		configurable: true,
		writable: true
	});
	// Restore a real store + the production boot-load timeout so nothing leaks into other suites.
	game.__setSaveStoreForTest(new IdbSaveStore('frosty'));
	game.__setBootLoadTimeoutForTest(3000);
	game.saveUnavailable = false;
});

describe('quick-260620-sgg — seedStarter() survives an insecure context (randomUUID undefined)', () => {
	test('seedStarter() does not throw and yields a non-empty starter- campaignName', () => {
		// Guard the stub is in effect: randomUUID gone, getRandomValues still available.
		expect(typeof crypto.randomUUID).toBe('undefined');
		expect(typeof crypto.getRandomValues).toBe('function');

		let state!: ReturnType<typeof seedStarter>;
		expect(() => {
			state = seedStarter();
		}).not.toThrow();

		expect(typeof state.meta.campaignName).toBe('string');
		expect(state.meta.campaignName.length).toBeGreaterThan('starter-'.length);
		expect(state.meta.campaignName.startsWith('starter-')).toBe(true);
	});

	test('two seedStarter() calls produce DISTINCT campaignNames (uniqueness via getRandomValues)', () => {
		const a = seedStarter().meta.campaignName;
		const b = seedStarter().meta.campaignName;
		expect(a).not.toBe(b);
	});

	test('boot() over a no-data store under the insecure stub → non-null state + idle', async () => {
		game.__setSaveStoreForTest(noDataStore());

		await expect(game.boot()).resolves.toBeUndefined();

		expect(game.state).not.toBeNull();
		expect(game.machine).toBe('idle');
		// PHASE 8: boot now mounts the clean turn-0 starterScenario() (campaignName 'Starter') and
		// mints the STABLE campaignId via the shared insecure-context-safe randomId() — the proof of
		// insecure-context safety is now that boot lands a non-empty id (randomId did not throw),
		// decoupled from meta.campaignName (LOAD-04 / D-05).
		expect(game.state!.meta.campaignName).toBe('Starter');
		expect(typeof game.campaignId).toBe('string');
		expect(game.campaignId.length).toBeGreaterThan(0);
	});
});
