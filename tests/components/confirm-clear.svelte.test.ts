// confirm-clear.svelte.test.ts — A (UI-04, ORDER-02) RED-first at the REAL bridge.
//
// A real turn that resolves through the bridge must CLEAR its confirm controls:
// #applyResult sets machine='idle' but (before this fix) never cleared
// game.confirmRows, so the DiceConfirmPanel Confirm/Adjust/Cancel block persisted
// as dead buttons. Clicking Confirm again flipped machine to 'resolving' on a null
// resolver and wedged the turn.
//
// This drives the WHOLE bridge: boot → startTurn → submitPaste(§5.4 JSON) →
// confirm, then asserts (1) confirmRows empty, (2) machine idle (not wedged),
// (3) the panel block is gone, and (4) a SECOND confirm() is a harmless no-op.
// RED until #applyResult clears confirmRows + confirm() guards the dead second
// click + the panel gates on machine==='confirming'.
//
// Components/browser project: REAL chromium + REAL IndexedDB. Every test that boots
// MUST clear the 'frosty' DB in beforeEach (the singleton's IdbSaveStore is shared).

import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { game } from '../../src/lib/game.svelte';
import DiceConfirmPanel from '../../src/lib/components/DiceConfirmPanel.svelte';
import { EXAMPLE_ENVELOPE_5_4 } from '../../src/lib/engine/examples';

/** Clear the real IndexedDB so no campaign rows leak between tests. */
function clearDb(): Promise<void> {
	return new Promise<void>((res) => {
		const r = indexedDB.deleteDatabase('frosty');
		r.onsuccess = r.onerror = r.onblocked = () => res(undefined);
	});
}

/** Install the deterministic roller seam (mirrors the §5.4 e2e: pin [3,4], derive net/band). */
function installRoller(): void {
	(window as unknown as { __frostyRoller: unknown }).__frostyRoller = (
		actor: string,
		modifiers: { label: string; value: number }[],
		turn: number
	) => {
		const roll: [number, number] = [3, 4];
		const sum = modifiers.reduce((s, m) => s + m.value, 0);
		const net = Math.max(-3, Math.min(3, sum));
		const total = roll[0] + roll[1] + net;
		const band =
			total >= 10 ? 'success_clean' : total >= 7 ? 'success_costly' : total >= 5 ? 'stalled' : 'failure';
		return { kind: 'dice', actor, roll, modifiers, net, band, turn };
	};
}

/** Poll until `game.machine` reaches `target` (the bridge transitions across microtasks). */
async function awaitMachine(target: string): Promise<void> {
	for (let i = 0; i < 200; i++) {
		if (game.machine === target) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error(`machine never reached ${target} (stuck at ${game.machine})`);
}

beforeEach(async () => {
	await clearDb();
	game.log = [];
	game.machine = 'idle';
	game.confirmRows = [];
	installRoller();
});

describe('A — confirm controls clear after a real turn resolves through the bridge', () => {
	test('confirmRows empty, machine idle, panel block gone, second confirm() a no-op', async () => {
		await game.boot();
		game.startTurn('1st squad assaults the compound, two frags.');
		await awaitMachine('awaitingPaste');

		game.submitPaste(JSON.stringify(EXAMPLE_ENVELOPE_5_4));
		await awaitMachine('confirming');

		// The gate is reached: rows are surfaced and the panel renders its controls.
		expect(game.confirmRows.length).toBeGreaterThan(0);

		game.confirm();
		await awaitMachine('idle');

		// (1) rows cleared on resolution, (2) machine idle (NOT wedged at 'resolving').
		expect(game.confirmRows).toHaveLength(0);
		expect(game.machine).toBe('idle');

		// (3) the confirm block is no longer rendered (no dead Confirm button).
		const screen = render(DiceConfirmPanel);
		expect(screen.getByRole('button', { name: /Confirm & resolve/ }).query()).toBeNull();

		// (4) a SECOND confirm() after resolution is a harmless no-op — the resolver is
		// already null, so the machine must NOT flip to 'resolving' and strand the turn.
		game.confirm();
		await new Promise((r) => setTimeout(r, 20));
		expect(game.machine).toBe('idle');
	});
});
