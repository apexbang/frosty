// narrative-pipeline.svelte.test.ts — CR-01 RED-first at the REAL bridge level.
//
// The Phase-5 isolation test set game.log directly and bypassed the pipeline, so it
// never caught that a real turn left game.log empty. This drives the WHOLE bridge:
// boot → startTurn → submitPaste(§5.4 JSON) → confirm, then asserts game.log gets the
// AI's prose AND NarrativePanel renders it (not "No prose yet"). RED until #applyResult
// appends env.narrative to game.log.
//
// Components/browser project: REAL chromium + REAL IndexedDB. Every test that boots
// MUST clear the 'frosty' DB in beforeEach (the singleton's IdbSaveStore is shared).

import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { game } from '../../src/lib/game.svelte';
import NarrativePanel from '../../src/lib/components/NarrativePanel.svelte';
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
	installRoller();
});

describe('CR-01 — a real turn populates game.log; NarrativePanel renders the prose', () => {
	test('drives the bridge end-to-end and renders the §5.4 narrative', async () => {
		await game.boot();
		game.startTurn('1st squad assaults the compound, two frags.');
		await awaitMachine('awaitingPaste');

		game.submitPaste(JSON.stringify(EXAMPLE_ENVELOPE_5_4));
		await awaitMachine('confirming');

		game.confirm();
		// Flush the resolution microtasks.
		await new Promise((r) => setTimeout(r, 20));

		expect(game.log).toHaveLength(1);
		// PHASE 8 (LOAD-05): boot mounts the CLEAN turn-0 starterScenario(), so a single resolved
		// turn produces turn 1 (was turn 4 under the old §5.4 turn-3 seed). The narrative pipeline
		// (the behavior under test) is unchanged — the prose still folds into game.log.
		expect(game.log[0].turn).toBe(1);
		expect(game.log[0].narrative).toBe(EXAMPLE_ENVELOPE_5_4.narrative);

		const screen = render(NarrativePanel);
		await expect.element(screen.getByText(/1st squad pushes off the line of departure/)).toBeVisible();
	});
});
