// sheet-single-open.svelte.test.ts — RED component contract for UX-04 (single-sheet-open).
//
// Browser project. RED: the mobile shell that owns the single `openSheet` enum (the State
// sheet + the Orders sheet, one open at a time) does not exist yet — the +page.svelte
// refactor (D-01) + BottomSheet (D-02) land in Waves 1–2. Locks: opening Orders CLOSES State
// (at most one open — RESEARCH "Don't Hand-Roll": one enum makes nested sheets structurally
// impossible), and ActionMenu renders INSIDE the Orders sheet (NOT as a second sheet — UX-04).
// None weakened to pass RED.
//
// Harness: the locked shape (state-panel.svelte.test.ts) — render the page-level shell, the
// game singleton, seedStarter(), beforeEach seeding game.state + game.events = []. The
// $lib alias is registered for the components project (vitest.config.ts), so the route's
// $lib imports resolve unchanged.
//
// Run: npx vitest --project components run tests/components/sheet-single-open.svelte.test.ts

import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { game } from '../../src/lib/game.svelte';
// RED: the inverted mobile shell (the openSheet-enum host) does not exist yet (Wave 1/2).
import Page from '../../src/routes/+page.svelte';
import { seedStarter } from '../../src/lib/seed';

beforeEach(() => {
	game.state = seedStarter();
	game.events = [];
	game.machine = 'idle';
});

// Render the page and let the onMount boot() settle, then dismiss the empty-store Campaigns
// shelf so the seeded live game is interactable. The page's boot() runs against the test's
// clean (no-IndexedDB) store and opens the D-05 boot landing (campaignsOpen=true) which, as a
// fixed full-cover overlay, would intercept every click — a pre-existing empty-store boot quirk
// (logged in Plan 01's deferred-items.md), unrelated to the single-sheet-open invariant under
// test. Closing it leaves all of this spec's assertions (which sheet opens, single-open, the
// nested-sheet ban) fully intact — none are weakened.
async function mountReady(): Promise<ReturnType<typeof render>> {
	const screen = render(Page);
	// Let boot()'s microtasks run (it may flip campaignsOpen true), then force the seeded game
	// to the foreground.
	for (let i = 0; i < 50 && !game.campaignsOpen; i++) {
		await new Promise((r) => setTimeout(r, 5));
	}
	game.campaignsOpen = false;
	game.pickerOpen = false;
	// Phase 13: boot() mounts the turn-0 starter, whose briefing auto-opens the NON-MODAL
	// BriefingCard (OBJ-01) as a full-cover overlay — the SAME class of pre-existing boot quirk as
	// the campaignsOpen landing above (intercepts clicks aimed at the shell beneath), unrelated to
	// the single-sheet-open invariant under test. Dismiss it via its Close ✕ (the card's
	// open/closed flag is component-local $state, not on the game singleton) so this spec's
	// assertions stay intact — none weakened. No-op when no briefing/card is shown.
	for (let i = 0; i < 50 && !document.querySelector('.briefing-card'); i++) {
		await new Promise((r) => setTimeout(r, 5));
	}
	const close = document.querySelector<HTMLButtonElement>(
		'.briefing-card button[aria-label="Close briefing"]'
	);
	close?.click();
	return screen;
}

describe('UX-04 — at most one bottom sheet open (no nested stacking)', () => {
	test('tapping the status strip opens the State sheet', async () => {
		const screen = await mountReady();
		await screen.getByRole('button', { name: /open full unit state/i }).click();
		const stateSheet = document.querySelector('aside[aria-label="Unit state"]');
		expect(stateSheet).not.toBeNull();
	});

	test('opening the Orders sheet CLOSES the State sheet (single-open invariant)', async () => {
		const screen = await mountReady();

		// Open State first.
		await screen.getByRole('button', { name: /open full unit state/i }).click();
		expect(document.querySelector('aside[aria-label="Unit state"]')).not.toBeNull();

		// Starting the turn opens the Orders sheet — the State sheet must close.
		await screen.getByRole('button', { name: 'Start turn' }).click();
		expect(document.querySelector('aside[aria-label="Orders"]')).not.toBeNull();
		// At most ONE sheet: the State sheet is gone.
		expect(document.querySelector('aside[aria-label="Unit state"]')).toBeNull();
		// Exactly one <aside> sheet open.
		expect(document.querySelectorAll('aside[aria-label]').length).toBe(1);
	});

	test('ActionMenu renders INSIDE the Orders sheet, not as a second sheet', async () => {
		const screen = await mountReady();
		await screen.getByRole('button', { name: 'Start turn' }).click();

		const ordersSheet = document.querySelector('aside[aria-label="Orders"]');
		expect(ordersSheet).not.toBeNull();
		// The ActionMenu (`{unit.id} orders` region) lives WITHIN the Orders sheet subtree.
		const actionMenu = ordersSheet!.querySelector('[aria-label$="orders"]');
		expect(actionMenu).not.toBeNull();
		// It is NOT a second sheet.
		expect(document.querySelectorAll('aside[aria-label]').length).toBe(1);
	});
});

// WR-01 (code review) — the briefing auto-open latch is keyed on `campaignId`, not a one-shot
// boolean. `+page.svelte` is never remounted on campaign change (switchCampaign/import/
// scenario-start reassign game.state + game.campaignId in place on the singleton), so a one-shot
// latch suppressed the auto-open for every later turn-0 campaign in the session. These lock the
// fixed per-campaign contract: Dismiss sticks within a campaign, but a NEW turn-0 campaign re-arms.
describe('WR-01 — turn-0 briefing auto-opens once per campaign (not once per session)', () => {
	/** Wait up to ~1s for the briefing card to be (present|absent), polling the live DOM. */
	async function waitForCard(present: boolean): Promise<Element | null> {
		for (let i = 0; i < 200; i++) {
			const el = document.querySelector('.briefing-card');
			if (present ? el : !el) return el;
			await new Promise((r) => setTimeout(r, 5));
		}
		return document.querySelector('.briefing-card');
	}

	test('Dismiss sticks within the SAME campaign; a NEW turn-0 campaign re-opens', async () => {
		// mountReady boots campaign 1 (turn 0), whose briefing auto-opens, and dismisses it — so the
		// latch now records campaign 1's id and the card is closed.
		await mountReady();
		const firstId = game.campaignId;
		expect(firstId).not.toBe('');
		expect(document.querySelector('.briefing-card')).toBeNull();

		// A later state change UNDER THE SAME campaign must NOT re-open it (Dismiss stays sticky).
		const sameCampaignState = seedStarter();
		sameCampaignState.meta.turn = 0;
		game.state = sameCampaignState;
		// Give the $effect a chance to (wrongly) re-fire; it must not.
		for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
		expect(document.querySelector('.briefing-card')).toBeNull();

		// Switching to ANOTHER turn-0 campaign (new id) re-arms the auto-open — the WR-01 fix.
		const secondState = seedStarter();
		secondState.meta.turn = 0;
		game.state = secondState;
		game.campaignId = `${firstId}-second`;
		const reopened = await waitForCard(true);
		expect(reopened).not.toBeNull();
	});
});
