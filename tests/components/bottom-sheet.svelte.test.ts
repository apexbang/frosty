// bottom-sheet.svelte.test.ts — RED component contract for UX-03 (BottomSheet).
//
// Browser project. RED for cannot-find-module: src/lib/components/BottomSheet.svelte does
// not exist yet (Wave 2). Locks the NON-MODAL contract (D-02 / RESEARCH Pattern 2): a plain
// positioned <aside> (NOT a <dialog>, NOT role="dialog"), a labeled ✕ Close + a drag handle,
// Esc/Close fire onclose, and NO scrim/backdrop element — prose stays interactive behind.
// None weakened to pass RED.
//
// Harness: the locked shape (state-panel.svelte.test.ts) + createRawSnippet for the sheet's
// children (the sw-update-prompt.svelte.test.ts idiom). beforeEach seeds the game singleton
// so the sheet renders against a booted game even though it reads none of it directly.
//
// Run: npx vitest --project components run tests/components/bottom-sheet.svelte.test.ts

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';

// RED: the new component does not exist yet (Wave 2).
import { game } from '../../src/lib/game.svelte';
import BottomSheet from '../../src/lib/components/BottomSheet.svelte';
import { seedStarter } from '../../src/lib/seed';

beforeEach(() => {
	game.state = seedStarter();
	game.events = [];
});

// A simple body snippet so the sheet has content (and we can assert prose behind it).
const body = createRawSnippet(() => ({
	render: () => '<p>sheet content</p>'
}));

describe('UX-03 — BottomSheet is a non-modal sheet (prose readable behind)', () => {
	test('renders an <aside> labeled by its title — NOT a <dialog>, NOT role="dialog"', async () => {
		render(BottomSheet, { title: 'Unit state', onclose: () => {}, children: body });
		// aria-label on a complementary <aside>, never the modal-dialog role (UI-SPEC line 256).
		const aside = document.querySelector('aside[aria-label="Unit state"]');
		expect(aside).not.toBeNull();
		expect(aside!.tagName.toLowerCase()).toBe('aside');
		// No <dialog>, no role="dialog" — the non-modal contract.
		expect(document.querySelector('dialog')).toBeNull();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	test('has a labeled Close (✕) button and a drag handle', async () => {
		const screen = render(BottomSheet, { title: 'Orders', onclose: () => {}, children: body });
		await expect.element(screen.getByRole('button', { name: 'Close' })).toBeVisible();
		await expect.element(screen.getByLabelText(/drag to dismiss/i)).toBeVisible();
	});

	test('NO scrim/backdrop element is present (prose stays at full legibility behind)', async () => {
		render(BottomSheet, { title: 'Unit state', onclose: () => {}, children: body });
		// A scrim/backdrop that dims the narrative is a checker failure (UI-SPEC line 120).
		expect(document.querySelector('.scrim, .backdrop, [data-scrim]')).toBeNull();
	});

	test('clicking Close fires onclose', async () => {
		const onclose = vi.fn();
		const screen = render(BottomSheet, { title: 'Orders', onclose, children: body });
		await screen.getByRole('button', { name: 'Close' }).click();
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	test('renders the children content', async () => {
		const screen = render(BottomSheet, { title: 'Orders', onclose: () => {}, children: body });
		await expect.element(screen.getByText('sheet content')).toBeVisible();
	});
});
