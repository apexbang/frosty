// pwa-register-stub.ts — test-support (NOT production source).
//
// The `components` browser Vitest project loads ONLY the `svelte()` plugin, not SvelteKitPWA,
// so the `virtual:pwa-register/svelte` module the real +layout.svelte imports cannot be
// resolved at Vite transform time (it is synthesized by the PWA plugin, absent in the test
// build). This stub stands in for that virtual module via a `resolve.alias` in vitest.config
// so the REAL +layout.svelte renders UNMODIFIED (OFFL-03 is verify-only, D-09 — zero source
// change). It hands back SETTABLE Svelte stores + a SPY-able updateServiceWorker so a test can
// flip `needRefresh` to true (simulating a waiting service worker) and assert the resulting
// "New version ready" toast + Reload wiring.

import { writable, type Writable } from 'svelte/store';

// Module-singleton stores + spy: the same instances every useRegisterSW() call returns, so a
// test importing this module drives EXACTLY what the layout binds. `needRefresh`/`offlineReady`
// are settable writables; `updateServiceWorker` is a vi.fn-replaceable handle the test spies on.
export const needRefresh: Writable<boolean> = writable(false);
export const offlineReady: Writable<boolean> = writable(false);

// A reassignable call sink so a test can install a spy: `setUpdateServiceWorker(vi.fn())`.
let _updateServiceWorker: (_reloadPage?: boolean) => Promise<void> = () => Promise.resolve();
export function setUpdateServiceWorker(fn: (_reloadPage?: boolean) => Promise<void>): void {
	_updateServiceWorker = fn;
}
export function updateServiceWorker(reloadPage?: boolean): Promise<void> {
	return _updateServiceWorker(reloadPage);
}

// Reset all stub state between tests (called from a beforeEach) so a stale `needRefresh=true`
// from one test never bleeds into the next in the same browser worker.
export function resetPwaRegisterStub(): void {
	needRefresh.set(false);
	offlineReady.set(false);
	_updateServiceWorker = () => Promise.resolve();
}

// The virtual module's public surface: useRegisterSW() returns the shared instances.
export function useRegisterSW(): {
	needRefresh: Writable<boolean>;
	offlineReady: Writable<boolean>;
	updateServiceWorker: (_reloadPage?: boolean) => Promise<void>;
} {
	return { needRefresh, offlineReady, updateServiceWorker };
}
