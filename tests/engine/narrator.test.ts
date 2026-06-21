// narrator.test.ts — the Narrator transport SEAM (NARR-01/02).
//
// `Narrator` is the Promise-based interface every transport implements (PROJECT.md
// Key Decision: Promise-based so the M4 ApiNarrator is a pure drop-in). v1 ships the
// ClipboardNarrator: build a prompt → the player pastes the AI's JSON back →
// submitPaste settles the run() Promise. This suite locks:
//   - NARR-01 — a MockNarrator implements the interface and resolves with envelope_5_4
//     (so the whole engine is unit-testable with the narrator mocked).
//   - NARR-02 — ClipboardNarrator exposes a non-empty prompt, submitPaste(valid) → run()
//     resolves to the envelope, and submitPaste(garbage) → { ok:false } while run()
//     stays PENDING (the bad paste is recoverable / re-pasteable, never a crash).
//
// RED until src/lib/engine/narrator.ts AND src/lib/engine/prompt.ts are written. It
// MUST fail because those modules cannot be resolved — not a fixture/syntax error.
//
// PURITY: imports only the narrator + prompt modules and the shared §5.4 fixture.

import { describe, test, expect } from 'vitest';
import type { Narrator, TurnPayload } from '../../src/lib/engine/narrator';
import { ClipboardNarrator } from '../../src/lib/engine/narrator';
import { buildPrompt } from '../../src/lib/engine/prompt';
import { envelope_5_4 } from './fixtures/worked-example-5.4';

// ── NARR-01: the mocked narrator satisfies the interface ───────────────────────
describe('NARR-01 — mocked narrator', () => {
	class MockNarrator implements Narrator {
		async run(_p: TurnPayload) {
			return envelope_5_4;
		}
	}

	test('MockNarrator.run resolves to the canned §5.4 envelope', async () => {
		const env = await new MockNarrator().run({} as TurnPayload);
		expect(env.playerActions).toHaveLength(2);
		expect(env.enemyActions[0].actor).toBe('DEF');
	});
});

// ── NARR-02: the clipboard deferred-promise round-trip ─────────────────────────
describe('NARR-02 — clipboard round-trip', () => {
	test('a valid paste settles run(); a garbage paste leaves it pending and re-pasteable', async () => {
		const narrator = new ClipboardNarrator(buildPrompt);

		// run() starts the deferred round-trip; do NOT await yet — the Promise is
		// pending until the player pastes a valid envelope.
		const pending = narrator.run({} as TurnPayload);

		// The prompt the player copies is a non-empty string.
		expect(typeof narrator.prompt).toBe('string');
		expect(narrator.prompt.length).toBeGreaterThan(0);

		// A garbage paste is rejected WITHOUT settling the Promise (recoverable UX).
		const bad = narrator.submitPaste('garbage not json');
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(typeof bad.error).toBe('string');

		// A valid paste settles the Promise and reports ok.
		const good = narrator.submitPaste(JSON.stringify(envelope_5_4));
		expect(good.ok).toBe(true);

		const env = await pending;
		expect(env.playerActions).toHaveLength(2);
		expect(env.enemyActions[0].actor).toBe('DEF');
	});
});
