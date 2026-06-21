// turn-cycle.spec.ts — the RED §5.4 end-to-end acceptance (the phase gate).
//
// Drives the full M1 spine against the real page (Wave 3): seed → Start turn → paste
// EXAMPLE_ENVELOPE_5_4 → Confirm & resolve → assert the §5.4 numbers → reload → assert
// they PERSIST (autosave round-trip, SAVE-03 / the A4 reload-reconstruction decision).
//
// RED until the UI exists: it fails on a missing selector / navigation, NEVER on a
// config error. No assertion is weakened to pass RED.
//
// Determinism seam (installed FIRST, before goto): window.__frostyRoller mirrors the
// dice.ts roller signature `(actor, modifiers, turn)` and the dice GameEvent shape
// `{ kind:'dice', actor, roll, modifiers, net, band, turn }`. It pins ONLY roll=[3,4]
// and DERIVES net (sum + ±3 clamp) and band (from roll-sum + net, dice.ts thresholds) —
// never hardcoding net/band. game.svelte.ts.startTurn (Plan 02) reads this global and
// threads it into runTurn as deps.roller; in production the global is absent so the real
// Web Crypto roll is used — this seam ONLY affects the test.
//
// PURITY: serializes the ENGINE-side EXAMPLE_ENVELOPE_5_4 (src/lib/engine/examples.ts);
// never imports tests/.

import { test, expect } from '@playwright/test';
import { EXAMPLE_ENVELOPE_5_4 } from '../../src/lib/engine/examples';

const ENVELOPE_JSON = JSON.stringify(EXAMPLE_ENVELOPE_5_4);

test.beforeEach(async ({ page }) => {
	// Install the deterministic roller BEFORE the app boots. Inline clampNet/band
	// (matching dice.ts exactly) so net/band are DERIVED, not hardcoded constants.
	await page.addInitScript(() => {
		(window as unknown as { __frostyRoller: unknown }).__frostyRoller = (
			actor: string,
			modifiers: { label: string; value: number }[],
			turn: number
		) => {
			const roll: [number, number] = [3, 4];
			// clampNet: sum the modifier values, clamp net to [-3, +3] (dice.ts).
			const sum = modifiers.reduce((s, m) => s + m.value, 0);
			const net = Math.max(-3, Math.min(3, sum));
			// band: read from total = roll-sum + net (dice.ts thresholds), computed LAST.
			const total = roll[0] + roll[1] + net;
			const band =
				total >= 10 ? 'success_clean' : total >= 7 ? 'success_costly' : total >= 5 ? 'stalled' : 'failure';
			return { kind: 'dice', actor, roll, modifiers, net, band, turn };
		};
	});
});

// PHASE 8 (LOAD-05): boot now mounts the CLEAN turn-0 starterScenario() through the unified
// loadGameState path — NOT the old §5.4 turn-3 seed. The §5.4 worked-example ARITHMETIC contract
// (frag→2, the turn-3/turn-4 numbering, the consolidation meta.phase that the engagement-phase
// board produced) now lives in the ENGINE canary (tests/engine/fixtures/canary-5.4-persisted.ts +
// load.test.ts, 08-01) — that is where the §5.4 fold-through-loadGameState is proven green.
//
// This e2e proves LOAD-01 END-TO-END: the §5.4 ENVELOPE driven through the real UI over the
// unified boot path resolves the SAME categorical RESOLUTION (1-1→75, DEF→25/broken,
// success_costly, roll [3,4], net +1, the 60mm-support / prepared-cover modifiers) and PERSISTS
// across a reload. Only the starter-relative numbers differ: it is now Turn 1 (clean turn-0 board
// + one resolved turn) and frag→4 (full loadout 6 − the turn's 2-frag expend; no baked turn-2
// quirk on the clean starter), with smoke→4 still the immovable canary.
test('§5.4 envelope round-trip resolves and persists across reload (unified clean-starter boot)', async ({ page }) => {
	await page.goto('/');

	// Boot mounts the CLEAN turn-0 starter (BLUE {1-1, MTR} vs RED {DEF}).
	await expect(page.getByText(/Turn 0/)).toBeVisible();

	// 1. Start the turn (compose).
	await page.getByRole('button', { name: 'Start turn' }).click();

	// 2. Paste the AI's JSON reply (the §5.4 envelope) into the paste box.
	const pasteBox = page.getByLabel("Paste the AI's JSON reply");
	await pasteBox.fill(ENVELOPE_JSON);
	await pasteBox.blur();

	// 3. Confirm & resolve (the inline confirm gate, on by default).
	await page.getByRole('button', { name: 'Confirm & resolve' }).click();

	// 4. The State Panel shows the §5.4 categorical RESOLUTION (identical on the clean board).
	await expect(page.getByLabel(/strength 75%/)).toBeVisible(); // 1-1 → 75
	await expect(page.getByLabel(/strength 25%/)).toBeVisible(); // DEF → 25
	await expect(page.getByText(/broken/)).toBeVisible(); // DEF morale broken
	await expect(page.getByText(/frag:\s*4/)).toBeVisible(); // 6 − 2 = 4 (clean loadout, no baked turn-2)
	await expect(page.getByText(/smoke:\s*4/)).toBeVisible(); // canary unchanged

	// 5. The persistent Dice/Confirm strip shows its work — the §5.4 dice exactly. Scope to
	//    the DiceConfirmPanel's "Last resolution" region: the transient ResolutionBanner
	//    (UI-05) now also surfaces success_costly/roll/net above the panels, so a page-wide
	//    getByText would be ambiguous — the golden asserts the PERSISTENT home specifically.
	const lastResolution = page.getByLabel('Last resolution');
	await expect(lastResolution.getByText('60mm support')).toBeVisible();
	await expect(lastResolution.getByText('enemy in prepared cover')).toBeVisible(); // the ACTUAL envelope label
	await expect(lastResolution.getByText(/success_costly/)).toBeVisible();
	await expect(lastResolution.getByText(/3\s*4/)).toBeVisible(); // roll [3,4]
	await expect(lastResolution.getByText(/net.*\+?1/)).toBeVisible(); // net +1

	// 6. Reload — autosave round-trip THROUGH THE UNIFIED PATH: the same numbers persist
	//    (SAVE-03 / A4 decision; LOAD-01 — the resumed save folds through loadGameState).
	await page.reload();
	await expect(page.getByLabel(/strength 75%/)).toBeVisible();
	await expect(page.getByLabel(/strength 25%/)).toBeVisible();
	await expect(page.getByText(/frag:\s*4/)).toBeVisible(); // frag: 4 SURVIVES reload
	await expect(page.getByText(/smoke:\s*4/)).toBeVisible();
});
