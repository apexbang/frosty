import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
// `defineConfig` from vitest/config (not vite) so the `test` block is type-checked —
// it merges Vitest's UserConfig augmentation, which the bare vite import lacks
// (svelte-check would otherwise reject the unknown `test` property).
import { defineConfig } from 'vitest/config';

// OFFL-01: GitHub Pages serves the project site under /frosty/. BASE_PATH is injected by
// the deploy workflow (empty locally) and MUST match svelte.config's kit.paths.base, so the
// manifest scope/start_url and the SW navigation fallback resolve under the same subpath.
const base = process.env.BASE_PATH || '';

export default defineConfig({
	plugins: [
		sveltekit(),
		// UI-08 — the installable PWA. CLAUDE.md locks @vite-pwa/sveltekit; adapter-static
		// stays (this plugin is designed for a fully-static installable PWA). Registered
		// AFTER sveltekit() per RESEARCH Pattern 6.
		SvelteKitPWA({
			// 'prompt' (NOT 'autoUpdate'): a stale service worker never silently serves old
			// assets mid-turn — the user gets the non-blocking "New version ready" toast and
			// reloads on their own terms (T-07-05-01; UI-SPEC line 146). Never auto-reloads.
			registerType: 'prompt',
			// ISSUE-B (OFFL-01): hand the PWA plugin the SAME base the app uses. SvelteKit does
			// NOT propagate kit.paths.base to Vite's config.base, so the plugin's base defaulted
			// to '/' and its base-aware manifestTransform rewrote the shell to {url:"/"} — while
			// navigateFallback is `${base}/` (/frosty/). The mismatch meant an offline navigation
			// found no precache match and the cold-launch failed. Passing kit.base makes the
			// transform rewrite the shell to `${base}` and the SPA fallback to `${base}/`, so the
			// createHandlerBoundToURL(navigateFallback) target is precached (RESEARCH Pattern 2,
			// VERIFIED by grepping build/sw.js). `base` is the SAME single source (line 11) —
			// never a second/hardcoded `/frosty` (D-02). Do NOT hand-roll a manual URL-prefix
			// transform: the plugin's base-aware transform only runs when no manual transform is
			// configured, so a hand-rolled one disables it and re-introduces the bug
			// (RESEARCH §Anti-Patterns). The scripts/check-sw-precache.mjs gate enforces the match.
			kit: { base, adapterFallback: `${base}/`, spa: true },
			// The app boots client-only (ssr=false in +layout.ts) and reconstructs from
			// IndexedDB on mount, so the precached shell must resolve any deep URL offline —
			// adapter-static's SPA fallback (200.html) is what makes that work (RESEARCH OQ#3).
			strategies: 'generateSW',
			manifest: {
				name: 'Frosty',
				short_name: 'Frosty',
				description: 'A single-player, turn-based tactical wargame.',
				display: 'standalone',
				orientation: 'portrait',
				// The install chrome matches the dark-first app — the --color-dominant token
				// (UI-SPEC line 197). No new color is introduced by the PWA surface.
				theme_color: '#0b0f14',
				background_color: '#0b0f14',
				start_url: `${base}/`,
				scope: `${base}/`,
				icons: [
					{ src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
					{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
					{ src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
					{
						src: 'maskable-icon-512x512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				]
			},
			workbox: {
				// Precache the static app shell so a seeded/loaded campaign launches offline
				// (UI-08). Only same-origin, content-hashed build assets are precached — no
				// third-party surface (T-07-05-02).
				globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
				// SPA navigation fallback: an offline deep-URL launch resolves to the prerendered
				// shell (precached index.html under the base) instead of a network 404
				// (RESEARCH OQ#3). Prefixed with the GitHub Pages subpath (OFFL-01).
				navigateFallback: `${base}/`
			},
			// Avoid intercepting the dev server (the e2e/Playwright runs and `npm run dev`
			// stay SW-free); the SW only ships in the production build.
			devOptions: {
				enabled: false
			}
		})
	],
	// Dev-server cache discipline (T-s02-01): send `cache-control: no-store` so the dev
	// server (and devices curling it while debugging the IndexedDB hang) never serve a stale
	// cached app shell. Dev-only — the production PWA's caching is owned by the service worker.
	server: { headers: { 'cache-control': 'no-store' } },
	// Headless engine tests (Phase 4 persistence) run against fake-indexeddb. The
	// setup file registers indexedDB + IDBKeyRange on globalThis BEFORE any test
	// imports the idb-backed store, so the store layer tests need zero DOM.
	test: { setupFiles: ['./tests/engine/setup/fake-idb.ts'] }
});
