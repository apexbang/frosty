// rules.test.ts — the modular rulebook (DEPTH-01).
//
// Each rule module is a pure `{ id, trigger, text }`. A module's `trigger` predicate
// must fire ONLY on its own situation (one representative true case + one false case
// per module). `selectModules(state, order)` filters RULE_MODULES by trigger and
// returns the matching `ids` plus the firing modules' `text` joined by '\n\n' (empty
// when none fire). Triggers read code-known stakes (state, order) only — no positions
// (M4 deferred), matching `actionType` loosely (the model emits a free string).
//
// RED until src/lib/engine/rules/registry.ts (+ the six module files) exist. It MUST
// fail because those modules cannot be resolved — not because of a fixture/syntax error.
//
// PURITY: imports only the rules registry + the shared §5.4 fixture.

import { describe, test, expect } from 'vitest';
import { RULE_MODULES, selectModules } from '../../src/lib/engine/rules/registry';
import type { GameState } from '../../src/lib/engine/state';
import type { PlayerOrder, OrderAction } from '../../src/lib/engine/envelope';
import { stateBefore_5_4 } from './fixtures/worked-example-5.4';

// ── small builders ──────────────────────────────────────────────────────────
function order(...actionTypes: string[]): PlayerOrder {
	const actions: OrderAction[] = actionTypes.map((actionType) => ({
		actor: '1-1',
		actionType,
		capabilitiesUsed: []
	}));
	return { raw: actionTypes.join(', '), actions };
}

/** A quiet, no-contact state: planning phase, no live reports, enemy at low strength. */
function quietState(): GameState {
	const s = stateBefore_5_4();
	s.meta.phase = 'planning';
	s.intel.unconfirmedReports = [];
	for (const side of s.sides) for (const u of side.units) u.posture = 'staged';
	return s;
}

/** A state carrying a live unconfirmed report. */
function reportedState(): GameState {
	const s = quietState();
	s.intel.unconfirmedReports = ['movement on the east ridge'];
	return s;
}

function moduleById(id: string) {
	const m = RULE_MODULES.find((mod) => mod.id === id);
	if (!m) throw new Error(`module not found: ${id}`);
	return m;
}

describe('DEPTH-01 — RULE_MODULES registry', () => {
	test('registers the six locked modules with non-empty text', () => {
		const ids = RULE_MODULES.map((m) => m.id);
		for (const id of ['ambush', 'minefield', 'indirect-fire', 'breaching', 'fog-reveals', 'break-contact']) {
			expect(ids).toContain(id);
		}
		for (const m of RULE_MODULES) {
			expect(typeof m.text).toBe('string');
			expect(m.text.length).toBeGreaterThan(0);
		}
	});
});

describe('DEPTH-01 — each module triggers ONLY on its predicate', () => {
	test('ambush — fires on move/patrol into a live unconfirmed report; not on quiet move', () => {
		const ambush = moduleById('ambush');
		expect(ambush.trigger(reportedState(), order('move'))).toBe(true);
		expect(ambush.trigger(quietState(), order('move'))).toBe(false);
	});

	test('minefield — fires on move/assault/breach toward prepared positions; not on quiet move', () => {
		const minefield = moduleById('minefield');
		// stateBefore_5_4 has DEF posture 'prepared' + terrain 'urban'.
		expect(minefield.trigger(stateBefore_5_4(), order('assault'))).toBe(true);
		expect(minefield.trigger(quietState(), order('move'))).toBe(false);
	});

	test('indirect-fire — fires on fire_support/indirect/mortar action; not on a plain assault', () => {
		const indirect = moduleById('indirect-fire');
		expect(indirect.trigger(stateBefore_5_4(), order('fire_support'))).toBe(true);
		expect(indirect.trigger(quietState(), order('move'))).toBe(false);
	});

	test('breaching — fires on assault/breach against a prepared target; not on a quiet patrol', () => {
		const breaching = moduleById('breaching');
		expect(breaching.trigger(stateBefore_5_4(), order('assault'))).toBe(true);
		expect(breaching.trigger(quietState(), order('patrol'))).toBe(false);
	});

	test('fog-reveals — fires whenever a live unconfirmed report exists; not when none do', () => {
		const fog = moduleById('fog-reveals');
		expect(fog.trigger(reportedState(), order('move'))).toBe(true);
		expect(fog.trigger(quietState(), order('move'))).toBe(false);
	});

	test('break-contact — fires on withdraw/disengage/break_contact; not on an assault', () => {
		const breakContact = moduleById('break-contact');
		expect(breakContact.trigger(quietState(), order('break_contact'))).toBe(true);
		expect(breakContact.trigger(quietState(), order('assault'))).toBe(false);
	});
});

describe('DEPTH-01 — selectModules assembles ids + concatenated text', () => {
	test('returns empty ids and empty text when nothing fires (quiet patrol)', () => {
		const { ids, text } = selectModules(quietState(), order('patrol'));
		expect(ids).toEqual([]);
		expect(text).toBe('');
	});

	test('returns the firing module ids and their text joined by a blank line', () => {
		// §5.4 assault + fire_support fires indirect-fire, breaching, minefield (prepared/urban).
		const { ids, text } = selectModules(stateBefore_5_4(), order('assault', 'fire_support'));
		expect(ids.length).toBeGreaterThan(0);
		// text is exactly the firing modules' text joined by '\n\n'.
		const expected = RULE_MODULES.filter((m) => ids.includes(m.id))
			.map((m) => m.text)
			.join('\n\n');
		expect(text).toBe(expected);
		expect(text).toContain('\n\n');
	});
});
