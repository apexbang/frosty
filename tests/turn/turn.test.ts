// turn.test.ts — the RED orchestrator unit spec (node env, `engine` Vitest project).
//
// Locks the `runTurn` contract (RESEARCH Pattern 2) BEFORE turn.ts exists: it imports
// `runTurn` from `../../src/lib/turn` → RED for cannot-find-module until Wave 1 builds it.
// The four orchestrator branches (happy / badPaste / validationRejected / cancel) and the
// pre-turn seed invariant (frag=4, smoke=4) + the §5.4 post-turn literals (75, 25, 2, 4,
// 'consolidation') are asserted as the locked acceptance — NONE weakened to pass RED.
//
// Stubs (mirrors tests/engine/narrator.test.ts + round-trip.test.ts idioms):
//   - MockNarrator implements Narrator, run() resolves EXAMPLE_ENVELOPE_5_4 (canned).
//   - StubSaveStore implements all 5 SaveStore methods; save() → { ok: true }.
//   - stubRoller pins faces [3,4] and DERIVES net/band via the real clampNet/band, so
//     the §5.4 literals can't pass on a hardcoded constant.
//
// PURITY: imports only engine modules + src/lib (seed.ts, turn.ts) + the §5.4 ENGINE
// exemplar (examples.ts). No tests/ fixture import, no Svelte.

import { describe, test, expect, vi } from 'vitest';

import type { Narrator, TurnPayload } from '../../src/lib/engine/narrator';
import { ClipboardNarrator } from '../../src/lib/engine/narrator';
import { buildPrompt } from '../../src/lib/engine/prompt';
import type { SaveStore, SaveResult, CampaignRow } from '../../src/lib/engine/save-store';
import type { Result } from '../../src/lib/engine/envelope-schema';
import type { MoveEnvelope, PlayerOrder } from '../../src/lib/engine/envelope';
import type { GameState, Side } from '../../src/lib/engine/state';
import type { GameEvent } from '../../src/lib/engine/events';
import type { DicePayload, Modifier } from '../../src/lib/engine/dice';
import { clampNet, band as bandOf } from '../../src/lib/engine/dice';
import { remaining } from '../../src/lib/engine/ledger';
import { EXAMPLE_ENVELOPE_5_4 } from '../../src/lib/engine/examples';
import { sizeTurn } from '../../src/lib/engine/size-turn';
import { selectModules } from '../../src/lib/engine/rules/registry';

import { seedStarter } from '../../src/lib/seed';
// RED: src/lib/turn.ts does not exist yet (Wave 1) — this import fails to resolve.
import { runTurn, type TurnDeps, type TurnResult } from '../../src/lib/turn';

const TURN = 4;

// ── Stub deps ───────────────────────────────────────────────────────────────

class MockNarrator implements Narrator {
	private readonly envelope: MoveEnvelope;
	constructor(envelope: MoveEnvelope = EXAMPLE_ENVELOPE_5_4) {
		this.envelope = envelope;
	}
	async run(_p: TurnPayload): Promise<MoveEnvelope> {
		return this.envelope;
	}
}

class StubSaveStore implements SaveStore {
	public saved: { campaignId: string; turn: number; events: GameEvent[] }[] = [];
	async save(
		campaignId: string,
		turn: number,
		newEvents: GameEvent[],
		_state: GameState
	): Promise<SaveResult> {
		this.saved.push({ campaignId, turn, events: newEvents });
		return { ok: true };
	}
	async loadEnvelope(_campaignId?: string): Promise<import('../../src/lib/engine').PersistedGame | null> {
		return null;
	}
	async load(_campaignId?: string): Promise<GameState | null> {
		return null;
	}
	async list(): Promise<CampaignRow[]> {
		return [];
	}
	async export(_campaignId: string): Promise<void> {}
	async import(_file: File): Promise<Result<string>> {
		return { ok: true, value: 'stub' };
	}
	async undoLastTurn(_campaignId: string, _currentTurn: number): Promise<GameState | null> {
		return null;
	}
	async deleteCampaign(_campaignId: string): Promise<Result<void>> {
		return { ok: true, value: undefined };
	}
	async rename(_campaignId: string, _name: string): Promise<Result<void>> {
		return { ok: true, value: undefined };
	}
	async duplicate(_campaignId: string): Promise<Result<string>> {
		return { ok: true, value: 'stub-copy' };
	}
}

