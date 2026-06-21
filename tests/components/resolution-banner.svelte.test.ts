// resolution-banner.svelte.test.ts — Wave-0 RED component contract for UI-05 / D-04.
//
// `components` browser project. RED for cannot-find-module until ResolutionBanner.svelte
// lands (Plan 07-04). Locks the UI-05 transient-banner contract (mirrors ContactBeat):
//   - $derived over game.lastResolution — collapsed strip shows the §5.4 values EXACTLY:
//     band `success_costly`, roll `3 4`, net `+1` (UI-SPEC line 139/188);
//   - NON-GATING: the banner never reads OR writes game.machine (UI-05 core, D-04);
//   - clears (derives hidden) when lastResolution is null (the empty/undone state);
//   - AI-supplied modifier labels render as ESCAPED text (XSS contract, never {@html}).
//
// The banner is a transient projection over EXISTING lastResolution data — no new engine
// field. game.machine is the gating signal it must never touch (proven by mutating machine
// and asserting the banner is indifferent).

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from 'vitest-browser-svelte';
import type { Component } from 'svelte';

import { game } from '../../src/lib/game.svelte';
import { stripViteOverlay, importPending } from './support/strip-vite-overlay';

// RED: ResolutionBanner.svelte does not exist yet (Plan 07-04). The import is LAZY (inside
// the test, not a top-level static import) so a missing-module fetch fails THIS test's
// assertion cleanly instead of crashing the shared browser worker's module graph and
// cascading timeouts into sibling component files (test-isolation discipline). Once the
// component lands the import resolves and the locked §5.4 assertions drive it GREEN.
function loadBanner(): Promise<Component> {
	return importPending<Component>(
		'../../../src/lib/components/ResolutionBanner.svelte',
		(mod) => mod.default,
		'ResolutionBanner.svelte not built yet (Plan 07-04)'
	);
}

/** The §5.4 resolution (roll [3,4], net +1, band success_costly) — the locked banner values. */
const RESOLUTION_5_4 = {
	roll: [3, 4] as [number, number],
	modifiers: [
		{ label: '60mm support', value: 2 },
		{ label: 'enemy in prepared cover', value: -1 }
	],
	net: 1,
	band: 'success_costly' as const
};

beforeEach(() => {
	game.lastResolution = null;
	game.machine = 'idle';
});

// A missing-module dynamic import (ResolutionBanner not built yet) injects a Vite error
// overlay into the SHARED browser document; strip it so it never leaks into sibling
// component files' DOM queries (test-isolation; the overlay is not auto-cleaned).
afterEach(() => stripViteOverlay());

describe('UI-05 — ResolutionBanner is a transient, non-gating $derived projection', () => {
	test('renders nothing when lastResolution is null (the empty / undone state)', async () => {
		const screen = render(await loadBanner());
		await expect.element(screen.getByText(/success_costly|stalled|failure/)).not.toBeInTheDocument();
	});

	test('collapsed strip shows the §5.4 band, roll, and net EXACTLY (success_costly · 3 4 · +1)', async () => {
		game.lastResolution = RESOLUTION_5_4;
		const screen = render(await loadBanner());
		await expect.element(screen.getByText(/success_costly/)).toBeVisible();
		// roll glyphs 3 and 4 (the two d6 faces) and the +1 net.
		await expect.element(screen.getByText(/3\s*4/)).toBeVisible();
		await expect.element(screen.getByText(/\+?1/)).toBeVisible();
	});

	test('NON-GATING — the banner never reads or writes game.machine (renders the same regardless)', async () => {
		game.lastResolution = RESOLUTION_5_4;

		// Render with the machine in a NON-gating state, then in a would-be gating state —
		// the banner must surface identically (it is indifferent to machine; D-04 non-gating).
		game.machine = 'idle';
		const a = render(await loadBanner());
		await expect.element(a.getByText(/success_costly/)).toBeVisible();

		// vitest-browser-svelte cleanup only runs in beforeEach, not between two renders in
		// one test; the banner's getByText is bound to document.body (page-wide), so the first
		// mount must be torn down before the second or both match (strict-mode violation).
		cleanup();

		game.machine = 'confirming';
		const b = render(await loadBanner());
		await expect.element(b.getByText(/success_costly/)).toBeVisible();

		// The banner did not flip the machine to gate the turn — it stays exactly as set.
		expect(game.machine).toBe('confirming');
	});

	test('clears (derives hidden) when lastResolution is reset to null', async () => {
		game.lastResolution = RESOLUTION_5_4;
		const screen = render(await loadBanner());
		await expect.element(screen.getByText(/success_costly/)).toBeVisible();

		// Reset to null (the post-undo / next-order-start state) — the banner derives hidden.
		game.lastResolution = null;
		await expect.element(screen.getByText(/success_costly/)).not.toBeInTheDocument();
	});

	test('AI-supplied modifier labels render as ESCAPED text — never as HTML (XSS contract)', async () => {
		game.lastResolution = {
			...RESOLUTION_5_4,
			modifiers: [{ label: '<img src=x onerror="alert(1)">pwn', value: 1 }]
		};
		const screen = render(await loadBanner());
		// The itemized modifier labels live in the expand (the full dice projection); tap the
		// strip to reveal them, then assert the AI-supplied label is ESCAPED text, never markup.
		await screen.getByRole('button', { name: /Resolution/ }).click();
		await expect.element(screen.getByText(/<img src=x onerror=/)).toBeVisible();
		expect(document.querySelector('img')).toBeNull();
	});
});
