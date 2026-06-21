// envelope-schema.ts — the runtime SHAPE GATE at the ClipboardNarrator boundary
// (the FIRST half of the trust boundary, spec §5.2/§7.1; NARR-02/NARR-03).
//
// An UNTRUSTED string pasted from any AI crosses into the engine HERE. This module
// is the security control for the only untrusted input in v1 (V5 Input Validation,
// ASVS L1): forgiving fenced-block extraction → `JSON.parse` in try/catch → valibot
// `safeParse` allow-list. It NEVER throws and NEVER reaches state — a bad paste is a
// recoverable `Result`, never a crash (CLAUDE.md: "Treat a bad paste as recoverable
// UX, never a crash").
//
// SCOPE: valibot validates SHAPE ONLY. The categorical/numeric gates (alive,
// capability, cumulative-consumable, ±3 clamp, band bounds) already live in the
// Phase 2 `validate.ts`/`resolve.ts` and are NOT duplicated here (Pitfall 4). Shape
// validation COMPOSES with that downstream gate; it does not replace it.
//
// PURITY: Imports valibot (the ONE engine module that does — the mandated shape
// validator, CLAUDE.md); NO Svelte/idb. The schema reconciles TO the canonical
// `MoveEnvelope` interface via the `_typecheck` line (it never replaces it) so
// `npm run check` fails on any schema/type drift (Pitfall 3/5).

import * as v from 'valibot';
import type { MoveEnvelope } from './envelope';
import type { Morale } from './events';

// ── Nested schemas, built bottom-up to mirror envelope.ts exactly ─────────────

/** `{ item, qty }` — a single consumable spend (envelope.ts ResolvedActionProposal). */
const ExpendSchema = v.object({ item: v.string(), qty: v.number() });

/** `{ label, value }` — a single proposed modifier (clamped pre-roll downstream). */
const ModifierSchema = v.object({ label: v.string(), value: v.number() });

// The Morale picklist — `to` here is the categorical Morale ladder, NOT a free
// string (Pitfall 5 asymmetry). The literal list is single-sourced from events.ts;
// the `_morale` annotation below proves it stays in lock-step with the `Morale`
// type so widening this to `v.string()` would fail `npm run check`.
const MORALE_VALUES = ['steady', 'shaken', 'broken', 'routed'] as const;
const _morale: Morale = MORALE_VALUES[0];
void _morale;

const ProposedOutcomeSchema = v.object({
	casualties: v.optional(v.array(v.object({ unit: v.string(), deltaBand: v.number() }))),
	// moraleShift[].to is Morale → v.picklist (NOT v.string — Pitfall 5).
	moraleShift: v.optional(v.array(v.object({ unit: v.string(), to: v.picklist(MORALE_VALUES) }))),
	// postureChange[].to is a FREE string → v.string (correct here — the asymmetry).
	postureChange: v.optional(v.array(v.object({ unit: v.string(), to: v.string() }))),
	note: v.optional(v.string())
});

const ResolvedActionProposalSchema = v.object({
	actor: v.string(),
	side: v.string(),
	actionType: v.string(),
	target: v.optional(v.string()),
	opposes: v.optional(v.string()),
	capabilitiesUsed: v.array(v.string()),
	expend: v.array(ExpendSchema),
	proposedModifiers: v.array(ModifierSchema),
	proposedOutcome: v.optional(ProposedOutcomeSchema),
	feasibilityNote: v.optional(v.string())
});

const RevealSchema = v.object({
	report: v.string(),
	resolvesTo: v.string(),
	confirmedBy: v.string()
});

/**
 * The top-level allow-list. `v.strictObject` at the TOP LEVEL hard-rejects any
 * hallucinated extra key (success-criterion-2 / T-03-03) — only the four known
 * fields are admitted; an unknown key fails `safeParse` rather than being silently
 * stripped. Inner objects stay `v.object` (strip-unknown is acceptable nested).
 */
export const MoveEnvelopeSchema = v.strictObject({
	narrative: v.string(),
	playerActions: v.array(ResolvedActionProposalSchema),
	enemyActions: v.array(ResolvedActionProposalSchema),
	reveals: v.array(RevealSchema)
});

// Reconcile the schema with the hand-written interface — this line fails to
// compile if the schema and `MoveEnvelope` drift (Pitfall 3/5: the Morale/posture
// asymmetry and every optional/required field must agree).
const _typecheck: MoveEnvelope = {} as v.InferOutput<typeof MoveEnvelopeSchema>;
void _typecheck;

// ── The forgiving extract → parse → safeParse boundary (NARR-02/NARR-03) ──────

/**
 * The recoverable outcome of crossing the trust boundary. A bad paste is `ok:false`
 * with a human-readable `error` the UI surfaces as a re-paste affordance — never a
 * thrown exception (CLAUDE.md: "Treat a bad paste as recoverable UX, never a crash").
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Pull the FIRST ```json … ``` block out of a (possibly prose-wrapped) paste and
 * return it trimmed; if there is NO fence, fall back to the whole string trimmed
 * (Pitfall 2 — chatty models sometimes omit the fence). This is the only step that
 * touches the raw paste shape; it makes no validity claim.
 */
export function extractFencedJson(raw: string): string {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
	return (fenced ? fenced[1] : raw).trim();
}

/**
 * `extractAndValidate(raw)` — the single, TOTAL path untrusted text takes before it
 * can reach `validate`: forgiving fenced extraction → `JSON.parse` (in try/catch, so
 * a malformed/partial paste returns `{ok:false}` rather than throwing — T-03-02 DoS
 * mitigation) → valibot `safeParse` against the strictObject allow-list. EVERY input
 * (including `''` and pure garbage) returns a `Result`; this function never throws.
 *
 * SHAPE ONLY — the categorical/numeric gates remain Phase 2's `validate.ts` (T-03-06).
 */
export function extractAndValidate(raw: string): Result<MoveEnvelope> {
	const candidate = extractFencedJson(raw);

	let parsed: unknown;
	try {
		parsed = JSON.parse(candidate);
	} catch {
		return {
			ok: false,
			error: 'That paste was not valid JSON. Copy the AI’s json block and paste again.'
		};
	}

	const result = v.safeParse(MoveEnvelopeSchema, parsed);
	if (!result.success) {
		// v.flatten → { root?: string[], nested?: Record<dottedPath, string[]> }.
		// Join into ONE readable string (extra keys + wrong types both surface here).
		const flat = v.flatten<typeof MoveEnvelopeSchema>(result.issues);
		const msgs = [
			...(flat.root ?? []),
			...Object.entries(flat.nested ?? {}).map(([path, errs]) => `${path}: ${(errs ?? []).join(', ')}`)
		];
		return { ok: false, error: `The pasted move had shape errors: ${msgs.join('; ')}` };
	}

	return { ok: true, value: result.output };
}
