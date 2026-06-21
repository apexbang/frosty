import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
// Vitest 4.1 extracted browser providers into companion packages; the playwright
// provider is now a FACTORY imported from @vitest/browser-playwright (the old
// `provider: 'playwright'` string is a hard error in 4.1.9).
import { playwright } from '@vitest/browser-playwright';

// Two NAMED Vitest projects (RESEARCH Pitfall 7 — keep the node engine project
// and the browser component project strictly separate so neither picks up the
// other's environment):
//
//   • engine     — pure framework-free TS. Node env. Runs the FROZEN engine suite
//                  (`tests/engine/**`) PLUS the pure-TS orchestrator unit test
//                  (`tests/turn/**`). Keeps the existing fake-indexeddb setupFile
//                  VERBATIM so the idb-backed Phase-4 persistence tests still find
//                  `indexedDB`/`IDBKeyRange` (without it they fail with
//                  `indexedDB is not defined`). The `components` browser project
//                  does NOT need this node polyfill — it runs in a real browser.
//
//   • components — Svelte 5 component tests in a REAL browser via @vitest/browser
//                  (chromium, headless) with vitest-browser-svelte's plugin for
//                  native runes support. Scoped to `tests/components/**` only.
//
// The project names are load-bearing: `npx vitest --project engine run` and
// `npx vitest --project components run` must each select exactly one project.
// `npm run test` (`vitest run`, NO --project) runs BOTH — only fully green once
// the later waves drive the new RED tests to green (VALIDATION wave-merge note).
//
// Quick run:  npx vitest --project engine run tests/engine/<file>.test.ts
export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: 'engine',
					environment: 'node',
					// `tests/scenarios/**` (Phase 9) joins the node engine project: the ScenarioStore
					// + bundled-scenarios suites are pure-TS (no browser/DOM) and exercise the engine
					// load path, so they belong with the engine suite, not the `components` browser one.
					include: [
						'tests/engine/**/*.test.ts',
						'tests/turn/**/*.test.ts',
						'tests/scenarios/**/*.test.ts'
					],
					// Headless IndexedDB for the Phase-4 persistence store tests — carried
					// VERBATIM from the pre-split config. The setup registers indexedDB +
					// IDBKeyRange on globalThis (fake-indexeddb/auto) BEFORE any test imports
					// the idb-backed store. The engine project is the only one that needs it.
					setupFiles: ['./tests/engine/setup/fake-idb.ts']
				}
			},
			{
				plugins: [svelte()],
				// The `components` project loads ONLY svelte() — NOT SvelteKitPWA — so the
				// `virtual:pwa-register/svelte` + `virtual:pwa-info` modules that the real
				// +layout.svelte imports are unresolvable here (they're synthesized by the PWA
				// plugin in the production build). Alias them to test-support stubs so the REAL,
				// UNMODIFIED +layout.svelte renders in the OFFL-03 verify test (D-09 — zero source
				// change). The stubs expose settable stores so a test can drive the waiting-worker
				// → "New version ready" toast path. Only `tests/components/**` uses these.
				resolve: {
					alias: {
						'virtual:pwa-register/svelte': fileURLToPath(
							new URL('./tests/components/support/pwa-register-stub.ts', import.meta.url)
						),
						'virtual:pwa-info': fileURLToPath(
							new URL('./tests/components/support/pwa-info-stub.ts', import.meta.url)
						),
						// +layout.svelte imports `$lib/game.svelte` via SvelteKit's `$lib` alias, which
						// only sveltekit() registers — absent in this svelte()-only project. Map it to
						// src/lib so the real layout resolves its game-singleton import unchanged.
						$lib: fileURLToPath(new URL('./src/lib', import.meta.url))
					}
				},
				test: {
					name: 'components',
					include: ['tests/components/**/*.svelte.test.ts'],
					browser: {
						enabled: true,
						provider: playwright(),
						headless: true,
						instances: [{ browser: 'chromium' }]
					}
				}
			}
		]
	}
});
