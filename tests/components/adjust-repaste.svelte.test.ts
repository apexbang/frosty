// adjust-repaste.svelte.test.ts — CR-02 RED-first at the REAL bridge level (Design A).
//
// Phase 5 never asserted machine state after adjust() or a subsequent submitPaste, so
// the adjust → re-paste regression was invisible. This drives a good paste to the confirm
// gate, calls game.adjust(), and asserts: (1) machine returns to 'awaitingPaste' THROUGH
// the re-fired onPrompt callback (not 'idle' clobbered by #applyResult), and (2) a fresh
// corrected re-paste is accepted (no pasteError) and resolves the turn normally — exactly
// ONE log entry, proving the aborted iteration neither logged nor double-saved.
//
// RED today: machine is clobbered to 'idle' by the #applyResult microtask, and
// narrator.pending is null so the re-submitPaste returns {ok:false}.
//
// Components/browser project: REAL chromium + REAL IndexedDB; clear 'frosty' per test.

import { describe, test, expect, beforeEach } from 'vitest';

import { game } from '../../src/lib/game.svelte';
import { EXAMPLE_ENVELOPE_5_4 } from '../../src/lib/engine/examples';

function clearDb(): Promise<void> {
	return new Promise<void>((res) => {
		const r = indexedDB.deleteDatabase('frosty');
		r.onsuccess = r.onerror = r.onblocked = () => res(undefined);
	});
}

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
	installRoller();
});

describe('CR-02 — Adjust returns to awaitingPaste; a corrected re-paste resolves', () => {
	test('adjust re-arms the paste gate (not idle) and the second envelope resolves the turn', async () => {
		await game.boot();
		game.startTurn('1st squad assaults the compound, two frags.');
		await awaitMachine('awaitingPaste');

		game.submitPaste(JSON.stringify(EXAMPLE_ENVELOPE_5_4));
		await awaitMachine('confirming');

		// Decline at the confirm gate — must re-arm awaitingPaste THROUGH onPrompt, not idle.
		game.adjust();
		await awaitMachine('awaitingPaste');
		expect(game.machine).toBe('awaitingPaste');

		// A corrected re-paste must be accepted (the narrator re-armed a fresh deferred run).
		game.submitPaste(JSON.stringify(EXAMPLE_ENVELOPE_5_4));
		expect(game.pasteError).toBeNull();
		await awaitMachine('confirming');

		game.confirm();
		await new Promise((r) => setTimeout(r, 20));

		// The turn resolved on the SECOND envelope: exactly one log entry, no double-save.
		// PHASE 8 (LOAD-05): boot now mounts the CLEAN turn-0 starter (phase 'planning'), not the
		// §5.4 turn-3 board — the §5.4 'consolidation' phase hand-off was specific to that mid-
		// engagement seed. The behavior under test (adjust re-arms the gate, the corrected re-paste
		// resolves exactly one turn) is unchanged: assert a resolved turn 1 + exactly one log entry.
		expect(game.state?.meta.turn).toBe(1);
		expect(game.log).toHaveLength(1);
	});
});
