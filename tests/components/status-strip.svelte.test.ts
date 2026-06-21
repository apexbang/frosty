// status-strip.svelte.test.ts — RED component contract for UX-01/UX-02 (StatusStrip).
//
// Runs in the `components` browser project (vitest-browser-svelte + @vitest/browser,
// chromium). RED for cannot-find-module: src/lib/components/StatusStrip.svelte does not
// exist yet (Wave 1). The assertion bodies are the LOCKED acceptance the later wave drives
// to green (UI-SPEC State→Visual Mapping; RESEARCH Pattern 6 — the strip is a read-only
// $derived projection of game.state + game.remaining, holding NO independent number).
// None is weakened to pass RED.
//
// Harness: the locked shape (state-panel.svelte.test.ts) — vitest-browser-svelte render,
// the game singleton, seedStarter(), beforeEach seeding game.state + game.events = [].
//
// Run: npx vitest --project components run tests/components/status-strip.svelte.test.ts

import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

// RED: the new component does not exist yet (Wave 1).
import { game } from '../../src/lib/game.svelte';
import StatusStrip from '../../src/lib/components/StatusStrip.svelte';
import { seedStarter } from '../../src/lib/seed';

beforeEach(() => {
	game.state = seedStarter();
	game.events = [];
});

describe('UX-02 — StatusStrip is a read-only per-side glance summary', () => {
	test('renders both sides', async () => {
		const screen = render(StatusStrip);
		await expect.element(screen.getByText('BLUE')).toBeVisible();
		await expect.element(screen.getByText('RED')).toBeVisible();
	});

	test("each side's units render with an accessible strength label (visually-hidden % text)", async () => {
		// Pin a known band so the label is deterministic (banded {0,25,50,75,100}).
		game.state!.sides[0].units[0].strength = 75; // 1-1
		game.state!.sides[1].units[0].strength = 25; // DEF
		const screen = render(StatusStrip);
		await expect.element(screen.getByText('1-1')).toBeVisible();
		await expect.element(screen.getByText('DEF')).toBeVisible();
		// The pips carry an accessible "strength {n}%" label (getByLabelText), not just color.
		await expect.element(screen.getByLabelText(/strength 75%/)).toBeVisible();
		await expect.element(screen.getByLabelText(/strength 25%/)).toBeVisible();
	});

	test('renders ONE key consumable per side, tabular ({item} {qty})', async () => {
		const screen = render(StatusStrip);
		// BLUE's most-depleted consumable is frag. With events=[] the live stream is empty, so
		// remaining('frag') = loadout 6 − the baked turn-2 expend 2 = 4 (the strip displays
		// game.remaining, UI-SPEC line 136/239 `{item} {qty}`). seedStarter only bakes the turn-2
		// frag expend; the §5.4 turn-4 expend that takes frag to 2 is applied by RUNNING the turn,
		// not by the bare seed — so the pre-turn glance is `frag 4`.
		await expect.element(screen.getByText(/frag\s*4/)).toBeVisible();
		// RED carries rpg (loadout 8, no expend) — the side's one key consumable.
		await expect.element(screen.getByText(/rpg\s*8/)).toBeVisible();
	});

	test('a key consumable at qty 0 carries the destructive class (authority made visible)', async () => {
		// Drive BLUE frag to 0 via a logged expend (consumables only ever DECREASE via expend).
		// remaining('frag') = loadout 6 − baked turn-2 expend 2 − this live turn-4 expend 4 = 0,
		// so the strip renders `frag 0` with the destructive `.zero` class.
		game.events = [
			{ kind: 'expend', turn: 4, item: 'frag', qty: 4, actor: '1-1', side: 'BLUE' }
		] as never;
		const screen = render(StatusStrip);
		const zero = screen.getByText(/frag\s*0/);
		await expect.element(zero).toBeVisible();
		await expect.element(zero).toHaveClass(/zero|destructive/);
	});

	test('the strip is a single button that opens the full unit state', async () => {
		const screen = render(StatusStrip);
		// ONE tappable surface — the whole strip is the affordance to drill into StatePanel.
		await expect
			.element(screen.getByRole('button', { name: /open full unit state/i }))
			.toBeVisible();
	});
});

describe('OBJ-02 — StatusStrip pins the player side current objective', () => {
	test("pins the player side's objectives[0], escaped, in the strip", async () => {
		// seedStarter's BLUE side (commander === 'player') carries objectives[0] = 'seize objective ALPHA'.
		const player = game.state!.sides.find((s) => s.commander === 'player')!;
		player.objectives = ['seize objective ALPHA'];
		const screen = render(StatusStrip);
		// The pinned objective text is the accessible content (escaped {…}, never {@html}).
		await expect.element(screen.getByText('seize objective ALPHA')).toBeVisible();
	});

	test('renders NO pinned line when the player side has an empty objectives array', async () => {
		const player = game.state!.sides.find((s) => s.commander === 'player')!;
		player.objectives = [];
		const screen = render(StatusStrip);
		// No placeholder cramping — the element is absent (test marker text never appears).
		await expect.element(screen.getByText('seize objective ALPHA')).not.toBeInTheDocument();
		// The pinned-line container is absent entirely.
		expect(screen.container.querySelector('.pinned-objective')).toBeNull();
	});

	test('pins ONLY objectives[0] when the player side has multiple objectives', async () => {
		const player = game.state!.sides.find((s) => s.commander === 'player')!;
		player.objectives = ['seize objective ALPHA', 'then exfil to extraction'];
		const screen = render(StatusStrip);
		await expect.element(screen.getByText('seize objective ALPHA')).toBeVisible();
		// The second objective is NOT pinned (only the first).
		await expect
			.element(screen.getByText('then exfil to extraction'))
			.not.toBeInTheDocument();
	});

	test('renders no pinned line when there is no player-commanded side', async () => {
		// Flip both sides to AI — no commander === 'player' side exists.
		for (const s of game.state!.sides) s.commander = 'ai';
		game.state!.sides[0].objectives = ['seize objective ALPHA'];
		const screen = render(StatusStrip);
		expect(screen.container.querySelector('.pinned-objective')).toBeNull();
	});

	test('the leading marker is decorative (aria-hidden); the objective text is the accessible content', async () => {
		const player = game.state!.sides.find((s) => s.commander === 'player')!;
		player.objectives = ['seize objective ALPHA'];
		const screen = render(StatusStrip);
		const marker = screen.container.querySelector('.pinned-objective .marker');
		expect(marker).not.toBeNull();
		expect(marker!.getAttribute('aria-hidden')).toBe('true');
	});
});
