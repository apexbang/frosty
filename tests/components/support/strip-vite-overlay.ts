// strip-vite-overlay.ts — test-support (NOT production source).
//
// Wave-0 RED component tests in the `components` browser project intentionally reference
// not-yet-built modules (ExpendStepper.svelte, ResolutionBanner.svelte, the `mergeOrder`
// export). A failed module load makes Vite inject a `<vite-error-overlay>` custom element
// into the SHARED browser document. vitest-browser-svelte's auto-cleanup only unmounts
// RENDERED components — it does NOT remove the Vite overlay — so the overlay (whose shadow
// DOM contains the failing test's SOURCE TEXT) persists into the next test file in the same
// browser worker and contaminates sibling DOM text queries (e.g. getByText('DEF') matching
// overlay source). Each Phase-7 RED file calls this in an afterEach so its overlay never
// leaks. Once the target modules land, the imports resolve, no overlay is produced, and
// this is a harmless no-op.

export function stripViteOverlay(): void {
	if (typeof document === 'undefined') return;
	// The Vite client error overlay is a custom element appended to <body>.
	for (const el of Array.from(document.querySelectorAll('vite-error-overlay'))) {
		el.remove();
	}
}

/**
 * Dynamically import a not-yet-built module WITHOUT letting its load failure surface as an
 * unhandled rejection — which is what triggers Vite's shared-document error overlay (the
 * cross-file contaminator). On success returns the requested export; on the expected
 * "module/export absent" failure it throws a plain Error so the test fails as a normal
 * assertion (RED for the right reason) and strips any overlay Vite may still have injected.
 * Once the target lands, the import resolves and the real assertions run (GREEN).
 */
// Build-time module map of every Phase-7 source module these RED tests target. `import.meta.glob`
// is resolved by Vite at BUILD time — a module that does not exist yet is simply ABSENT from the
// map (no 404 network round-trip, no error overlay injected into the shared document). This is the
// key to keeping these RED files from contaminating sibling component files: the "does it exist
// yet?" probe never touches the dev server with a failing request.
const PENDING_MODULES = import.meta.glob([
	'../../../src/lib/components/ExpendStepper.svelte',
	'../../../src/lib/components/ResolutionBanner.svelte',
	'../../../src/lib/game.svelte.ts'
]);

/**
 * Resolve a not-yet-built export via the build-time glob map. If the module is absent (not
 * built yet) OR present-but-missing-the-export, throw a plain Error so the test fails as a
 * normal assertion (RED for the right reason) — with NO dev-server 404 and NO Vite overlay.
 * `globKey` is the path relative to THIS file; `pick` selects the export from the module.
 */
export async function importPending<T>(
	globKey: string,
	pick: (_mod: Record<string, unknown>) => unknown,
	missingMessage: string
): Promise<T> {
	const loader = PENDING_MODULES[globKey];
	if (!loader) {
		stripViteOverlay();
		throw new Error(missingMessage);
	}
	const mod = (await loader()) as Record<string, unknown>;
	const value = pick(mod);
	if (value === undefined) {
		stripViteOverlay();
		throw new Error(missingMessage);
	}
	return value as T;
}
