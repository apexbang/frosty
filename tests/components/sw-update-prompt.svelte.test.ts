// sw-update-prompt.svelte.test.ts — OFFL-03 verify (Phase 11 Plan 03 Task 1).
//
// VERIFY-ONLY (D-09): the `registerType: 'prompt'` update flow is ALREADY built in
// +layout.svelte — waiting worker → `needRefresh` store true → "New version ready" toast
// → Reload button → `updateServiceWorker(true)` → reload. This suite proves that existing
// flow renders + wires Reload; it changes ZERO source (the acceptance gate also asserts
// `git diff --quiet src/routes/+layout.svelte`). Never switch to 'autoUpdate' / never
// auto-reload mid-turn — that is the locked Phase-7 decision (CLAUDE.md / D-09).
//
// ── How to OBSERVE the real waiting-worker → toast cycle in a real browser (RESEARCH
//    §Validation Architecture, OFFL-03 row; manual, complements this automated check) ──
//   1. Build + preview the production PWA under the base path (the SW only ships in the
//      production build — devOptions.enabled = false):
//         BASE_PATH=/frosty npm run build && BASE_PATH=/frosty npm run preview
//      then open http://localhost:4173/frosty/ (localhost is a secure context, so the SW
//      installs and the install/update criteria apply).
//   2. Trigger the WAITING worker (either path):
//        • DevTools → Application → Service Workers → tick "Update on reload", then reload;
//          OR
//        • deploy/preview a v2 build (any byte change to the SW) so a new SW installs and
//          parks in the `waiting` state behind the active one.
//   3. `useRegisterSW()` flips `needRefresh` → true → the "New version ready — reload to
//      update." toast renders with the Reload control. Clicking Reload runs
//      updateServiceWorker(true) → the waiting SW activates (skipWaiting) and the page
//      reloads onto the new build — only on the user's tap, never mid-turn.
//
// ── How this test reaches that flow without a real SW ──
// The toast is driven by the `needRefresh` store from `virtual:pwa-register/svelte`. The
// `components` Vitest project loads only svelte() (NOT SvelteKitPWA), so that virtual module
// can't be resolved here — vitest.config aliases it (and `virtual:pwa-info`) to test-support
// stubs (tests/components/support/pwa-{register,info}-stub.ts). The REAL +layout.svelte renders
// UNMODIFIED against those stubs; we flip the stub's `needRefresh` to true (simulating a waiting
// worker) to render the toast, and install a spy on updateServiceWorker to assert the Reload
// wiring. Zero +layout.svelte source change.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'vitest-browser-svelte';

import Layout from '../../src/routes/+layout.svelte';
import {
	needRefresh,
	resetPwaRegisterStub,
	setUpdateServiceWorker
} from './support/pwa-register-stub';

// A no-op children snippet — +layout.svelte renders {@render children()} after the toasts.
const emptyChildren = createRawSnippet(() => ({ render: () => '<div></div>' }));

beforeEach(() => {
	resetPwaRegisterStub();
});

describe('OFFL-03 — SW update prompt renders + wires Reload (verify-only, D-09)', () => {
	test('no waiting worker → no "New version ready" toast', async () => {
		needRefresh.set(false);
		const screen = render(Layout, { children: emptyChildren });

		expect(screen.container.textContent).not.toContain('New version ready');
	});

	test('needRefresh=true renders the "New version ready" toast with a Reload control', async () => {
		needRefresh.set(true);
		const screen = render(Layout, { children: emptyChildren });

		// The locked update copy is present…
		await expect.element(screen.getByText(/New version ready/)).toBeVisible();
		// …and the primary action is a Reload button (the single accent CTA on the toast).
		await expect.element(screen.getByRole('button', { name: /Reload/ })).toBeVisible();
	});

	test('clicking Reload invokes updateServiceWorker(true) (activate waiting SW + reload)', async () => {
		const spy = vi.fn(() => Promise.resolve());
		setUpdateServiceWorker(spy);
		needRefresh.set(true);
		const screen = render(Layout, { children: emptyChildren });

		await screen.getByRole('button', { name: /Reload/ }).click();

		// reloadForUpdate() calls updateServiceWorker(true) — activate the waiting worker then
		// reload, only on the user's tap (never auto-reload mid-turn, D-09).
		expect(spy).toHaveBeenCalledWith(true);
	});
});
