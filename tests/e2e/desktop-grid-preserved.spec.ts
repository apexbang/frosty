// desktop-grid-preserved.spec.ts — the RED UX-08 desktop no-regression proof.
//
// Runs in the `chromium` (Desktop Chrome) project at a ≥1024px viewport. UX-08 locks
// that the existing 3-column shell (StatePanel · NarrativePanel · DiceConfirmPanel,
// `28% 1fr 30%` grid) is PRESERVED on wide viewports after D-01 inverts the base to
// mobile-first. This spec asserts that on desktop the shell is a 3-column CSS grid and
// the DiceConfirmPanel is a COLUMN (not the one mobile <dialog> modal).
//
// RED BY DESIGN (VALIDATION 12-00-01): until Wave 3 confirms the desktop grid is moved
// VERBATIM into `@media (min-width: 1024px)`, this spec fails on the absent
// grid container / wrong column count. It is intentionally diffable against today's
// layout (RESEARCH Pitfall 6 — UX-08 is verifiable by diffing the min-width block).
// No assertion is weakened to pass RED.
//
// PURITY: drives the real page only; imports NOTHING from tests/.

import { test, expect } from '@playwright/test';

// Wide desktop viewport — comfortably above the 1024px restore breakpoint (D-01).
test.use({ viewport: { width: 1440, height: 900 } });

test.describe('UX-08 — desktop 3-column grid preserved (RED until Wave 3)', () => {
	test('the in-game shell is a 3-column CSS grid at ≥1024px', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText(/Turn 0/)).toBeVisible();

		// RED: the shell-grid container does not exist yet. The locked contract is a
		// CSS grid with THREE template columns (the existing 28% 1fr 30%).
		const grid = page.locator('.shell-grid');
		await expect(grid).toBeVisible();

		const columns = await grid.evaluate(
			(el) => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length
		);
		expect(columns).toBe(3);
	});

	test('DiceConfirmPanel is a column on desktop, NOT the mobile modal', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText(/Turn 0/)).toBeVisible();

		// All three panels render side-by-side; the dice/confirm content is the 3rd column.
		// The DiceConfirmPanel's persistent section label is "Dice and confirm" — present at
		// every turn (the inner "Last resolution" block only exists AFTER a turn resolves, so it
		// is the wrong handle for a turn-0 no-regression check). This asserts the panel is a
		// rendered COLUMN; the no-modal assertion below proves it is not the mobile dialog.
		await expect(page.getByLabel('Narrative')).toBeVisible();
		await expect(page.getByLabel('Dice and confirm')).toBeVisible();

		// On desktop the confirm beat is NOT presented as the single <dialog> modal
		// (that is the mobile-only presentation). RED until the responsive split lands.
		const modal = page.getByRole('dialog', { name: /confirm and resolve/i });
		await expect(modal).toHaveCount(0);
	});
});
