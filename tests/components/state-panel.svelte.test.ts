// state-panel.svelte.test.ts — RED component shell for UI-01 (StatePanel).
//
// Runs in the `components` browser project (vitest-browser-svelte + @vitest/browser,
// chromium). RED for cannot-find-module: StatePanel.svelte and game.svelte.ts do not
// exist yet (Wave 2). The assertion bodies are the locked acceptance the later wave
// drives to green (UI-SPEC State→Visual Mapping); none is weakened to pass RED.

import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

// RED: neither module exists yet (Wave 1/2).
import { game } from '../../src/lib/game.svelte';
import StatePanel from '../../src/lib/components/StatePanel.svelte';
import { seedStarter } from '../../src/lib/seed';

beforeEach(() => {
	game.state = seedStarter();
	game.events = [];
});

describe('UI-01 — StatePanel renders folded state', () => {
	test('renders the turn/clock/phase strip from meta', async () => {
		const screen = render(StatePanel);
		await expect.element(screen.getByText(/Turn 3/)).toBeVisible();
		await expect.element(screen.getByText(/engagement/)).toBeVisible();
	});

	test('renders each unit id', async () => {
		const screen = render(StatePanel);
		await expect.element(screen.getByText('1-1')).toBeVisible();
		await expect.element(screen.getByText('MTR')).toBeVisible();
		await expect.element(screen.getByText('DEF')).toBeVisible();
	});

	test('renders the pre-turn consumable counts from game.remaining (frag 4, smoke 4)', async () => {
		const screen = render(StatePanel);
		// remaining is the single $derived — the panel holds no independent number.
		await expect.element(screen.getByText(/frag:\s*4/)).toBeVisible();
		await expect.element(screen.getByText(/smoke:\s*4/)).toBeVisible();
	});

	test('strength band renders as a discrete band label (75% has accessible text)', async () => {
		game.state!.sides[0].units[0].strength = 75;
		const screen = render(StatePanel);
		await expect.element(screen.getByLabelText(/strength 75%/)).toBeVisible();
	});
});
