// override-valve.svelte.test.ts — Wave-0 RED component contract for ORDER-06 / D-02.
//
// `components` browser project. RED until the bridge exposes `orderBridge.pendingActions`
// ($state OrderAction[], Plan 07-02) AND a pure `mergeOrder(pendingActions, raw)` merge
// (RESEARCH Pattern 3) that startTurn uses instead of today's hardcoded `{ raw, actions: [] }`.
// Locks the Pattern 3 merge semantics — BOTH channels carried, NEITHER dropped:
//   - tapped structured actions accumulate into orderBridge.pendingActions (the OrderAction[]);
//   - a typed free override (raw) is kept verbatim;
//   - the PlayerOrder carries BOTH `actions` (the tapped proposals) AND `raw` (the typed
//     override) — the override valve is ADDITIVE, never a replace.
//
// The merge is proven against the pure exported `mergeOrder` (the same function startTurn
// calls), NOT a runTurn spy — spying on an ESM export is unsupported in the browser project
// (and would mask the real contract). RED because `mergeOrder` + `orderBridge.pendingActions` do
// not exist yet (Cannot-find-export / undefined property).

import { describe, test, expect, beforeEach, afterEach } from 'vitest';

import { game } from '../../src/lib/game.svelte';
import { seedStarter } from '../../src/lib/seed';
import type { OrderAction, PlayerOrder } from '../../src/lib/engine/envelope';
import { buildPrompt } from '../../src/lib/engine/prompt';
import { stripViteOverlay, importPending } from './support/strip-vite-overlay';

// The NEW bridge field Plan 07-02 will add (the tapped-order accumulator). Typed here so
// this RED file type-checks (svelte-check) while staying RED at RUNTIME — `mergeOrder` is
// still unexported, the genuine missing-impl signal the assertions assert.
interface PendingBridge {
	pendingActions: OrderAction[];
}
const orderBridge = game as unknown as typeof game & PendingBridge;

// RED: `mergeOrder` is not exported from game.svelte.ts yet (Plan 07-02). The import is
// LAZY (inside each test, not a top-level static import) so the missing-export module
// error fails THIS test's assertion cleanly instead of injecting a Vite error overlay
// into the SHARED browser document — which would leak source text into sibling component
// files' DOM queries and cascade unrelated failures (test-isolation discipline). Once the
// bridge exports `mergeOrder` the import resolves and the Pattern-3 merge drives GREEN.
function loadMergeOrder(): Promise<(_pendingActions: OrderAction[], _raw: string) => PlayerOrder> {
	return importPending<(_a: OrderAction[], _r: string) => PlayerOrder>(
		'../../../src/lib/game.svelte.ts',
		(m) => m.mergeOrder,
		'mergeOrder not exported from game.svelte.ts yet (Plan 07-02)'
	);
}

beforeEach(() => {
	game.state = seedStarter();
	game.events = [];
	game.machine = 'idle';
	orderBridge.pendingActions = [];
});

// A missing-export dynamic import (mergeOrder not added yet) injects a Vite error overlay
// into the SHARED browser document; strip it so it never leaks into sibling component
// files' DOM queries (test-isolation; the overlay is not auto-cleaned).
afterEach(() => stripViteOverlay());

/** The tapped structured proposals (assault + a frag expend) the player queued via taps. */
const TAPPED: OrderAction[] = [
	{
		actor: '1-1',
		actionType: 'assault',
		capabilitiesUsed: ['small_arms', 'frag'],
		expend: [{ item: 'frag', qty: 2 }]
	}
];

describe('ORDER-06 — tapped actions + typed raw merge into the PlayerOrder (neither dropped)', () => {
	test('orderBridge.pendingActions is the structured tapped-order accumulator', () => {
		orderBridge.pendingActions = TAPPED;
		expect(orderBridge.pendingActions).toHaveLength(1);
		expect(orderBridge.pendingActions[0].actor).toBe('1-1');
	});

	test('mergeOrder carries BOTH the tapped actions AND the typed raw override (additive merge)', async () => {
		const mergeOrder = await loadMergeOrder();
		const order = mergeOrder(TAPPED, 'but pull MTR back if you take fire');
		// BOTH channels survive — actions (tapped) AND raw (typed override), neither dropped.
		expect(order.actions).toHaveLength(1);
		expect(order.actions[0].actor).toBe('1-1');
		expect(order.raw).toContain('pull MTR back');
	});

	test('the override is ADDITIVE — a non-empty typed raw does not blow away queued actions', async () => {
		const mergeOrder = await loadMergeOrder();
		const order = mergeOrder(TAPPED, 'a free one-off order');
		expect(order.actions).not.toHaveLength(0);
		expect(order.raw.length).toBeGreaterThan(0);
	});

	test('an empty pendingActions still yields a prose-only PlayerOrder (back-compat)', async () => {
		const mergeOrder = await loadMergeOrder();
		const order = mergeOrder([], 'pure prose order, no taps');
		expect(order.actions).toHaveLength(0);
		expect(order.raw).toContain('pure prose order');
	});

	test('a tapped-only order (no typed raw) still carries its actions', async () => {
		const mergeOrder = await loadMergeOrder();
		const order = mergeOrder(TAPPED, '');
		expect(order.actions).toHaveLength(1);
		// raw may be trimmed-empty, but the structured proposals are intact.
		expect(order.actions[0].expend?.[0].item).toBe('frag');
	});

	// OQ#1 / T-07-02-03 mitigation: buildPrompt renders ONLY order.raw (it does not template
	// order.actions), so the merged raw MUST carry a human-readable serialization of the tapped
	// proposals or the AI never sees them. Prove both the merged raw AND the copied prompt
	// surface the tapped actor + actionType + expend.
	test('the merged raw serializes the tapped actions so buildPrompt surfaces them to the AI', async () => {
		const mergeOrder = await loadMergeOrder();
		const order = mergeOrder(TAPPED, 'hold the line');
		// The merged raw carries a clearly-delimited serialization of the tapped proposals.
		expect(order.raw).toContain('Tapped orders:');
		expect(order.raw).toContain('1-1 assault');
		expect(order.raw).toContain('frag ×2');
		expect(order.raw).toContain('hold the line');
		// buildPrompt (which reads only order.raw) therefore surfaces the tapped actions.
		const prompt = buildPrompt({ state: undefined, rules: '', order } as never);
		expect(prompt).toContain('Tapped orders:');
		expect(prompt).toContain('1-1 assault');
		expect(prompt).toContain('frag ×2');
	});
});
