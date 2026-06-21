// confirm-gate-soft-lock.svelte.test.ts — (ORDER-02, ORDER-03, FOG-03) RED-first at the REAL bridge.
//
// The reported bug: a resolved MoveEnvelope with NO materiel (a recon / hold / observe
// turn — every action `expend: []` with no `proposedOutcome.casualties`) makes
// confirmDiff() return an empty `[]`. But #awaitConfirm still flips machine='confirming'
// whenever confirmEnabled is true (the default — CONFIRM_DEFAULT_ON). The DiceConfirmPanel
// only renders "Confirm & resolve" when confirmRows.length > 0, and the footer only shows
// "Cancel turn" for composing/awaitingPaste — so an empty-rows turn has NO control and the
// state machine WEDGES at 'confirming'. This strands exactly the FOG turns Phase 6 added.
//
// Test 1 (the bug — RED before the fix): a no-materiel turn must auto-proceed to 'idle'
// WITHOUT any confirm() click, even with confirmEnabled === true. Before the fix this hangs
// at 'confirming' and awaitMachine('idle') throws.
//
// Test 2 (the gate must stay intact — GREEN before AND after): a materiel turn (the §5.4
// envelope, which carries both expends and casualties) still PARKS at 'confirming' with
// non-empty confirmRows and awaits an explicit confirm(). This locks the gate against
// over-broad weakening.
//
// Components/browser project: REAL chromium + REAL IndexedDB. Every test that boots MUST
// clear the 'frosty' DB in beforeEach (the singleton's IdbSaveStore is shared).

import { describe, test, expect, beforeEach } from 'vitest';

import { game } from '../../src/lib/game.svelte';
import { EXAMPLE_ENVELOPE_5_4 } from '../../src/lib/engine/examples';
import type { MoveEnvelope } from '../../src/lib/engine/envelope';

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

/**
 * A NO-MATERIEL envelope: one observe/hold playerAction with `expend: []`,
 * `proposedModifiers: []`, and a `proposedOutcome` that carries ONLY a `note` (NO
 * `casualties` key). With no positive-qty expend and no casualties, confirmDiff() returns
 * `[]` — the empty-rows case that wedges the confirm gate today.
 */
const NO_MATERIEL_ENVELOPE: MoveEnvelope = {
	narrative: '1st squad holds the line and watches the treeline. Nothing moves.',
	playerActions: [
		{
			actor: '1-1',
			side: 'BLUE',
			actionType: 'observe',
			target: 'treeline',
			capabilitiesUsed: ['optics'],
			expend: [],
			proposedModifiers: [],
			proposedOutcome: { note: 'holds position, observes; no contact' }
		}
	],
	enemyActions: [],
	reveals: []
};

beforeEach(async () => {
	await clearDb();
	game.log = [];
	game.machine = 'idle';
	game.confirmRows = [];
	installRoller();
});

describe('confirm gate — empty rows must not soft-lock; materiel turns must still gate', () => {
	test('Test 1 — a no-materiel turn auto-proceeds to idle (no confirm control needed)', async () => {
		await game.boot();
		game.startTurn('1st squad holds and observes the treeline.');
		await awaitMachine('awaitingPaste');

		game.submitPaste(JSON.stringify(NO_MATERIEL_ENVELOPE));

		// The whole point: NO confirm() call. With confirmEnabled === true (the default),
		// an empty-rows turn must still reach 'idle' on its own. Before the fix this throws
		// because the machine never leaves 'confirming'.
		await awaitMachine('idle');

		expect(game.machine).toBe('idle');
		expect(game.confirmRows).toHaveLength(0);
	});

	test('Test 2 — a materiel turn still parks at confirming and awaits an explicit confirm()', async () => {
		await game.boot();
		game.startTurn('1st squad assaults the compound, two frags.');
		await awaitMachine('awaitingPaste');

		game.submitPaste(JSON.stringify(EXAMPLE_ENVELOPE_5_4));
		await awaitMachine('confirming');

		// The gate is reached: rows surfaced, machine parked — NOT auto-proceeded.
		expect(game.confirmRows.length).toBeGreaterThan(0);
		expect(game.machine).toBe('confirming');

		game.confirm();
		await awaitMachine('idle');

		expect(game.machine).toBe('idle');
		expect(game.confirmRows).toHaveLength(0);
	});
});
