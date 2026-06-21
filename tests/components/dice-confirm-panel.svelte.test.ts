// dice-confirm-panel.svelte.test.ts — RED component shell for UI-04 (DiceConfirmPanel).
//
// Browser project. RED for cannot-find-module (DiceConfirmPanel.svelte + game.svelte.ts,
// Wave 2). Locks the §5.4 "shows its work" strip (roll [3,4], +2/−1, net +1,
// success_costly) + inline confirm rows from confirmDiff (on by default). The exact
// §5.4 modifier label `enemy in prepared cover` is asserted (matches EXAMPLE_ENVELOPE_5_4).

import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { game } from '../../src/lib/game.svelte';
import DiceConfirmPanel from '../../src/lib/components/DiceConfirmPanel.svelte';

beforeEach(() => {
	game.lastResolution = null;
	game.confirmRows = [];
	game.machine = 'idle';
});

describe('UI-04 — DiceConfirmPanel shows its work + inline confirm', () => {
	// Phase 12 (UX-06 empty-state collapse): the prior "No resolution yet" placeholder is
	// deliberately REMOVED — an empty RESOLUTION block must reserve no layout height (it bloated
	// the mobile rest layout, 12-03-PLAN point 4 / DiceConfirmPanel.svelte:62-66). The panel now
	// collapses to just its persistent "Dice and confirm" section heading when nothing has
	// resolved. This asserts the collapse (no placeholder text) while keeping the section present
	// (the desktop 3rd-column no-regression handle, UX-08). The §5.4 resolution + confirm-row
	// assertions below are unchanged.
	test('collapses to no empty-state placeholder when nothing resolved yet', async () => {
		render(DiceConfirmPanel);
		expect(document.body.textContent ?? '').not.toMatch(/No resolution yet/);
		// The persistent "Dice and confirm" section remains (the panel never fully unmounts —
		// it is the desktop 3rd-column no-regression handle, UX-08).
		expect(document.querySelector('section[aria-label="Dice and confirm"]')).not.toBeNull();
	});

	test('renders the §5.4 resolution: roll 3 4, +2/−1, net +1, success_costly', async () => {
		game.lastResolution = {
			roll: [3, 4],
			modifiers: [
				{ label: '60mm support', value: 2 },
				{ label: 'enemy in prepared cover', value: -1 }
			],
			net: 1,
			band: 'success_costly'
		};
		const screen = render(DiceConfirmPanel);
		await expect.element(screen.getByText('60mm support')).toBeVisible();
		await expect.element(screen.getByText('enemy in prepared cover')).toBeVisible();
		await expect.element(screen.getByText(/success_costly/)).toBeVisible();
		await expect.element(screen.getByText(/net.*\+?1/)).toBeVisible();
	});

	test('renders inline confirm rows (expend + casualty) from game.confirmRows', async () => {
		game.confirmRows = [
			{ kind: 'expend', actor: '1-1', side: 'BLUE', item: 'frag', qty: 2 },
			{ kind: 'casualty', actor: 'DEF', side: 'RED', unit: 'DEF', deltaBand: -3 }
		];
		// The confirm block is gated on machine === 'confirming' (A defense-in-depth);
		// the gate is open while the panel surfaces its rows.
		game.machine = 'confirming';
		const screen = render(DiceConfirmPanel);
		await expect.element(screen.getByText(/frag/)).toBeVisible();
		await expect.element(screen.getByText(/-3|−3/)).toBeVisible();
		// The confirm CTA is present and on by default (CONFIRM_DEFAULT_ON).
		await expect.element(screen.getByRole('button', { name: /Confirm & resolve/ })).toBeVisible();
	});
});
