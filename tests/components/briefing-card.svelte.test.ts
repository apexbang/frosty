// briefing-card.svelte.test.ts — component contract for OBJ-01/OBJ-03 (BriefingCard).
//
// Runs in the `components` browser project (vitest-browser-svelte + @vitest/browser, chromium,
// headless). Harness mirrors the locked shape (campaign-log/status-strip): the game singleton,
// seedStarter(), and a beforeEach seeding game.state — then briefing/objectives are injected
// directly onto the seeded state (the Phase-5 component-test convention).
//
// Locks the BriefingCard contract (UI-SPEC State→Visual Mapping; 13-PLAN <behavior>):
//   - full briefing → SITUATION/OBJECTIVES/VICTORY/DEFEAT/HINTS sections render with the escaped
//     prose, the objectives list shows each Side.objectives[] item.
//   - hints absent/empty → no HINTS block.
//   - briefing absent but player objectives present → objectives + the muted fallback line.
//   - briefing absent AND no objectives → renders nothing (suppressed).
//   - a missing situation/victory/defeat string within a present briefing → muted "—".
//   - AI prose renders ESCAPED, never as HTML (T-13-05 XSS contract).
//
// Run: npx vitest --project components run tests/components/briefing-card.svelte.test.ts

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { game } from '../../src/lib/game.svelte';
import BriefingCard from '../../src/lib/components/BriefingCard.svelte';
import { seedStarter } from '../../src/lib/seed';
import type { GameState } from '../../src/lib/engine/state';

type Briefing = NonNullable<GameState['briefing']>;

/** Seed a turn-0 state, then inject the given briefing (or remove it) + player objectives. */
function seedWith(opts: {
	briefing?: Briefing | undefined;
	playerObjectives?: string[];
}): GameState {
	const s = seedStarter();
	s.meta.turn = 0;
	if ('briefing' in opts) s.briefing = opts.briefing;
	if (opts.playerObjectives) {
		const player = s.sides.find((side) => side.commander === 'player');
		if (player) player.objectives = opts.playerObjectives;
	}
	return s;
}

const FULL: Briefing = {
	situation: 'Before dawn your platoon presses into the outskirts.',
	victory: 'You seize ALPHA and break the garrison.',
	defeat: 'Your assault stalls in the open under their guns.',
	hints: ['Screen the open approach with smoke.', 'Suppress before you commit.']
};

beforeEach(() => {
	game.machine = 'idle';
	game.state = seedStarter();
});

describe('OBJ-01 — BriefingCard renders the mission briefing as escaped labeled prose', () => {
	test('full briefing renders all five sections with escaped prose + each objective', async () => {
		game.state = seedWith({ briefing: FULL, playerObjectives: ['seize objective ALPHA'] });
		const screen = render(BriefingCard, { onclose: () => {} });

		await expect.element(screen.getByText('SITUATION')).toBeVisible();
		await expect.element(screen.getByText('OBJECTIVES')).toBeVisible();
		await expect.element(screen.getByText('VICTORY')).toBeVisible();
		await expect.element(screen.getByText('DEFEAT')).toBeVisible();
		await expect.element(screen.getByText('HINTS')).toBeVisible();

		await expect.element(screen.getByText(/Before dawn your platoon/)).toBeVisible();
		await expect.element(screen.getByText(/seize ALPHA and break the garrison/)).toBeVisible();
		await expect.element(screen.getByText(/assault stalls in the open/)).toBeVisible();
		await expect.element(screen.getByText('seize objective ALPHA')).toBeVisible();
		await expect.element(screen.getByText(/Screen the open approach/)).toBeVisible();
	});

	test('hints absent → no HINTS block rendered', async () => {
		const noHints: Briefing = { ...FULL, hints: undefined };
		game.state = seedWith({ briefing: noHints, playerObjectives: ['seize objective ALPHA'] });
		const screen = render(BriefingCard, { onclose: () => {} });

		await expect.element(screen.getByText('SITUATION')).toBeVisible();
		expect(screen.container.textContent).not.toContain('HINTS');
	});

	test('empty hints array → no HINTS block rendered', async () => {
		const emptyHints: Briefing = { ...FULL, hints: [] };
		game.state = seedWith({ briefing: emptyHints, playerObjectives: ['seize objective ALPHA'] });
		const screen = render(BriefingCard, { onclose: () => {} });

		await expect.element(screen.getByText('SITUATION')).toBeVisible();
		expect(screen.container.textContent).not.toContain('HINTS');
	});

	test('briefing absent but player objectives present → objectives + muted fallback line', async () => {
		game.state = seedWith({ briefing: undefined, playerObjectives: ['seize objective ALPHA'] });
		const screen = render(BriefingCard, { onclose: () => {} });

		await expect.element(screen.getByText('OBJECTIVES')).toBeVisible();
		await expect.element(screen.getByText('seize objective ALPHA')).toBeVisible();
		await expect
			.element(screen.getByText(/No briefing provided for this scenario\./))
			.toBeVisible();
		// No SITUATION/VICTORY/DEFEAT labeled blocks in the fallback shape.
		expect(screen.container.textContent).not.toContain('SITUATION');
		expect(screen.container.textContent).not.toContain('VICTORY');
	});

	test('briefing absent AND no objectives → renders nothing (suppressed)', async () => {
		game.state = seedWith({ briefing: undefined, playerObjectives: [] });
		const screen = render(BriefingCard, { onclose: () => {} });

		// Suppressed: no card section, no labels at all.
		expect(screen.container.querySelector('.briefing-card')).toBeNull();
		expect(screen.container.textContent).not.toContain('Mission briefing');
	});

	test('a missing situation/victory/defeat string renders the muted "—" placeholder, never a crash', async () => {
		const partial = {
			situation: '',
			victory: '',
			defeat: '',
			hints: []
		} as unknown as Briefing;
		game.state = seedWith({ briefing: partial, playerObjectives: ['seize objective ALPHA'] });
		const screen = render(BriefingCard, { onclose: () => {} });

		await expect.element(screen.getByText('SITUATION')).toBeVisible();
		await expect.element(screen.getByText('VICTORY')).toBeVisible();
		await expect.element(screen.getByText('DEFEAT')).toBeVisible();
		// Three muted "—" placeholders, one per missing section.
		const dashes = Array.from(screen.container.querySelectorAll('.prose.missing')).filter(
			(el) => el.textContent?.trim() === '—'
		);
		expect(dashes.length).toBe(3);
	});

	test('AI prose renders as ESCAPED text — never as HTML (T-13-05 XSS contract)', async () => {
		const xss: Briefing = {
			situation: '<img src=x onerror="alert(1)">pwn',
			victory: 'win',
			defeat: 'lose'
		};
		game.state = seedWith({ briefing: xss, playerObjectives: ['<b>objective</b>'] });
		const screen = render(BriefingCard, { onclose: () => {} });

		await expect.element(screen.getByText(/<img src=x onerror=/)).toBeVisible();
		await expect.element(screen.getByText('<b>objective</b>')).toBeVisible();
		expect(screen.container.querySelector('img')).toBeNull();
		expect(screen.container.querySelector('.briefing-card b')).toBeNull();
	});

	test('the Close ✕ and Dismiss controls both fire onclose', async () => {
		game.state = seedWith({ briefing: FULL, playerObjectives: ['seize objective ALPHA'] });
		const onclose = vi.fn();
		const screen = render(BriefingCard, { onclose });

		await screen.getByRole('button', { name: /close briefing/i }).click();
		await screen.getByRole('button', { name: /dismiss briefing/i }).click();
		expect(onclose).toHaveBeenCalledTimes(2);
	});
});
