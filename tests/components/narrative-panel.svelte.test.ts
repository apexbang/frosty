// narrative-panel.svelte.test.ts — RED component shell for UI-02 (NarrativePanel).
//
// Browser project. RED for cannot-find-module (NarrativePanel.svelte + game.svelte.ts,
// Wave 2). Locks: prose scrollback renders turn-tagged, escaped-text-only (NEVER {@html}),
// empty state copy. Security contract (XSS via AI prose) is asserted, not weakened.

import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { game } from '../../src/lib/game.svelte';
import NarrativePanel from '../../src/lib/components/NarrativePanel.svelte';

beforeEach(() => {
	game.log = [];
});

describe('UI-02 — NarrativePanel renders prose scrollback', () => {
	test('shows the empty-state copy when there is no prose yet', async () => {
		const screen = render(NarrativePanel);
		await expect.element(screen.getByText(/No prose yet/)).toBeVisible();
	});

	test('renders a turn-tagged narrative block', async () => {
		game.log = [{ turn: 4, narrative: '1st squad pushes off the line of departure.' }];
		const screen = render(NarrativePanel);
		await expect.element(screen.getByText(/Turn 4/)).toBeVisible();
		await expect.element(screen.getByText(/1st squad pushes off/)).toBeVisible();
	});

	test('renders AI prose as ESCAPED text — never as HTML (XSS contract)', async () => {
		game.log = [{ turn: 4, narrative: '<img src=x onerror="alert(1)">pwn' }];
		const screen = render(NarrativePanel);
		// The literal markup must appear as text; no <img> element is injected.
		await expect.element(screen.getByText(/<img src=x onerror=/)).toBeVisible();
		expect(document.querySelector('img')).toBeNull();
	});
});

// ── PHASE 12 (UX-07): mobile-readable prose ──────────────────────────────────────────
// RED until Wave 1 adds the ~66ch measure cap. The 16px/1.5 size already ships
// (NarrativePanel.svelte:56-57); these assertions LOCK them (a regression would fail here)
// and add the new measure-cap requirement. The existing escaped-prose / empty-state / turn-
// tag assertions above are UNCHANGED — none is removed or weakened.
describe('UX-07 — narrative prose is mobile-readable (16px / ≥1.5 / ~66ch measure)', () => {
	test('the panel computes font-size 16px and line-height ≥ 1.5', async () => {
		game.log = [{ turn: 4, narrative: '1st squad pushes off the line of departure.' }];
		render(NarrativePanel);
		const panel = document.querySelector('.narrative-panel');
		expect(panel).not.toBeNull();
		const cs = getComputedStyle(panel!);
		expect(cs.fontSize).toBe('16px');
		// line-height resolves to a px value (16 * 1.5 = 24px ⇒ ratio ≥ 1.5).
		const ratio = parseFloat(cs.lineHeight) / parseFloat(cs.fontSize);
		expect(ratio).toBeGreaterThanOrEqual(1.5);
	});

	test('.prose caps the measure at ~66ch (a max-width is set, not "none")', async () => {
		game.log = [{ turn: 4, narrative: 'A long line of prose to exercise the measure cap.' }];
		render(NarrativePanel);
		const prose = document.querySelector('.prose');
		expect(prose).not.toBeNull();
		const maxWidth = getComputedStyle(prose!).maxWidth;
		// The measure cap is present (UX-07 ~66ch) — not the unbounded default.
		expect(maxWidth).not.toBe('none');
	});
});
