// campaigns-screen.svelte.test.ts — RED→GREEN behavior suite for Phase 10 Plan 03 (CAMP-01..08).
//
// Browser project (real chromium). The Campaigns "shelf" is RENDER + DISPATCH ONLY over the
// `game` singleton: it lists campaigns most-recent-first, exposes an empty state, and every row
// action dispatches a `game` bridge method. This suite locks the binding contract from the
// UI-SPEC State→Visual mapping table:
//
//   - list order is descending updatedAt; an empty store renders the `No campaigns yet` hero +
//     the two top-level actions (New game / Import campaign), no rows.
//   - a campaign name renders as ESCAPED LITERAL text — a `<img onerror>` name never injects an
//     element (the T-10-07 XSS contract — no {@html}).
//   - arming delete shows the type-to-confirm field with the destructive `Delete` DISABLED;
//     a non-matching string keeps it disabled + shows the muted mismatch hint; the EXACT name
//     enables it (the T-10-08 destructive-misfire guard — the `disabled` attribute, not colour).
//   - exactly ONE row carries the active marker — the row whose id === game.campaignId (CAMP-07).
//   - the dispatch wiring: Resume→switchCampaign(id), Duplicate→duplicate(id),
//     Save name→rename(id, draft), New game→openPicker().
//
// RED contract: until CampaignsScreen.svelte / CampaignRow.svelte exist, the top-level component
// imports fail to resolve and the whole file errors (the RED verify grep matches
// "CampaignsScreen|cannot find|failed to resolve"). Once both land, the assertions run GREEN.
//
// The bridge seams (listCampaigns / campaignId / switchCampaign / duplicate / rename / openPicker)
// are arrow fields / $state on the real singleton, so the rows are seeded by stubbing
// `game.listCampaigns` + setting `game.campaignId`, and the dispatch methods are spied with
// `vi.spyOn`. This keeps the UI contract decoupled from the store's fold arithmetic (the Plan-02
// lesson: never couple a UI assertion to the persistence layer's snapshot/fold math).

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
 * read (the ScenarioPicker idiom), so we stub the resolved value and set the live id. Returns
 * the spies the dispatch tests assert against. Every bridge mutation is stubbed to a no-op
 * resolved Promise so a click never reaches the real store.
 */
function seed(rows: CampaignRow[], liveId = '') {
	game.campaignId = liveId;
	const listSpy = vi.spyOn(game, 'listCampaigns').mockResolvedValue(rows);
	const switchSpy = vi.spyOn(game, 'switchCampaign').mockResolvedValue(undefined);
	const duplicateSpy = vi.spyOn(game, 'duplicate').mockResolvedValue(undefined);
	const renameSpy = vi.spyOn(game, 'rename').mockResolvedValue(undefined);
	const openPickerSpy = vi.spyOn(game, 'openPicker').mockImplementation(() => {});
	return { listSpy, switchSpy, duplicateSpy, renameSpy, openPickerSpy };
}

beforeEach(() => {
	game.campaignId = '';
	game.lifecycleWarning = null;
	game.duplicateToast = null;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('CAMP-01 — list order + empty state', () => {
	test('renders rows most-recent-first (descending updatedAt)', async () => {
		seed([
			row({ id: 'a', name: 'Alpha Op', updatedAt: 100 }),
			row({ id: 'b', name: 'Bravo Op', updatedAt: 300 }),
			row({ id: 'c', name: 'Charlie Op', updatedAt: 200 })
		]);
		const screen = render(CampaignsScreen);

		// Both names are present (the list loaded).
		await expect.element(screen.getByText('Bravo Op')).toBeVisible();
		await expect.element(screen.getByText('Alpha Op')).toBeVisible();

		// Descending updatedAt: Bravo (300) before Charlie (200) before Alpha (100).
		const names = Array.from(document.querySelectorAll('[data-campaign-name]')).map(
			(el) => el.textContent?.trim()
		);
		expect(names).toEqual(['Bravo Op', 'Charlie Op', 'Alpha Op']);
	});

	test('an empty store renders the No campaigns yet hero + both top-level actions, no rows', async () => {
		seed([]);
		const screen = render(CampaignsScreen);

		await expect.element(screen.getByText(/No campaigns yet/)).toBeVisible();
		// The empty store offers New game + Import campaign in BOTH the header and the hero
		// (UI-SPEC: the empty state places the two next-step actions directly beneath the hero),
		// so each label legitimately matches twice — assert the first is visible.
		await expect.element(screen.getByRole('button', { name: /New game/ }).first()).toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: /Import campaign/ }).first())
			.toBeVisible();
		// No campaign rows rendered.
		expect(document.querySelectorAll('[data-campaign-name]').length).toBe(0);
	});
});

