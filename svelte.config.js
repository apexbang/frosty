import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	// Project-wide Svelte 4/5 guardrail (CLAUDE.md "#1 Hazard").
	// runes: true makes legacy v4 reactivity idioms ($:, export let, writable
	// stores) a compile error — even though no Svelte component exists in this
	// phase, the guardrail is set now so it can never be forgotten later.
	compilerOptions: {
		runes: true
	},

	kit: {
		// v1 is a fully static, host-anywhere installable PWA — no server.
		// Swap to adapter-auto/adapter-node only when the M4 relay route lands.
		//
		// Subpath base for GitHub Pages project sites (OFFL-01): served at
		// apexbang.github.io/frosty/, so the app lives under `/frosty`. BASE_PATH is
		// injected by the deploy workflow; empty locally so `dev`/`preview` stay at root.
		paths: { base: process.env.BASE_PATH || '' },
		// fallback: '404.html' makes this a TRUE SPA build (UI-08 / RESEARCH OQ#3) AND is the
		// filename GitHub Pages auto-serves for any unmatched deep link — so an online deep
		// URL loads the app shell rather than a host 404. The PWA service worker precaches the
		// shell and navigateFallback serves it offline, so an offline launch from the
		// home-screen icon loads the shell and reconstructs the campaign from IndexedDB.
		adapter: adapter({ fallback: '404.html' })
	}
};

export default config;
