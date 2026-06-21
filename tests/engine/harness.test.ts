import { describe, expect, it } from 'vitest';

// Green-on-empty smoke test. Proves the Vitest harness discovers and runs
// tests under tests/engine/** before any engine module exists. Every
// downstream plan's verification depends on `npx vitest run` working here.
describe('engine test harness', () => {
	it('runs (green-on-empty)', () => {
		expect(true).toBe(true);
	});

	// Web Crypto must be available in the test runtime — plan 03 (dice) draws
	// neutral entropy from crypto.getRandomValues (CLAUDE.md authority rule:
	// no Math.random). Confirm it exists now so the dice plan can rely on it.
	it('has Web Crypto for neutral dice entropy', () => {
		expect(typeof crypto.getRandomValues).toBe('function');
	});
});
