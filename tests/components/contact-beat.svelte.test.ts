// contact-beat.svelte.test.ts — RED component test for FOG-03 (ContactBeat).
//
// Browser project (real chromium + real IndexedDB). RED until the bridge exposes a
// $derived contact signal over THIS turn's reveal events AND ContactBeat.svelte exists.
//
// Locks the FOG-03 contract:
//   - the bridge's $derived contact signal is truthy ONLY after a reveal-producing turn
//     (count = number of reveals); falsy after a no-reveal turn. NEVER a stored $state.
//   - ContactBeat renders the `CONTACT` headline + the first reveal's `resolvesTo` sub-line
//     as ESCAPED text; multiple reveals render `CONTACT ×N`.
//   - Acknowledge hides the beat.
//   - No raw-HTML render directive anywhere (escaped text only — T-06D-01).

import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { game } from '../../src/lib/game.svelte';
import ContactBeat from '../../src/lib/components/ContactBeat.svelte';
import type { GameEvent } from '../../src/lib/engine/events';

/** Clear the real IndexedDB so no campaign rows leak between tests. */
function clearDb(): Promise<void> {
	return new Promise<void>((res) => {
		const r = indexedDB.deleteDatabase('frosty');
		r.onsuccess = r.onerror = r.onblocked = () => res(undefined);
	});
}

/** A reveal GameEvent for the given report/resolvesTo (the FOG-03 data contract). */
function reveal(report: string, resolvesTo: string, turn = 4): GameEvent {
	return { kind: 'reveal', report, resolvesTo, confirmedBy: '1-1', turn };
}

beforeEach(async () => {
	await clearDb();
	game.events = [];
	game.machine = 'idle';
});

describe('FOG-03 — the bridge $derived contact signal tracks this turn’s reveals', () => {
	test('truthy with the reveal count after a reveal-producing turn', () => {
		game.events = [reveal('report-A', 'enemy MG nest, east ridge')];
		expect(game.contactBeat.count).toBe(1);
		expect(game.contactBeat.first).toBe('enemy MG nest, east ridge');

		game.events = [reveal('report-A', 'enemy MG nest'), reveal('report-B', 'sniper, north tower')];
		expect(game.contactBeat.count).toBe(2);
		// The first reveal's sub-line is surfaced; the full list lives in the CampaignLog.
		expect(game.contactBeat.first).toBe('enemy MG nest');
	});

	test('falsy after a turn with no reveal events', () => {
		game.events = [{ kind: 'narrative', text: 'quiet turn', turn: 4 }];
		expect(game.contactBeat.count).toBe(0);
		expect(game.contactBeat.first).toBeNull();
	});
});

describe('FOG-03 — ContactBeat banner', () => {
	test('renders CONTACT + the escaped resolvesTo sub-line on a single reveal', async () => {
		game.events = [reveal('report-A', 'enemy MG nest, east ridge')];
		const screen = render(ContactBeat);
		await expect.element(screen.getByText(/CONTACT/)).toBeVisible();
		await expect.element(screen.getByText(/enemy MG nest, east ridge/)).toBeVisible();
	});

	test('renders CONTACT ×N for multiple reveals in one turn', async () => {
		game.events = [reveal('report-A', 'enemy MG nest'), reveal('report-B', 'sniper, north tower')];
		const screen = render(ContactBeat);
		await expect.element(screen.getByText(/CONTACT ×2/)).toBeVisible();
	});

	test('renders the reveal sub-line as ESCAPED text — never as HTML (XSS contract)', async () => {
		game.events = [reveal('report-A', '<img src=x onerror="alert(1)">pwn')];
		const screen = render(ContactBeat);
		await expect.element(screen.getByText(/<img src=x onerror=/)).toBeVisible();
		expect(document.querySelector('img')).toBeNull();
	});

	test('Acknowledge hides the beat', async () => {
		game.events = [reveal('report-A', 'enemy MG nest, east ridge')];
		const screen = render(ContactBeat);
		await expect.element(screen.getByText(/CONTACT/)).toBeVisible();
		await screen.getByRole('button', { name: /Acknowledge/ }).click();
		await expect.element(screen.getByText(/CONTACT/)).not.toBeInTheDocument();
	});

	test('renders nothing when this turn produced no reveals', async () => {
		game.events = [{ kind: 'narrative', text: 'quiet turn', turn: 4 }];
		const screen = render(ContactBeat);
		await expect.element(screen.getByText(/CONTACT/)).not.toBeInTheDocument();
	});
});
