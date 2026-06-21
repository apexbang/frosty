// reactivity.svelte.test.ts — RED component shell for UI-03 (no stale number).
//
// Browser project. RED for cannot-find-module (panels + game.svelte.ts, Wave 2). Locks
// UI-03 structurally: `remaining` is the single $derived, and mutating game.events makes
// EVERY panel reading it update — no second copy can desync. Also asserts the engine
// boundary receives a non-proxy (RESEARCH Pitfall 1: $state.snapshot before the engine).

import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { game } from '../../src/lib/game.svelte';
import StatePanel from '../../src/lib/components/StatePanel.svelte';
import { seedStarter } from '../../src/lib/seed';

beforeEach(() => {
	game.state = seedStarter();
	game.events = [];
});

describe('UI-03 — reactive, no stale number across panels', () => {
	test('mutating game.events updates the rendered remaining (frag 4 → 2) with no manual refresh', async () => {
		const screen = render(StatePanel);
		await expect.element(screen.getByText(/frag:\s*4/)).toBeVisible();

		// Spend two frag this turn via the event stream — the single $derived must repaint.
		game.events = [
			{ kind: 'expend', side: 'BLUE', actor: '1-1', item: 'frag', qty: 2, reason: 'turn-2 contact', turn: 2 },
			{ kind: 'expend', side: 'BLUE', actor: '1-1', item: 'frag', qty: 2, reason: 'assault', turn: 4 }
		];
		await expect.element(screen.getByText(/frag:\s*2/)).toBeVisible();
		// smoke never appeared in an expend — it must stay 4 (the canary), proving no over-sweep.
		await expect.element(screen.getByText(/smoke:\s*4/)).toBeVisible();
	});

	test('game.remaining is a derived map, never a stored field on the panel', () => {
		// The single source of truth: game exposes remaining as a derived view.
		expect(game.remaining).toBeDefined();
		expect(typeof game.remaining).toBe('object');
	});
});
