// empty-state-collapse.svelte.test.ts — RED component contract for UX-06 (empty collapse).
//
// Browser project. RED: the inverted mobile shell that conditionally renders the banner zone
// and presents the confirm beat as the ONE <dialog> (D-04/D-05) does not exist yet (Waves 1–3).
// Locks (RESEARCH Pattern 7): at turn-0 rest there is NO "No resolution yet" placeholder and
// NO banner box (empty panels reserve ZERO height — {#if}, not a height-0 element), and the
// confirm <dialog> exists ONLY when machine === 'confirming'. None weakened to pass RED.
//
// Harness: the locked shape (state-panel.svelte.test.ts) — render the page-level shell, the
// game singleton, seedStarter(), beforeEach seeding game.state + game.events = []. game.machine
// is mutated per-test (machine is a $state field).
//
// Run: npx vitest --project components run tests/components/empty-state-collapse.svelte.test.ts

import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { game } from '../../src/lib/game.svelte';
// RED: the collapse-aware mobile shell does not exist yet (Waves 1–3).
import Page from '../../src/routes/+page.svelte';
import { seedStarter } from '../../src/lib/seed';

beforeEach(() => {
	game.state = seedStarter();
	game.events = [];
	game.machine = 'idle';
	game.lastResolution = null;
});

describe('UX-06 — empty-state panels collapse; confirm is the one modal', () => {
	test('at turn-0 rest there is NO "No resolution yet" placeholder block', async () => {
		render(Page);
		// The empty RESOLUTION placeholder must not occupy layout height on mobile rest.
		expect(document.body.textContent ?? '').not.toMatch(/No resolution yet/);
	});

	test('at turn-0 rest there is NO banner box reserved (zero height when empty)', async () => {
		render(Page);
		// The banner zone is absent entirely when nothing is staged (conditional render).
		expect(document.querySelector('.banner-zone')).toBeNull();
	});

	test('the confirm <dialog> is absent when not confirming', async () => {
		game.machine = 'idle';
		render(Page);
		expect(document.querySelector('dialog')).toBeNull();
	});

	test('the confirm <dialog> is present ONLY when machine === "confirming"', async () => {
		game.machine = 'confirming';
		render(Page);
		const dlg = document.querySelector('dialog');
		expect(dlg).not.toBeNull();
	});
});
