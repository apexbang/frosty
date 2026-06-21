// pwa-info-stub.ts — test-support (NOT production source).
//
// Stands in for `virtual:pwa-info` (synthesized by SvelteKitPWA, absent in the `components`
// test build — see pwa-register-stub.ts) via a `resolve.alias` so the REAL +layout.svelte
// renders unmodified. The layout reads `pwaInfo.webManifest.linkTag` and injects it into
// <svelte:head> on mount (ISSUE-A). A benign, known link tag keeps that path inert in tests.
export const pwaInfo = {
	pwaInDevEnvironment: false,
	webManifest: {
		href: '/manifest.webmanifest',
		useCredentials: false,
		linkTag: '<link rel="manifest" href="/manifest.webmanifest" />'
	}
} as const;
