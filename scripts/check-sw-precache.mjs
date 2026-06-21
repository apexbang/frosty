#!/usr/bin/env node
// check-sw-precache.mjs — the ISSUE-B build-artifact gate (Phase 11, OFFL-01).
//
// The offline cold-launch correctness invariant (RESEARCH §System Architecture): the URL
// bound by `createHandlerBoundToURL(...)` in the generated service worker (the
// navigateFallback shell) MUST appear verbatim as a `url:` entry in `precacheAndRoute([...])`.
// If they differ by even a trailing slash, an offline navigation finds no precache match and
// the app fails to cold-launch under the subpath.
//
// Config inspection alone is below the Nyquist sampling floor (RESEARCH §Nyquist note) — a
// `vite.config.ts` can look correct and still emit a mismatched SW (the staged-but-broken
// state proved it). This script inspects the BUILD ARTIFACT, which is the CI-automatable proxy
// for the real-browser offline launch.
//
// Usage: node scripts/check-sw-precache.mjs   (run `BASE_PATH=/frosty npm run build` first)
// Exit 0 = the bound shell URL is precached (PASS). Exit non-zero = absent build / mismatch.

import { readFileSync, existsSync } from 'node:fs';

const SW_PATH = 'build/sw.js';

if (!existsSync(SW_PATH)) {
	console.error(`[check:sw] FAIL — ${SW_PATH} does not exist.`);
	console.error('[check:sw] Build the production PWA first, e.g.:');
	console.error('[check:sw]   BASE_PATH=/frosty npm run build');
	process.exit(1);
}

const sw = readFileSync(SW_PATH, 'utf8');

// 1. Extract the navigateFallback shell URL bound by createHandlerBoundToURL("<url>").
const boundMatch = sw.match(/createHandlerBoundToURL\(\s*["'`]([^"'`]*)["'`]\s*\)/);
if (!boundMatch) {
	console.error('[check:sw] FAIL — no createHandlerBoundToURL("...") found in build/sw.js.');
	console.error('[check:sw] Expected a NavigationRoute bound to navigateFallback. Is the SW a');
	console.error('[check:sw] generateSW build with a navigateFallback configured?');
	process.exit(1);
}
const boundUrl = boundMatch[1];

// 2. Collect every precache `url:` entry. The generated precache manifest is a list of
//    `{ revision: ..., url: "..." }` objects passed to precacheAndRoute([...]). Scan the
//    whole SW for url: string literals (the precache manifest is the only place they appear).
const precacheUrls = new Set();
for (const m of sw.matchAll(/url\s*:\s*["'`]([^"'`]*)["'`]/g)) {
	precacheUrls.add(m[1]);
}

if (precacheUrls.size === 0) {
	console.error('[check:sw] FAIL — no precache `url:` entries found in build/sw.js.');
	console.error('[check:sw] Expected precacheAndRoute([{ url, revision }, ...]).');
	process.exit(1);
}

// 3. The gate: the bound URL must appear verbatim as a precache url.
if (precacheUrls.has(boundUrl)) {
	console.log(
		`[check:sw] PASS — navigateFallback shell "${boundUrl}" is precached (createHandlerBoundToURL ⇄ precacheAndRoute agree).`
	);
	process.exit(0);
}

console.error(
	`[check:sw] FAIL — navigateFallback shell "${boundUrl}" is NOT in the precache manifest.`
);
console.error('[check:sw] createHandlerBoundToURL is bound to a URL with no matching precache');
console.error('[check:sw] entry — offline cold-launch will fail (ISSUE-B). Precache url: entries:');
for (const u of [...precacheUrls].sort()) {
	console.error(`[check:sw]   ${JSON.stringify(u)}`);
}
console.error(
	'[check:sw] Fix: align navigateFallback with a precached shell, e.g. pass the plugin its base'
);
console.error('[check:sw] via `kit: { base, adapterFallback: `${base}/`, spa: true }` (RESEARCH Pattern 2).');
process.exit(1);