// Deterministic roller — pins ONLY the faces [3,4]; net/band DERIVED from the
// forwarded modifiers via the real clampNet/band (round-trip.test.ts idiom), so a
// golden cannot pass on a stubbed constant.
function stubRoller(actor: string, modifiers: Modifier[], turn: number): DicePayload {
	const roll: [number, number] = [3, 4];
	const net = clampNet(modifiers);
	return { kind: 'dice', actor, roll, modifiers, net, band: bandOf(roll[0] + roll[1] + net), turn };
}

const order: PlayerOrder = { raw: '1st squad assaults the compound, two frags.', actions: [] };

const unitById = (s: GameState, id: string) =>
	s.sides.flatMap((side) => side.units).find((u) => u.id === id);

// Reconstruct the seed's PRIOR-turn expend events from the materialized `expended`
// view (the same map game.boot() uses post-reload — RESEARCH OQ1/A4) so `remaining`
// queries a GameEvent[] stream identical to the live one. Each side's ExpendEntry[]
// is mapped back to side-scoped `expend` GameEvents.
function priorEventsOf(state: GameState): GameEvent[] {
	const events: GameEvent[] = [];
	for (const side of state.sides) {
		for (const x of side.consumables.expended) {
			events.push({
				kind: 'expend',
				side: side.id,
				actor: x.actor,
				item: x.item,
				qty: x.qty,
				reason: x.reason,
				turn: x.turn
			});
		}
	}
	return events;
}

function makeDeps(over: Partial<TurnDeps> = {}): TurnDeps {
	return {
		narrator: new MockNarrator(),
		saveStore: new StubSaveStore(),
		roller: stubRoller,
		awaitConfirm: async () => true,
		onPrompt: () => {},
		...over
	};
}

// ── Pre-turn seed invariant (proves the seed carries the prior turn-2 frag expend) ──

describe('seed invariant — pre-turn remaining derives frag=4, smoke=4', () => {
	test('remaining(frag, BLUE) === 4 and remaining(smoke, BLUE) === 4 against the seed', () => {
		const seed = seedStarter();
		const blue = seed.sides.find((s) => s.id === 'BLUE')!;
		const priorEvents = priorEventsOf(seed);
		// frag: loadout 6 − prior turn-2 expend 2 = 4 (pre-turn). smoke: no expend = 4 (canary).
		expect(remaining(blue.consumables.loadout, priorEvents, 'frag', 'BLUE')).toBe(4);
		expect(remaining(blue.consumables.loadout, priorEvents, 'smoke', 'BLUE')).toBe(4);
	});

	test('seedStarter() is a FACTORY — two calls are deep-distinct', () => {
		const a = seedStarter();
		const b = seedStarter();
		const aBlue = a.sides.find((s) => s.id === 'BLUE')!;
		aBlue.consumables.expended.push({ turn: 99, item: 'frag', qty: 1, actor: 'x', reason: 'mutate-a' });
		const bBlue = b.sides.find((s) => s.id === 'BLUE')!;
		expect(bBlue.consumables.expended).toHaveLength(1); // unmutated
	});
});

// ── (a) happy path — drives the full §6.1 sequence to the §5.4 numbers ──────────

describe('runTurn — happy path (the §5.4 round-trip)', () => {
	test('drives buildPrompt→narrator.run→validate→confirmDiff→resolveTurn→fold→save to the §5.4 result', async () => {
		const seed = seedStarter();
		const priorEvents = priorEventsOf(seed);
		const saveStore = new StubSaveStore();
		let promptSeen = '';
		const deps = makeDeps({
			saveStore,
			onPrompt: (p: string) => {
				promptSeen = p;
			}
		});

		const res: TurnResult = await runTurn(deps, seed, priorEvents, order, 'camp-1', TURN);

		// The copyable prompt was handed to the UI (non-empty, from buildPrompt). Phase 6
		// (DEPTH-02): the prompt is built from the SIZED payload — the bounded slice + the
		// concatenated firing rule-module text + the stakes-derived detail tier.
		expect(promptSeen.length).toBeGreaterThan(0);
		const sized = sizeTurn(seed, order);
		const { text: rulesText } = selectModules(seed, order);
		expect(promptSeen).toBe(
			buildPrompt({ state: sized.stateSlice as GameState, rules: rulesText, order, detail: sized.detail })
		);

		// §5.4 categorical state-after.
		expect(res.state.meta.phase).toBe('consolidation');
		expect(unitById(res.state, '1-1')!.strength).toBe(75);
		expect(unitById(res.state, 'DEF')!.strength).toBe(25);
		expect(unitById(res.state, 'DEF')!.morale).toBe('broken');

		// §5.4 derived ledger — frag reaches 2 because seed's prior turn-2 expend (2) +
		// the turn-4 expend (2) sum to 4 off a loadout of 6; smoke is the canary at 4.
		const blue = res.state.sides.find((s: Side) => s.id === 'BLUE')!;
		const fullStream = [...priorEvents, ...res.events];
		expect(remaining(blue.consumables.loadout, fullStream, 'frag', 'BLUE')).toBe(2);
		expect(remaining(blue.consumables.loadout, fullStream, 'smoke', 'BLUE')).toBe(4);

		// Autosave ran as an explicit step and reported ok.
		expect(res.saveOk).toBe(true);
		expect(saveStore.saved).toHaveLength(1);
		expect(saveStore.saved[0].turn).toBe(TURN);
		expect(res.rejections).toEqual([]);
	});
});

