// narrator.ts — the TRANSPORT SEAM: the `Narrator` interface + `TurnPayload`
// (spec §7.1, verbatim) and the v1 `ClipboardNarrator` (NARR-01/02/03).
//
// `Narrator.run(payload): Promise<MoveEnvelope>` is the swap seam: v1 ships the
// ClipboardNarrator (copy a prompt → the player pastes the AI's JSON back), and
// M4's `ApiNarrator` is a literal drop-in that `await fetch`es instead — no engine
// call-site changes (PROJECT.md Key Decision: Promise-based so M4 is a pure swap).
//
// The genuinely-new idiom is the DEFERRED PROMISE: `run()` returns a Promise but
// CAPTURES its resolve/reject so a much-later, external event (the player's paste,
// possibly minutes later after leaving the app) settles it. `submitPaste(raw)`
// delegates SHAPE validation to `extractAndValidate` (envelope-schema.ts, total /
// non-throwing) and returns a recoverable `Result`: a bad paste is `{ok:false}`
// and the turn Promise stays PENDING (re-pasteable, NARR-03 / T-03-09) — it is
// NEVER thrown and NEVER rejected on bad input. Only `cancel()` rejects.
//
// PURITY: type-only sibling imports + the envelope-schema boundary; NO Svelte/idb/
// valibot (CORE-02). The captured `resolve` is CALLED BY a Svelte paste handler in
// Phase 5, but the engine never IMPORTS Svelte — the seam is one-directional.

import type { GameState } from './state';
import type { MoveEnvelope, PlayerOrder } from './envelope';
import { extractAndValidate } from './envelope-schema';

/** spec §7.1 — everything one turn hands the model (state slice + rules + order). */
export interface TurnPayload {
	state: GameState;
	rules: string;
	order: PlayerOrder;
	detail: 'light' | 'standard' | 'deep';
}

/** spec §7.1 — the swap seam; M4 `ApiNarrator` implements the SAME contract. */
export interface Narrator {
	run(_payload: TurnPayload): Promise<MoveEnvelope>;
	/**
	 * OPTIONAL re-paste re-arm seam (CR-02 / Design A). The ClipboardNarrator implements
	 * it to clear the one-turn-in-flight guard without settling the outer Promise, so
	 * `runTurn`'s adjust loop can re-fire `run()`. A transport with no human-in-the-loop
	 * re-paste (e.g. an auto-resolving mock or a future ApiNarrator) may omit it; the
	 * orchestrator only calls it on the decline branch, which such transports never hit.
	 */
	resetForRepaste?(): void;
}

/**
 * The v1 transport: a human-in-the-loop deferred-promise round-trip.
 *
 * `run()` stashes the copyable `prompt` and returns a Promise whose resolver it
 * captures; the UI later calls `submitPaste(raw)` with the AI's reply, which
 * settles that Promise from the validated envelope. A bad paste is recoverable
 * (returns `{ok:false}`, Promise stays pending); only `cancel()` rejects.
 */
export class ClipboardNarrator implements Narrator {
	/** The prompt string the UI displays for copy — (re)set on each `run()`. */
	prompt = '';

	/** Captured resolver/rejecter of the in-flight turn's Promise (deferred). */
	private pending: { resolve: (_e: MoveEnvelope) => void; reject: (_r: Error) => void } | null =
		null;

	/** The injected prompt builder (DI, exactly like resolve.ts injects its `roller`). */
	private buildPrompt: (_p: TurnPayload) => string;

	/**
	 * Inject the prompt builder so the transport stays decoupled from prompt-string
	 * construction and both halves test independently.
	 */
	constructor(buildPrompt: (_p: TurnPayload) => string) {
		this.buildPrompt = buildPrompt;
	}

	/**
	 * Start a turn: build + stash the prompt, return a Promise whose resolver is
	 * captured for `submitPaste` to settle later. Guards ONE turn in flight — a
	 * second `run()` while a paste is pending rejects (T-03-10: prevents an
	 * in-flight envelope being overwritten / confused).
	 */
	run(payload: TurnPayload): Promise<MoveEnvelope> {
		if (this.pending) return Promise.reject(new Error('a paste is already pending'));
		this.prompt = this.buildPrompt(payload);
		return new Promise<MoveEnvelope>((resolve, reject) => {
			this.pending = { resolve, reject };
		});
	}

	/**
	 * Called by the UI paste handler with the raw pasted string. Delegates SHAPE
	 * validation to `extractAndValidate` (total, non-throwing). On `!ok` it returns
	 * `{ok:false, error}` WITHOUT clearing `pending` or rejecting — the turn Promise
	 * stays pending so the player can re-paste (NARR-03, Pitfall 1 / T-03-09). On
	 * `ok` it clears `pending` and settles the Promise. NEVER throws, NEVER rejects
	 * the Promise on bad input.
	 */
	submitPaste(raw: string): { ok: true } | { ok: false; error: string } {
		if (!this.pending) return { ok: false, error: 'no turn awaiting a paste' };

		const result = extractAndValidate(raw);
		if (!result.ok) return { ok: false, error: result.error };

		const { resolve } = this.pending;
		this.pending = null;
		resolve(result.value);
		return { ok: true };
	}

	/**
	 * Clear the one-turn-in-flight guard WITHOUT settling the outer Promise — the adjust
	 * (re-paste) re-arm seam (CR-02 / Design A). Unlike `cancel()` (the only reject path),
	 * this neither resolves nor rejects: `runTurn`'s loop re-fires `run()`, which would
	 * otherwise hit the `'a paste is already pending'` guard; nulling `pending` here lets
	 * that re-fired `run()` install a FRESH deferred Promise so a corrected paste can settle
	 * the new gate. The previously-awaited Promise stays pending forever (the loop has moved
	 * on to a new one) — never settled, so #applyResult does not fire on the aborted iteration.
	 */
	resetForRepaste(): void {
		this.pending = null;
	}

	/** The ONLY path that rejects the in-flight turn Promise — the player abandons it. */
	cancel(reason = 'cancelled'): void {
		this.pending?.reject(new Error(reason));
		this.pending = null;
	}
}
