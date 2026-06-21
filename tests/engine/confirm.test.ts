// confirm.test.ts — the player's confirm-before-commit projection (ORDER-02/03).
//
// confirm.ts turns a validated MoveEnvelope into a flat, human-readable diff the
// player approves BEFORE the turn resolves — the safety gate that keeps the player
// the final authority over counts (PROJECT.md Key Decision: confirm step ON). It
// projects every `expend` (actor/side/item/qty) and every `proposedOutcome.casualties`
// (unit/deltaBand) as rows. This suite locks:
//   - ORDER-02 — confirmDiff(envelope_5_4) yields expend rows frag×2, mortar_60mm×2,
//     rpg×1 and casualty rows 1-1 deltaBand −1, DEF deltaBand −3, with actor/side
//     carried through.
//   - ORDER-03 — CONFIRM_DEFAULT_ON === true (the gate defaults ON, player-disableable).
//
// RED until src/lib/engine/confirm.ts is written. It MUST fail because that module
// cannot be resolved — not because of a fixture or syntax error.
//
// PURITY: imports only the confirm module and the shared §5.4 fixture.

import { describe, test, expect } from 'vitest';
import { confirmDiff, CONFIRM_DEFAULT_ON } from '../../src/lib/engine/confirm';
import { envelope_5_4 } from './fixtures/worked-example-5.4';
import type { MoveEnvelope } from '../../src/lib/engine/envelope';

// ── ORDER-02: the diff projection itemizes every expend + every casualty ───────
describe('ORDER-02 — diff projection', () => {
	const rows = confirmDiff(envelope_5_4);

	const expendRows = () => rows.filter((r) => r.kind === 'expend');
	const casualtyRows = () => rows.filter((r) => r.kind === 'casualty');

	test('projects an expend row for each §5.4 expend: frag×2, mortar_60mm×2, rpg×1', () => {
		const e = expendRows();
		expect(e).toHaveLength(3);

		const frag = e.find((r) => r.item === 'frag');
		expect(frag).toBeDefined();
		expect(frag!.qty).toBe(2);
		expect(frag!.actor).toBe('1-1');
		expect(frag!.side).toBe('BLUE');

		const mortar = e.find((r) => r.item === 'mortar_60mm');
		expect(mortar).toBeDefined();
		expect(mortar!.qty).toBe(2);
		expect(mortar!.actor).toBe('MTR');
		expect(mortar!.side).toBe('BLUE');

		const rpg = e.find((r) => r.item === 'rpg');
		expect(rpg).toBeDefined();
		expect(rpg!.qty).toBe(1);
		expect(rpg!.actor).toBe('DEF');
		expect(rpg!.side).toBe('RED');
	});

	test('projects a casualty row for each §5.4 casualty: 1-1 deltaBand −1, DEF deltaBand −3', () => {
		const c = casualtyRows();
		expect(c).toHaveLength(2);

		const oneOne = c.find((r) => r.unit === '1-1');
		expect(oneOne).toBeDefined();
		expect(oneOne!.deltaBand).toBe(-1);

		const def = c.find((r) => r.unit === 'DEF');
		expect(def).toBeDefined();
		expect(def!.deltaBand).toBe(-3);
	});
});

// ── D: confirmDiff skips qty <= 0 expend rows (no ×0 / negative row surfaces) ──
describe('D — confirmDiff skips qty <= 0 expend rows', () => {
	const envelope: MoveEnvelope = {
		narrative: '',
		playerActions: [
			{
				actor: '1-1',
				side: 'BLUE',
				actionType: 'assault',
				capabilitiesUsed: ['frag'],
				expend: [
					{ item: 'frag', qty: 0 },
					{ item: 'smoke', qty: -1 },
					{ item: 'frag', qty: 2 }
				],
				proposedModifiers: []
			}
		],
		enemyActions: [],
		reveals: []
	};

	test('a qty:0 and a qty:-1 expend emit NO row; only the positive frag×2 surfaces', () => {
		const rows = confirmDiff(envelope);
		const expendRows = rows.filter((r) => r.kind === 'expend');

		// The single positive expend is present.
		expect(expendRows).toHaveLength(1);
		expect(expendRows[0]).toMatchObject({ item: 'frag', qty: 2 });

		// No non-positive expend row leaks through.
		expect(expendRows.some((r) => r.qty <= 0)).toBe(false);
	});
});

// ── ORDER-03: the confirm gate defaults ON ─────────────────────────────────────
describe('ORDER-03 — default ON', () => {
	test('CONFIRM_DEFAULT_ON is true', () => {
		expect(CONFIRM_DEFAULT_ON).toBe(true);
	});
});
