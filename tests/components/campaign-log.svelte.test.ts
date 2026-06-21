// campaign-log.svelte.test.ts — RED component test for UI-06 (CampaignLog).
//
// Browser project (real chromium + real IndexedDB). RED until CampaignLog.svelte exists.
//
// Locks the UI-06 contract:
//   - renders state.narrativeLog as keyed turn-tagged escaped scrollback with `Turn {n}` markers,
//     the most-recent block emphasized.
//   - a narrativeLog entry with empty/absent text shows the `(no prose recorded for this turn)`
//     placeholder (pre-Phase-6 turns / Pitfall 5) — never a crash.
//   - an empty narrativeLog shows the empty-state copy (`No engagement yet`).
//   - injected markup renders as literal text (ESCAPED — T-06D-01).

import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { game } from '../../src/lib/game.svelte';
import CampaignLog from '../../src/lib/components/CampaignLog.svelte';
import { seedStarter } from '../../src/lib/seed';
import type { GameState } from '../../src/lib/engine/state';

/** A seeded state with the given narrativeLog entries injected. */
function stateWithLog(log: { turn: number; text: string }[]): GameState {
	const s = seedStarter();
	s.narrativeLog = log;
	return s;
}

beforeEach(() => {
	game.machine = 'idle';
	game.state = seedStarter();
});

describe('UI-06 — CampaignLog renders state.narrativeLog as after-action scrollback', () => {
	test('shows the empty-state copy when the narrativeLog is empty', async () => {
		game.state = stateWithLog([]);
		const screen = render(CampaignLog);
		await expect.element(screen.getByText(/No engagement yet/)).toBeVisible();
	});

	test('renders each entry as a keyed turn-tagged block with a Turn marker + escaped prose', async () => {
		game.state = stateWithLog([
			{ turn: 3, text: 'recon spots movement at the tree line.' },
			{ turn: 4, text: '1st squad pushes off the line of departure.' }
		]);
		const screen = render(CampaignLog);
		await expect.element(screen.getByText(/Turn 3/)).toBeVisible();
		await expect.element(screen.getByText(/Turn 4/)).toBeVisible();
		await expect.element(screen.getByText(/recon spots movement/)).toBeVisible();
		await expect.element(screen.getByText(/1st squad pushes off/)).toBeVisible();
	});

	test('shows the placeholder for a prose-less / pre-Phase-6 turn', async () => {
		game.state = stateWithLog([{ turn: 2, text: '' }]);
		const screen = render(CampaignLog);
		await expect.element(screen.getByText(/no prose recorded for this turn/)).toBeVisible();
	});

	test('renders AI prose as ESCAPED text — never as HTML (XSS contract)', async () => {
		game.state = stateWithLog([{ turn: 4, text: '<img src=x onerror="alert(1)">pwn' }]);
		const screen = render(CampaignLog);
		await expect.element(screen.getByText(/<img src=x onerror=/)).toBeVisible();
		expect(document.querySelector('img')).toBeNull();
	});
});