// ── (b) badPaste — submitPaste('garbage') → {ok:false} and run() STAYS PENDING ──

describe('runTurn — badPaste keeps the turn Promise pending (NARR-03)', () => {
	test('a garbage paste returns {ok:false} and never settles/throws the run', async () => {
		// Drive runTurn with the REAL ClipboardNarrator so the deferred-Promise contract
		// is exercised: a garbage submitPaste must be recoverable, leaving run() pending.
		const narrator = new ClipboardNarrator(buildPrompt);
		const seed = seedStarter();
		const deps = makeDeps({ narrator });

		const pending = runTurn(deps, seed, priorEventsOf(seed), order, 'camp-2', TURN);

		// Race the pending turn against a microtask flush — it must NOT settle on bad paste.
		let settled = false;
		void pending.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			}
		);

		const bad = narrator.submitPaste('garbage not json');
		expect(bad.ok).toBe(false);

		await Promise.resolve();
		await Promise.resolve();
		expect(settled).toBe(false); // turn still in flight, re-pasteable

		// A subsequent VALID paste settles it cleanly (recoverable, not turn-losing).
		const good = narrator.submitPaste(JSON.stringify(EXAMPLE_ENVELOPE_5_4));
		expect(good.ok).toBe(true);
		const res = await pending;
		expect(res.state.meta.phase).toBe('consolidation');
	});
});

// ── (c) validationRejected — off-manifest action surfaces in rejections, excluded ──

describe('runTurn — validationRejected surfaces inline, state excludes it (VALID-04)', () => {
	test('an off-manifest capability is rejected and not applied', async () => {
		const seed = seedStarter();
		// A shape-valid envelope whose lone player action uses a PROHIBITED capability
		// ('cas' is in BLUE.manifest.prohibited / not in organicAssets) → validate rejects it.
		const rejectedEnvelope: MoveEnvelope = {
			narrative: 'calls in an orbital laser',
			playerActions: [
				{
					actor: '1-1',
					side: 'BLUE',
					actionType: 'assault',
					target: 'compound',
					capabilitiesUsed: ['cas'],
					expend: [{ item: 'frag', qty: 1 }],
					proposedModifiers: [],
					proposedOutcome: { note: 'should be refused' }
				}
			],
			enemyActions: [],
			reveals: []
		};
		const deps = makeDeps({ narrator: new MockNarrator(rejectedEnvelope) });

		const res = await runTurn(deps, seed, priorEventsOf(seed), order, 'camp-3', TURN);

		// The rejection is surfaced (visible, never silent).
		expect(res.rejections.length).toBeGreaterThan(0);
		// State excludes the rejected action: no frag was expended by it (remaining unchanged at 4).
		const blue = res.state.sides.find((s: Side) => s.id === 'BLUE')!;
		const fullStream = [...priorEventsOf(seed), ...res.events];
		expect(remaining(blue.consumables.loadout, fullStream, 'frag', 'BLUE')).toBe(4);
	});
});

// ── (d) cancel — narrator.cancel() is the ONLY path that REJECTS the run Promise ──

describe('runTurn — cancel() is the only reject path', () => {
	test('cancel() rejects the pending run; nothing is saved', async () => {
		const narrator = new ClipboardNarrator(buildPrompt);
		const seed = seedStarter();
		const saveStore = new StubSaveStore();
		const deps = makeDeps({ narrator, saveStore });

		const pending = runTurn(deps, seed, priorEventsOf(seed), order, 'camp-4', TURN);
		const onReject = vi.fn();
		const guarded = pending.catch(onReject);

		narrator.cancel('player abandoned the turn');
		await guarded;

		expect(onReject).toHaveBeenCalled(); // cancel REJECTED the run
		expect(saveStore.saved).toHaveLength(0); // no autosave on a cancelled turn
	});
});
