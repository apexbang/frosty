// scenario-reload-durability.svelte.test.ts — CR-01 / SCEN-06 turn-0 durability regression
// at the REAL bridge level.
//
// 09-VERIFICATION.md CR-01 (the one BLOCKER): both `newGameFromScenario` and
// `importScenarioFromPaste` adopted a NEW turn-0 campaign in reactive memory, then called
// `flushSave()` as their ONLY persistence step — but flushSave hard-returns at `currentTurn < 1`,
// so `IdbSaveStore.save()` was NEVER called for the turn-0 seed. A player who created or imported
// a scenario and reloaded BEFORE resolving turn 1 lost it: `#resolveResume` picked the prior
// most-recent campaign and the new one was silently gone — violating SCEN-06 ("a NEW independent
// campaign that survives a reload").
//
// These two cases drive the REAL `game` singleton + its REAL IdbSaveStore (DB 'frosty') with the
// same clearDb()/fresh-store harness as reload-continuity. `listCampaigns()` reads STRAIGHT from
// IndexedDB, so a row appearing there at turn 0 IS the durability proof a reload would see — the
// reload-before-turn-1 case is exactly "is there a persisted row before any turn is resolved."
// NO turn is resolved in either case (no roller/runOneTurn needed — that is the whole point).
//
// RED without Task 1's write: at turn 0 listCampaigns() is empty (flushSave no-ops the seed),
// so the campaignId-row assertion fails. GREEN with the explicit `#persistTurnZeroBase` write.
//
// PURITY: this is the bridge-level round-trip (Svelte singleton + real idb), mirroring
// reload-continuity; it asserts on the PUBLIC `listCampaigns()` seam, never private store internals.

import { describe, test, expect, beforeEach } from 'vitest';

import { game } from '../../src/lib/game.svelte';
import { IdbSaveStore } from '../../src/lib/idb-save-store';
import { starterScenario } from '../../src/lib/scenarios/starter';

function clearDb(): Promise<void> {
	return new Promise<void>((res) => {
		const r = indexedDB.deleteDatabase('frosty');
		r.onsuccess = r.onerror = r.onblocked = () => res(undefined);
	});
}

/** Wrap a turn-0 seed as the kind of prose-padded fenced ```json block a chatty model emits
 *  (the same construction style as scenario-import.test.ts's fencedWithProse). */
function fencedWithProse(value: unknown): string {
	return [
		'Sure! Here is the turn-0 scenario you asked for:',
		'',
		'```json',
		JSON.stringify(value, null, 2),
		'```',
		'',
		'Let me know if you want any changes.'
	].join('\n');
}

beforeEach(async () => {
	await clearDb();
	// Re-point the singleton at a FRESH IdbSaveStore so a prior test's cached IndexedDB connection
	// can never bleed a stale row across the clearDb (mirrors reload-continuity's harness). The DB
	// name is unchanged ('frosty').
	game.__setSaveStoreForTest(new IdbSaveStore('frosty'));
	game.machine = 'idle';
	game.loadNotice = null;
	game.scenarioImportError = null;
	game.saveUnavailable = false;
});

describe('CR-01 / SCEN-06 — a scenario pick is durable at turn 0 (reload-before-turn-1)', () => {
	test('newGameFromScenario persists the new campaign so listCampaigns() sees it before turn 1', async () => {
		// Discover a shipped scenario id from the picker's own data source.
		const scenarios = await game.listScenarios();
		expect(scenarios.length).toBeGreaterThan(0);
		const id = scenarios[0].id;

		await game.newGameFromScenario(id);

		// The new campaign is adopted at turn 0 with NO turn resolved.
		expect(game.state).not.toBeNull();
		expect(game.state!.meta.turn).toBe(0);

		// THE durability proof a reload-before-turn-1 would see: a persisted row in IndexedDB whose
		// id is the freshly-minted campaignId. RED before Task 1 (flushSave no-ops the turn-0 seed →
		// listCampaigns empty); GREEN with the explicit turn-0 base write.
		const rows = await game.listCampaigns();
		expect(rows.some((r) => r.id === game.campaignId)).toBe(true);
	});
});

describe('CR-01 / SCEN-06 — an AI-imported scenario is durable at turn 0 (reload-before-turn-1)', () => {
	test('importScenarioFromPaste persists the new campaign so listCampaigns() sees it before turn 1', async () => {
		// A valid fenced turn-0 envelope (the clean starter seed wrapped in prose-padded ```json),
		// mirroring scenario-import.test.ts's happy-path construction.
		const raw = fencedWithProse(starterScenario());

		await game.importScenarioFromPaste(raw);

		// A clean import: no recoverable error, adopted at turn 0, no turn resolved.
		expect(game.scenarioImportError).toBeNull();
		expect(game.state).not.toBeNull();
		expect(game.state!.meta.turn).toBe(0);

		// Same durability proof for the AI-import path. RED before Task 1; GREEN with the write.
		const rows = await game.listCampaigns();
		expect(rows.some((r) => r.id === game.campaignId)).toBe(true);
	});
});