describe('T-10-07 — escaped name security (no {@html})', () => {
	test('a name containing markup renders as LITERAL text and injects no element', async () => {
		const evil = '<img src=x onerror=alert(1)>';
		seed([row({ id: 'x', name: evil, updatedAt: 100 })]);
		const screen = render(CampaignsScreen);

		// The literal string is present as text…
		await expect.element(screen.getByText(evil)).toBeVisible();
		// …and NO actual <img> node was created from it.
		expect(document.querySelector('img[src="x"]')).toBeNull();
	});
});

describe('T-10-08 — type-to-confirm delete enablement', () => {
	test('arming delete disables Delete until the typed string equals the campaign name', async () => {
		seed([row({ id: 'd', name: 'Hold the Crossing', updatedAt: 100 })]);
		const screen = render(CampaignsScreen);

		// Arm the inline confirm.
		await screen.getByRole('button', { name: /Delete Hold the Crossing/ }).click();

		// The confirm field is shown and the destructive Delete is disabled at first.
		const confirmBtn = screen.getByRole('button', { name: /^Confirm delete Hold the Crossing/ });
		await expect.element(confirmBtn).toBeDisabled();

		// A non-matching string keeps it disabled + shows the muted mismatch hint.
		const field = screen.getByRole('textbox', { name: /Type the campaign name to confirm/ });
		await field.fill('Hold the');
		await expect.element(confirmBtn).toBeDisabled();
		await expect.element(screen.getByText(/Name doesn’t match/)).toBeVisible();

		// The EXACT name enables Delete.
		await field.fill('Hold the Crossing');
		await expect.element(confirmBtn).toBeEnabled();
	});
});

describe('CAMP-07 — active-row accent (single live row)', () => {
	test('exactly one row — the one whose id === game.campaignId — carries the active marker', async () => {
		seed(
			[
				row({ id: 'a', name: 'Alpha Op', updatedAt: 300 }),
				row({ id: 'b', name: 'Bravo Op', updatedAt: 200 }),
				row({ id: 'c', name: 'Charlie Op', updatedAt: 100 })
			],
			'b'
		);
		render(CampaignsScreen);

		// Let the async list resolve + render.
		await vi.waitFor(() => {
			expect(document.querySelectorAll('[data-campaign-name]').length).toBe(3);
		});

		const active = document.querySelectorAll('[aria-current="true"]');
		expect(active.length).toBe(1);
		// The active row is Bravo (id 'b' === campaignId).
		const activeName = active[0].querySelector('[data-campaign-name]')?.textContent?.trim();
		expect(activeName).toBe('Bravo Op');
	});
});

describe('CAMP-01/02/03/06 — dispatch wiring', () => {
	test('Resume calls switchCampaign(id)', async () => {
		const { switchSpy } = seed([row({ id: 'r1', name: 'Resume Me', updatedAt: 100 })]);
		const screen = render(CampaignsScreen);

		await screen.getByRole('button', { name: /Resume Resume Me/ }).click();
		expect(switchSpy).toHaveBeenCalledWith('r1');
	});

	test('Duplicate calls duplicate(id)', async () => {
		const { duplicateSpy } = seed([row({ id: 'dup', name: 'Fork Me', updatedAt: 100 })]);
		const screen = render(CampaignsScreen);

		await screen.getByRole('button', { name: /Duplicate Fork Me/ }).click();
		expect(duplicateSpy).toHaveBeenCalledWith('dup');
	});

	test('Save name (after an inline rename edit) calls rename(id, draft) with the edited value', async () => {
		const { renameSpy } = seed([row({ id: 'rn', name: 'Old Name', updatedAt: 100 })]);
		const screen = render(CampaignsScreen);

		// Enter inline rename.
		await screen.getByRole('button', { name: /Rename Old Name/ }).click();
		const field = screen.getByRole('textbox', { name: /Campaign name/ });
		await field.fill('New Name');
		await screen.getByRole('button', { name: /Save name/ }).click();

		expect(renameSpy).toHaveBeenCalledWith('rn', 'New Name');
	});

	test('New game calls openPicker()', async () => {
		const { openPickerSpy } = seed([]);
		const screen = render(CampaignsScreen);

		// The empty state renders New game in both the header and the hero — click the first.
		await screen.getByRole('button', { name: /New game/ }).first().click();
		expect(openPickerSpy).toHaveBeenCalled();
	});
});
