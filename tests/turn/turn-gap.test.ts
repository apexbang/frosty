// turn-gap.test.ts — CR-01 RED-first: the AI narrative must thread through TurnResult.
//
// Phase 5's isolation test (narrative-panel.svelte.test.ts) set game.log directly and
// never drove the pipeline, so it could not catch that runTurn dropped env.narrative.
// This engine-project test drives the REAL runTurn over the §5.4 seed/envelope and
// asserts res.narrative === EXAMPLE_ENVELOPE_5_4.narrative — RED until turn.ts threads it.
//
// Stubs mirror turn.test.ts (re-declared locally; the engine never imports from tests/
// into src/, and a test re-declaring its own stubs is the established idiom here).
//
// PURITY: imports only engine modules + src/lib (seed.ts, turn.ts) + the §5.4 ENGINE
// exemplar. No tests/ fixture import, no Svelte.

import { describe, test, expect } from 'vitest';

import type { Narrator, TurnPayload } from '../../src/lib/engine/narrator';
import type { SaveStore, SaveResult, CampaignRow } from '../../src/lib/engine/save-store';
import type { Result } from '../../src/lib/engine/envelope-schema';
import type { MoveEnvelope, PlayerOrder } from '../../src/lib/engine/envelope';
import type { GameState } from '../../src/lib/engine/state';
import type { GameEvent } from '../../src/lib/engine/events';
import type { DicePayload, Modifier } from '../../src/lib/engine/dice';
import { clampNet, band as bandOf } from '../../src/lib/engine/dice';
import { EXAMPLE_ENVELOPE_5_4 } from '../../src/lib/engine/examples';

import { seedStarter } from '../../src/lib/seed';
import { runTurn, type TurnDeps, type TurnResult } from '../../src/lib/turn';

const TURN = 4;

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
	async save(
		_campaignId: string,
		_turn: number,
		_newEvents: GameEvent[],
		_state: GameState
	): Promise<SaveResult> {
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

function stubRoller(actor: string, modifiers: Modifier[], turn: number): DicePayload {
	const roll: [number, number] = [3, 4];
	const net = clampNet(modifiers);
	return { kind: 'dice', actor, roll, modifiers, net, band: bandOf(roll[0] + roll[1] + net), turn };
}

const order: PlayerOrder = { raw: '1st squad assaults the compound, two frags.', actions: [] };

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

describe('CR-01 — narrative threads through TurnResult', () => {
	test('runTurn returns the accepted envelope narrative (non-empty)', async () => {
		const seed = seedStarter();
		const res: TurnResult = await runTurn(
			makeDeps(),
			seed,
			priorEventsOf(seed),
			order,
			'camp-narr',
			TURN
		);

		expect(res.narrative).toBe(EXAMPLE_ENVELOPE_5_4.narrative);
		expect(res.narrative.length).toBeGreaterThan(0);
	});
});
