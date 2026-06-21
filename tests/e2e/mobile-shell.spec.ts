// mobile-shell.spec.ts — the RED phone-viewport screenshot harness for Phase 12.
//
// Runs ONLY in the `phone` Playwright project (393×851, isMobile, hasTouch — the
// CLAUDE.md "Verify the PWA/frontend with headless Playwright" convention, pinned
// again via test.use below so the spec self-selects that viewport even if invoked
// directly). It drives the REAL page the same way turn-cycle.spec.ts does: boot the
// clean turn-0 starter, then exercise each mobile surface and screenshot it.
//
// RED BY DESIGN (VALIDATION 12-00-01): the inverted mobile shell (D-01), the pinned
// StatusStrip (D-03/UX-02), the bottom-anchored morphing CTA bar (D-05/UX-05), and the
// non-modal sheets (D-02/UX-03) do not exist yet — Waves 1–3 build them. Every
// structural assertion below therefore fails on a MISSING selector, never on a config
// or navigation error. No assertion is weakened to pass RED; these are the locked
// acceptances the later waves drive to green. The screenshots are the load-bearing
// phase-gate proof (VALIDATION "Playwright screenshots are the load-bearing phase-gate
// proof").
//
// PURITY: drives the real page only; imports NOTHING from tests/ and adds no engine seam.

import { test, expect } from '@playwright/test';

// Self-select the phone viewport so the harness is correct even when the spec is run
// without the `phone` project filter (the config also routes it there via testMatch).
test.use({
	viewport: { width: 393, height: 851 },
	isMobile: true,
	hasTouch: true
});

const SHOT_DIR = 'tests/e2e/__screenshots__/mobile-shell';

test.describe('Phase 12 mobile shell — phone-viewport surfaces (RED until the shell exists)', () => {
	test('rest layout: prose-dominant scroller with pinned strip + bottom CTA', async ({ page }) => {
		await page.goto('/');

		// Boot mounts the clean turn-0 starter (same boot the §5.4 e2e relies on).
		await expect(page.getByText(/Turn 0/)).toBeVisible();

		// UX-02 — a slim persistent status strip (one tap opens the full StatePanel).
		// RED: StatusStrip's "Open full unit state" button does not exist yet (Wave 1).
		await expect(page.getByRole('button', { name: /open full unit state/i })).toBeVisible();

		// UX-05 — a single bottom-anchored CTA that, at idle, reads "Start turn".
		// (turn-cycle.spec already drives this label; here it is the mobile thumb-zone bar.)
		const cta = page.getByRole('button', { name: 'Start turn' });
		await expect(cta).toBeVisible();

		// UX-01 — the AI narrative is the dominant, always-visible scroller.
		await expect(page.getByLabel('Narrative')).toBeVisible();

		await page.screenshot({ path: `${SHOT_DIR}/01-rest.png`, fullPage: true });
	});

	test('UX-02: tapping the status strip opens the non-modal State sheet', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText(/Turn 0/)).toBeVisible();

		// RED: the strip button does not exist yet → click fails to find it.
		await page.getByRole('button', { name: /open full unit state/i }).click();

		// The State sheet is a non-modal <aside aria-label="Unit state"> (NOT role=dialog).
		const stateSheet = page.getByRole('complementary', { name: /unit state/i });
		await expect(stateSheet).toBeVisible();
		// Prose stays readable BEHIND the sheet (no scrim blocks it) — UX-03.
		await expect(page.getByLabel('Narrative')).toBeVisible();

		await page.screenshot({ path: `${SHOT_DIR}/02-state-sheet.png`, fullPage: true });
	});

	test('UX-04/UX-05: Start turn opens the Orders sheet (single sheet, no stacking)', async ({
		page
	}) => {
		await page.goto('/');
		await expect(page.getByText(/Turn 0/)).toBeVisible();

		// Starting the turn composes orders in the ONE Orders sheet (non-modal <aside>).
		// RED: the Orders sheet host does not exist yet (Wave 2).
		await page.getByRole('button', { name: 'Start turn' }).click();
		const ordersSheet = page.getByRole('complementary', { name: /orders/i });
		await expect(ordersSheet).toBeVisible();

		await page.screenshot({ path: `${SHOT_DIR}/03-orders-sheet.png`, fullPage: true });
	});

	test('UX-06: the confirm/dice beat is the ONE modal dialog', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText(/Turn 0/)).toBeVisible();

		// Drive to the confirm beat (mirrors turn-cycle.spec's compose→paste→confirm path).
		await page.getByRole('button', { name: 'Start turn' }).click();

		// RED: until the mobile shell exists, the confirm beat is not presented as a
		// single <dialog> (it is the desktop 3rd column today) — the modal selector is absent.
		const confirmModal = page.getByRole('dialog', { name: /confirm and resolve/i });
		await expect(confirmModal).toBeVisible();

		await page.screenshot({ path: `${SHOT_DIR}/04-confirm-modal.png`, fullPage: true });
	});
});
