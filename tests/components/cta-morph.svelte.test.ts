// cta-morph.svelte.test.ts — RED component contract for UX-05 (bottom CTA morph).
//
// Browser project. RED: the single bottom-anchored CTA whose label/disabled morphs with
// game.machine (D-05) does not exist yet — it lands in the +page.svelte refactor (Wave 1/3).
// Locks the per-machine mapping (RESEARCH Pattern 3): idle → "Start turn",
// awaitingPaste → "Paste response", resolving → "Resolving…" + disabled. The label is a
// $derived of game.machine — never a stored copy (the drift this project eliminates).
// None weakened to pass RED.
//
// Harness: the locked shape (state-panel.svelte.test.ts) — render the page-level shell, the
// game singleton, seedStarter(), beforeEach seeding game.state + game.events = []. game.machine
// is mutated per-test (mutate-never-reassign-the-reference; machine is a $state field).
//
// Run: npx vitest --project components run tests/components/cta-morph.svelte.test.ts

import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { game } from '../../src/lib/game.svelte';
// RED: the bottom-CTA shell does not exist yet (Wave 1/3).
import Page from '../../src/routes/+page.svelte';
import { seedStarter } from '../../src/lib/seed';

beforeEach(() => {
	game.state = seedStarter();
	game.events = [];
	game.machine = 'idle';
});

describe('UX-05 — the bottom CTA label/disabled morphs by game.machine', () => {
	test('idle → "Start turn" (enabled)', async () => {
		game.machine = 'idle';
		const screen = render(Page);
		const cta = screen.getByRole('button', { name: 'Start turn' });
		await expect.element(cta).toBeVisible();
		await expect.element(cta).toBeEnabled();
	});

	test('awaitingPaste → "Paste response"', async () => {
		game.machine = 'awaitingPaste';
		const screen = render(Page);
		await expect.element(screen.getByRole('button', { name: /paste response/i })).toBeVisible();
	});

	test('resolving → "Resolving…" and disabled', async () => {
		game.machine = 'resolving';
		const screen = render(Page);
		const cta = screen.getByRole('button', { name: /resolving/i });
		await expect.element(cta).toBeVisible();
		await expect.element(cta).toBeDisabled();
	});
});
