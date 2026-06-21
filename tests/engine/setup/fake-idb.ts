// fake-idb.ts — the Vitest setup file (vite.config.ts test.setupFiles).
//
// Registers a pure-JS IndexedDB on globalThis (the `indexedDB` global +
// `IDBKeyRange`, `IDBDatabase`, etc.) so the Phase-4 persistence layer's store
// tests run HEADLESSLY — zero DOM, zero browser. `fake-indexeddb/auto` is the
// import-side-effect entry that wires the polyfill onto the global scope before
// any test imports the idb-backed SaveStore.
//
// It is a DEV-only test polyfill (devDependencies, never shipped). Loaded once
// per Vitest run via test.setupFiles; tests then `new IdbSaveStore(...)` against
// it exactly as they would a real browser IndexedDB.

import 'fake-indexeddb/auto';

// Make `globalThis.navigator` assignable. In the Node test environment `navigator`
// is exposed as a read-only getter (Node 21+), so the SAVE-05 persist test's
// `globalThis.navigator = { storage: { persist } }` throws "Cannot set property
// navigator ... which has only a getter". Redefining it as a writable/configurable
// data property lets the locked test inject its storage.persist stub. Test-only.
try {
	Object.defineProperty(globalThis, 'navigator', {
		value: (globalThis as { navigator?: unknown }).navigator,
		writable: true,
		configurable: true
	});
} catch {
	// If the platform forbids redefining it, the persist test will surface that.
}
