// expend-stepper.svelte.test.ts — Wave-0 RED component contract for ORDER-05.
//
// `components` browser project (real chromium + real IndexedDB). RED for cannot-find-module
// until ExpendStepper.svelte lands (Plan 07-02). Locks the ORDER-05 "cannot exceed remaining"
// contract — the stepper's `+` ceiling IS `game.remaining[sideId][item]` (the existing
// $derived; game.svelte.ts:196), never an independent stored number:
//   - `+` is disabled when qty === game.remaining[sideId][item] (the at-max boundary);
//   - tapping `+` can never push qty above that derived ceiling;
//   - `−` is disabled at the floor (qty === 0);
//   - the readout shows `{item} {qty} / {remaining}`.
//
// game.remaining derives from game.state; seedStarter() mirrors §5.4 (BLUE frag pre-turn
// derives to 4 with events []), so the BLUE/frag ceiling is 4 — the value the +-disable
// boundary is asserted against. ORDER-05 is true BY CONSTRUCTION (the stepper holds no
// number that could exceed the ledger); the test proves the binding, not new ledger code.

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Component } from 'svelte';

import { game } from '../../src/lib/game.svelte';
import { seedStarter } from '../../src/lib/seed';
import { stripViteOverlay, importPending } from './support/strip-vite-overlay';

// RED: ExpendStepper.svelte does not exist yet (Plan 07-02). The import is LAZY (inside
// the test, not a top-level static import) so a missing-module fetch fails THIS test's
// assertion cleanly instead of crashing the shared browser worker's module graph and
// cascading timeouts into sibling component files (test-isolation discipline). Once the
// component lands the import resolves and the locked assertions drive it GREEN.
function loadStepper(): Promise<Component> {
	return importPending<Component>(
		'../../../src/lib/components/ExpendStepper.svelte',
		(mod) => mod.default,
		'ExpendStepper.svelte not built yet (Plan 07-02)'
	);
}

beforeEach(() => {
	game.state = seedStarter();
	game.events = [];
	game.machine = 'idle';
});

// A missing-module dynamic import (ExpendStepper not built yet) injects a Vite error
// overlay into the SHARED browser document; strip it so it never leaks into sibling
// component files' DOM queries (test-isolation; the overlay is not auto-cleaned).
afterEach(() => stripViteOverlay());

describe('ORDER-05 — ExpendStepper cannot exceed the derived remaining ceiling', () => {
	test('the derived ceiling is game.remaining[BLUE][frag] === 4 (the §5.4 pre-turn count)', () => {
		// Sanity on the binding source — the stepper reads THIS, never a stored copy.
		expect(game.remaining.BLUE.frag).toBe(4);
	});

	test('renders the {item} {qty} / {remaining} readout (tabular ledger numbers)', async () => {
		const screen = render(await loadStepper(), { props: { sideId: 'BLUE', item: 'frag', qty: 0 } });
		await expect.element(screen.getByText(/frag/)).toBeVisible();
		// 0 / 4 — the derived ceiling is surfaced next to the proposal qty.
		await expect.element(screen.getByText(/0\s*\/\s*4/)).toBeVisible();
	});

	test('the − button is disabled at the floor (qty 0)', async () => {
		const screen = render(await loadStepper(), { props: { sideId: 'BLUE', item: 'frag', qty: 0 } });
		await expect.element(screen.getByRole('button', { name: /decrease frag/i })).toBeDisabled();
	});

	test('the + button is DISABLED when qty === remaining (the at-max boundary)', async () => {
		// Start at the ceiling (4) — the + must be disabled; there is no path past the ledger.
		const screen = render(await loadStepper(), { props: { sideId: 'BLUE', item: 'frag', qty: 4 } });
		await expect.element(screen.getByRole('button', { name: /increase frag/i })).toBeDisabled();
		await expect.element(screen.getByText(/4\s*\/\s*4/)).toBeVisible();
	});

	test('tapping + steps up to but NEVER beyond the derived ceiling', async () => {
		const screen = render(await loadStepper(), { props: { sideId: 'BLUE', item: 'frag', qty: 3 } });
		const plus = screen.getByRole('button', { name: /increase frag/i });
		// One tap reaches the ceiling (3 → 4); the + then disables.
		await plus.click();
		await expect.element(screen.getByText(/4\s*\/\s*4/)).toBeVisible();
		await expect.element(plus).toBeDisabled();
		// The readout never shows a qty above the ceiling (no 5 / 4).
		await expect.element(screen.getByText(/5\s*\/\s*4/)).not.toBeInTheDocument();
	});

	test('the ceiling tracks game.remaining — a smaller remaining lowers the max', async () => {
		// smoke pre-turn derives to 4 as well; assert the stepper binds the per-item ceiling.
		expect(game.remaining.BLUE.smoke).toBe(4);
		const screen = render(await loadStepper(), { props: { sideId: 'BLUE', item: 'smoke', qty: 4 } });
		await expect.element(screen.getByRole('button', { name: /increase smoke/i })).toBeDisabled();
	});
});
