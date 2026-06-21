// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

// UI-08: pull in the ambient declaration for `virtual:pwa-register/svelte` (the
// useRegisterSW() hook the +layout.svelte PWA toasts import). The declaration ships in
// vite-plugin-pwa (transitive via @vite-pwa/sveltekit); this reference makes svelte-check
// resolve the virtual module without a per-import @ts-ignore.
/// <reference types="vite-plugin-pwa/svelte" />
/// <reference types="vite-plugin-pwa/info" />

declare global {
	// OFFL-01: `vite.config.ts` + `svelte.config.js` single-source the GitHub Pages subpath from
	// `process.env.BASE_PATH` (D-02). svelte-check type-checks vite.config.ts, but @types/node is
	// intentionally NOT a dependency (Phase 11 ships no new packages — T-11-SC), and adding a
	// `types: ["node"]` field would force an explicit allow-list of every other ambient type. So
	// declare ONLY the minimal `process.env` shape the build config reads. This is a build-time
	// config concern; the pure engine (CORE-02) never reads process — engine purity stays enforced
	// by the `no-restricted-imports` lint gate on src/lib/engine/**, which an ambient type cannot bypass.
	var process: { env: Record<string, string | undefined> };

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
