// undo.svelte.test.ts — Wave-0 RED bridge contract for UI-07 (undo live-mirror rollback).
//
// `components` browser project (real chromium + real IndexedDB). RED until the bridge
// exposes `undoBridge.undoLastTurn()` (Plan 07-03) wired to SaveStore.undoLastTurn. Locks the
// UI-07 / D-03 mirror-rollback contract — after a resolved turn, undo rolls the LIVE
// reactive mirror back to the prior-turn values:
//   - game.state / game.events roll back so game.remaining RE-DERIVES to the historical
//     ledger (the §5.4 frag=4 pre-turn count, not the post-turn-4 frag=2);
//   - game.lastResolution becomes null (RESEARCH OQ#2 — banner empty after undo);
//   - game.log / rejections roll back; the machine returns to a non-blocking state.
//
// The store persistence half (replay-equality) is locked in save-store.test.ts; this file
// locks the BRIDGE half (the reactive reassignment from the reloaded state). RED for
// "undoBridge.undoLastTurn is not a function" until the bridge method lands.

import { describe, test, expect, beforeEach, afterEach } from 'vitest';

import { game } from '../../src/lib/game.svelte';
import { seedStarter } from '../../src/lib/seed';
import { stripViteOverlay } from './support/strip-vite-overlay';
import type { GameEvent } from '../../src/lib/engine/events';

// The NEW bridge surface Plan 07-03/07-05 will add. Typed here so this RED file type-checks
// (svelte-check) while staying RED at RUNTIME — the members do not exist yet, so `typeof`
// is 'undefined' and a call throws "is not a function" (the genuine missing-impl signal).
interface PendingBridge {
	undoLastTurn(): Promise<void>;
	flushSave?(): Promise<void>;
}
const undoBridge = game as unknown as typeof game & PendingBridge;

beforeEach(() => {
	// Seed the singleton directly (the §5.4 starter — the prior state undo rolls back TO).
	// No game.boot() here: it writes the real `frosty` IndexedDB, and that heavy shared-DB
	// I/O under the same browser worker contends with sibling component files. The RED
	// contract only needs `undoBridge.undoLastTurn` to be absent (it is, until Plan 07-03); the
	// bridge half is exercised against the in-memory mirror.
	game.state = seedStarter();
	game.events = [];
	game.log = [];
	game.lastResolution = null;
	game.rejections = [];
	game.machine = 'idle';
});

// Restore the shared singleton + strip any Vite overlay so neither this file's mutated
// game state nor an overlay leaks into sibling component files (test-isolation).
afterEach(() => {
	game.events = [];
	game.log = [];
	game.lastResolution = null;
	game.machine = 'idle';
	stripViteOverlay();
});

describe('UI-07 — undoBridge.undoLastTurn rolls the live reactive mirror back to the prior turn', () => {
	test('undoLastTurn is a bridge method (arrow field) returning a Promise', () => {
		expect(typeof undoBridge.undoLastTurn).toBe('function');
	});

	test('after a simulated resolved turn, undo rolls state/events back so remaining re-derives to history', async () => {
		// Pre-turn baseline: the §5.4 seed derives frag → 4 (the historical ledger count).
		// Capture the pre-turn meta values off the reactive proxy as primitives — `game.state`
		// is a runes `$state` proxy and is not `structuredClone`-able from a plain .ts test.
		const beforeTurn = { meta: { turn: game.state!.meta.turn } };
		expect(game.remaining.BLUE.frag).toBe(4);

		// Simulate the turn-4 resolution landing on the live mirror: a frag expend (4 → 2)
		// + a resolution strip. Persist it so the store has a turn to drop.
		const turn = game.state!.meta.turn + 1; // 4
		const turnEvents: GameEvent[] = [
			{ kind: 'expend', side: 'BLUE', actor: '1-1', item: 'frag', qty: 2, turn },
			{ kind: 'clock', from: 'D1 0700', to: 'D1 0720', turn }
		];
		game.events = [...game.events, ...turnEvents];
		game.state!.meta.turn = turn;
		game.lastResolution = {
			roll: [3, 4],
			modifiers: [{ label: '60mm support', value: 2 }],
			net: 1,
			band: 'success_costly'
		};
		await undoBridge.flushSave?.();
		// The live ledger now reflects the spend.
		expect(game.remaining.BLUE.frag).toBe(2);

		// Undo — the bridge rolls the mirror back to the historical pre-turn-4 state.
		await undoBridge.undoLastTurn();

		// remaining RE-DERIVES to the historical ledger (frag back to 4, smoke untouched).
		expect(game.remaining.BLUE.frag).toBe(4);
		expect(game.remaining.BLUE.smoke).toBe(4);
		// meta.turn rolled back to the prior turn.
		expect(game.state!.meta.turn).toBe(beforeTurn!.meta.turn);
	});

	test('undo clears lastResolution to null (the banner derives to empty — OQ#2)', async () => {
		const turn = game.state!.meta.turn + 1;
		game.events = [...game.events, { kind: 'clock', from: 'a', to: 'b', turn }];
		game.state!.meta.turn = turn;
		game.lastResolution = { roll: [3, 4], modifiers: [], net: 1, band: 'success_costly' };
		await undoBridge.flushSave?.();

		await undoBridge.undoLastTurn();
		expect(game.lastResolution).toBeNull();
	});

	test('undo leaves the machine non-blocking (the player can compose the next order)', async () => {
		const turn = game.state!.meta.turn + 1;
		game.events = [...game.events, { kind: 'clock', from: 'a', to: 'b', turn }];
		game.state!.meta.turn = turn;
		await undoBridge.flushSave?.();

		await undoBridge.undoLastTurn();
		// Never wedged in a gating state (confirming/resolving) after undo.
		expect(['idle', 'composing', 'rendered']).toContain(game.machine);
	});
});
