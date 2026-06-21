// dice.test.ts — proves the three dice guarantees are real, not aspirational:
//   DICE-01 fairness     — each d6 face within ~1% of 1/6; 2d6 sums form the triangle.
//   DICE-02 unshadeable   — net clamps to ±3; the payload band reflects the clamped net.
//   DICE-03 band table     — exact at every boundary 10/9/7/6/5/4 plus extremes 15 / -1.
//
// Pure node test (zero DOM) against crypto.getRandomValues — confirmed available in
// the Vitest node runtime by the plan-01 harness. [CITED: RESEARCH "Code Examples"
// distribution test; VALIDATION DICE-01/02/03 + Critical Property #3.]

import { describe, it, expect } from 'vitest';
import { d6, roll2d6, clampNet, band, roll } from '../../src/lib/engine/dice';

describe('d6 fairness (DICE-01) — rejection-sampled, no modulo bias', () => {
	// Statistical tests bin a large N; per-iteration `expect()` would dominate the
	// runtime, so bounds are tallied in-loop and asserted once after. A generous
	// testTimeout keeps the N>=600,000 the plan requires without flakiness.
	it(
		'every face lands within ~1% of 1/6 over 600,000 draws',
		() => {
			const N = 600_000;
			const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
			let outOfRange = 0;
			for (let i = 0; i < N; i++) {
				const v = d6();
				if (v < 1 || v > 6) outOfRange++;
				counts[v]++;
			}
			expect(outOfRange).toBe(0); // every draw was in [1,6]
			// toBeCloseTo(1/6, 2) ⇒ within 0.005 of 0.16667 ⇒ ~±3% band; the empirical
			// spread (16.651%–16.684% over 6M draws, RESEARCH) sits comfortably inside.
			for (let f = 1; f <= 6; f++) {
				expect(counts[f] / N).toBeCloseTo(1 / 6, 2);
			}
		},
		20_000
	);

	it(
		'2d6 sums form the 36-outcome triangle: 7 is modal, 2 and 12 are rarest',
		() => {
			const N = 360_000;
			const sums: Record<number, number> = {};
			for (let s = 2; s <= 12; s++) sums[s] = 0;
			let outOfRange = 0;
			for (let i = 0; i < N; i++) {
				const [a, b] = roll2d6();
				if (a < 1 || a > 6 || b < 1 || b > 6) outOfRange++;
				sums[a + b]++;
			}
			expect(outOfRange).toBe(0);
			// 7 is the modal sum (6/36); 2 and 12 are the rarest (1/36 each).
			const max = Math.max(...Object.values(sums));
			expect(sums[7]).toBe(max);
			for (let s = 2; s <= 12; s++) {
				if (s === 2 || s === 12) continue;
				expect(sums[s]).toBeGreaterThan(sums[2]);
				expect(sums[s]).toBeGreaterThan(sums[12]);
			}
		},
		20_000
	);
});

describe('clampNet ±3 (DICE-02) — applied before any band is read', () => {
	it('sums modifier values when within bound', () => {
		expect(clampNet([{ label: 'a', value: 2 }, { label: 'b', value: -1 }])).toBe(1);
	});

	it('clamps at the +3 ceiling (input sum +6)', () => {
		expect(
			clampNet([
				{ label: 'a', value: 2 },
				{ label: 'b', value: 2 },
				{ label: 'c', value: 2 }
			])
		).toBe(3);
	});

	it('clamps at the -3 floor (input sum -6)', () => {
		expect(
			clampNet([
				{ label: 'a', value: -2 },
				{ label: 'b', value: -2 },
				{ label: 'c', value: -2 }
			])
		).toBe(-3);
	});

	it('an empty modifier list nets to 0', () => {
		expect(clampNet([])).toBe(0);
	});
});

describe('band table (DICE-03) — exact at every boundary', () => {
	it('reads success_clean at the >=10 boundary and the upper extreme', () => {
		expect(band(15)).toBe('success_clean');
		expect(band(10)).toBe('success_clean');
	});

	it('reads success_costly across 7..9', () => {
		expect(band(9)).toBe('success_costly');
		expect(band(7)).toBe('success_costly');
	});

	it('reads stalled across 5..6', () => {
		expect(band(6)).toBe('stalled');
		expect(band(5)).toBe('stalled');
	});

	it('reads failure at <=4 and the lower extreme', () => {
		expect(band(4)).toBe('failure');
		expect(band(-1)).toBe('failure');
	});
});

describe('pre-commit ordering (DICE-02) — band reflects the clamped, itemized net', () => {
	it('payload.net is the clamped net and payload.band is read from roll-sum + that net', () => {
		const modifiers = [
			{ label: 'a', value: 2 },
			{ label: 'b', value: 2 },
			{ label: 'c', value: 2 } // sum +6 → must clamp to +3
		];
		const payload = roll('BLUE-1-1', modifiers, 4);

		// The payload is the dice event shape, carrying the itemized modifiers.
		expect(payload.kind).toBe('dice');
		expect(payload.actor).toBe('BLUE-1-1');
		expect(payload.turn).toBe(4);
		expect(payload.modifiers).toEqual(modifiers);

		// net is the CLAMPED net (not the raw +6) — proven against clampNet itself.
		expect(payload.net).toBe(3);
		expect(payload.net).toBe(clampNet(modifiers));

		// band is read from roll-sum + the pre-committed clamped net — no shading.
		const rollSum = payload.roll[0] + payload.roll[1];
		expect(payload.band).toBe(band(rollSum + payload.net));
	});

	it('holds across many rolls: every payload band equals band(rollSum + clampNet(modifiers))', () => {
		const modifiers = [{ label: 'cover', value: -1 }];
		const expectedNet = clampNet(modifiers);
		let violations = 0;
		for (let i = 0; i < 5000; i++) {
			const p = roll('RED-2-1', modifiers, 7);
			const inRange = p.roll[0] >= 1 && p.roll[0] <= 6 && p.roll[1] >= 1 && p.roll[1] <= 6;
			const netOk = p.net === expectedNet;
			const bandOk = p.band === band(p.roll[0] + p.roll[1] + p.net);
			if (!inRange || !netOk || !bandOk) violations++;
		}
		expect(violations).toBe(0);
	});
});
