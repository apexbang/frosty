// durability-nudge.svelte.test.ts — RED→GREEN behavior suite for Phase 11 Plan 02 (OFFL-04, D-07).
//
// Browser project (real chromium). The OFFL-04 durability nudge is a persistent, ALWAYS-SHOWN
// static caption near the export/import affordance on the Campaigns screen, telling the user
// that device storage can be cleared and to export to back up. Per D-07 it is NOT a dismissible
// toast and NOT conditional on `storage.persisted()` — it is reference info that lives where the
// user backs up.
//
// This suite locks the contract that matters and nothing more (the Plan-02 lesson — never couple
// a UI assertion to the persistence layer's fold math):
//
//   - rendering CampaignsScreen shows a caption containing the literal substring "export to back up".
//   - the caption is present BOTH with an empty store AND with at least one row (always-shown,
//     not conditional on store state — D-07).
//   - the caption is escaped literal text: there is no interpolation in it, so no element is
//     injected from the copy (the T-11-04 / T-10-07 escape contract — no {@html}).
//
// The shelf loads its rows via an async `game.listCampaigns()` read (the ScenarioPicker idiom),
// so the store state is seeded by stubbing `game.listCampaigns` exactly as
// campaigns-screen.svelte.test.ts does. RED until Task 2 adds the caption to CampaignsScreen.svelte.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { game } from '../../src/lib/game.svelte';
import CampaignsScreen from '../../src/lib/components/CampaignsScreen.svelte';
import type { CampaignRow } from '../../src/lib/engine';

/** A CampaignRow fixture with sane defaults the row meta can render. */
function row(over: Partial<CampaignRow> & { id: string; name: string }): CampaignRow {
	return {
		schemaVersion: 1,
		createdAt: 1_000,
		updatedAt: 1_000,
		currentTurn: 0,
		...over
	};
}

/**
 * Seed the shelf's data source. The screen loads its rows via an async `game.listCampaigns()`
 * read, so we stub the resolved value. Every bridge mutation is a no-op resolved Promise so a
 * stray click never reaches the real store.
 */
function seed(rows: CampaignRow[], liveId = ''): void {
	game.campaignId = liveId;
	vi.spyOn(game, 'listCampaigns').mockResolvedValue(rows);
	vi.spyOn(game, 'switchCampaign').mockResolvedValue(undefined);
	vi.spyOn(game, 'duplicate').mockResolvedValue(undefined);
	vi.spyOn(game, 'rename').mockResolvedValue(undefined);
	vi.spyOn(game, 'openPicker').mockImplementation(() => {});
}

const NUDGE = 'export to back up';

beforeEach(() => {
	game.campaignId = '';
	game.lifecycleWarning = null;
	game.duplicateToast = null;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('OFFL-04 / D-07 — always-shown durability nudge', () => {
	test('renders the "export to back up" caption with an EMPTY store', async () => {
		seed([]);
		const screen = render(CampaignsScreen);

		// The empty-store landing still shows the nudge — it is reference info, not gated on rows.
		await expect.element(screen.getByText(new RegExp(NUDGE))).toBeVisible();
	});

	test('renders the "export to back up" caption with a POPULATED store (at least one row)', async () => {
		seed([row({ id: 'a', name: 'Alpha Op', updatedAt: 100 })]);
		const screen = render(CampaignsScreen);

		// The row loaded…
		await expect.element(screen.getByText('Alpha Op')).toBeVisible();
		// …and the nudge is still present — always-shown, identical copy in both states (D-07).
		await expect.element(screen.getByText(new RegExp(NUDGE))).toBeVisible();
	});

	test('the caption is escaped literal text — it injects no element from interpolation', async () => {
		seed([]);
		render(CampaignsScreen);

		// The nudge is a static literal sentence (no {game.*}, no {@html}). Assert the literal
		// substring is present in the document text and that no rogue element was created from it.
		await vi.waitFor(() => {
			expect(document.body.textContent ?? '').toContain(NUDGE);
		});
		// There is nothing to inject (static copy) — sanity-check no stray <img>/<script> appeared.
		expect(document.querySelector('img[src="x"]')).toBeNull();
	});
});
