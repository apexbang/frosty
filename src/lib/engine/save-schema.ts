// save-schema.ts — the runtime SHAPE GATE at the IMPORT boundary (the SECOND
// untrusted input in v1, after the clipboard paste; SAVE-04 / V5 / D-05).
//
// A user-chosen `.frosty.json` is UNTRUSTED input crossing into the engine via
// `SaveStore.import`. This module is the security control: `v.safeParse` against an
// allow-list schema → a recoverable `Result`, NEVER a throw (T-04-01 DoS mitigation).
// `v.strictObject` at the TOP level hard-rejects hallucinated/extra keys (T-04-02
// Tampering); `schemaVersion` is REQUIRED + integer + non-negative so a missing or
// forged version fails validation before the D-05 migrate gate ever runs (T-04-03).
//
// It mirrors envelope-schema.ts EXACTLY, minus the fenced-block extraction — a save
// file is raw JSON, not prose-wrapped model output, so there is no fence to strip.
//
// PURITY (CORE-02): imports valibot (the ONE external dep the engine is allowed —
// the mandated shape validator) + a TYPE-ONLY import of SaveEnvelope. NO Svelte/idb.
// The `_typecheck` line reconciles the schema TO the canonical `SaveEnvelope`
// interface so `npm run check` fails on any schema/type drift (Pitfall 3/5).

import * as v from 'valibot';
import type { SaveEnvelope } from './save';
// Re-export the shared recoverable Result<T> rather than redefining it (it already
// lives in envelope-schema.ts and is the trust-boundary idiom this file reuses).
import type { Result } from './envelope-schema';
export type { Result };

/**
 * The on-disk schema version the engine currently writes (D-05). An imported save
 * with `schemaVersion < CURRENT` is migrated forward (Plan 03), `=== CURRENT` loads
 * directly, and `> CURRENT` is a recoverable {ok:false} (a save from a NEWER build
 * this code cannot understand). Single-sourced here so the Plan-03 D-05 gate imports
 * the same constant the writer stamps.
 */
export const CURRENT_SCHEMA_VERSION = 1 as const;

// ── Categorical enum-like primitives (single-sourced to events.ts shapes) ──────
// These mirror events.ts' StrengthBand / Morale / Phase / OutcomeBand literal sets.
// The `_typecheck` line at the bottom proves the inferred union stays assignable to
// SaveEnvelope, so widening any of these to a bare type would fail `npm run check`.

const StrengthBandSchema = v.picklist([0, 25, 50, 75, 100] as const);
const MoraleSchema = v.picklist(['steady', 'shaken', 'broken', 'routed'] as const);
const PhaseSchema = v.picklist([
	'planning',
	'engagement',
	'consolidation',
	'disengaging',
	'transit',
	'resupply',
	'recovery'
] as const);
const OutcomeBandSchema = v.picklist([
	'success_clean',
	'success_costly',
	'stalled',
	'failure'
] as const);

// ── GameEvent variants (mirror events.ts §6.3 — all 11 kinds, each carries turn) ─

const ModifierSchema = v.object({ label: v.string(), value: v.number() });

const GameEventSchema = v.variant('kind', [
	v.object({
		kind: v.literal('dice'),
		actor: v.string(),
		roll: v.tuple([v.number(), v.number()]),
		modifiers: v.array(ModifierSchema),
		net: v.number(),
		band: OutcomeBandSchema,
		turn: v.number()
	}),
	v.object({
		kind: v.literal('expend'),
		side: v.string(),
		actor: v.string(),
		item: v.string(),
		// AUTHORITY RULE (CR-01): an expend is a positive-integer DECREMENT (never zero,
		// negative, or fractional). A qty that could RAISE a consumable is unrepresentable
		// at this untrusted boundary — `remaining()` can only ever be lowered by an expend.
		qty: v.pipe(v.number(), v.integer(), v.minValue(1)),
		reason: v.optional(v.string()),
		turn: v.number()
	}),
	v.object({
		kind: v.literal('strength'),
		unit: v.string(),
		from: StrengthBandSchema,
		to: StrengthBandSchema,
		reason: v.string(),
		turn: v.number()
	}),
	v.object({
		kind: v.literal('morale'),
		unit: v.string(),
		from: MoraleSchema,
		to: MoraleSchema,
		turn: v.number()
	}),
	v.object({
		kind: v.literal('posture'),
		unit: v.string(),
		from: v.string(),
		to: v.string(),
		turn: v.number()
	}),
	v.object({
		kind: v.literal('reveal'),
		report: v.string(),
		resolvesTo: v.string(),
		confirmedBy: v.string(),
		turn: v.number()
	}),
	// AUTHORITY RULE (CR-01): a resupply RAISES a count by `to − from`, so `to >= from`
	// (a resupply never lowers a count — that would be an unlogged decrement disguised as
	// a raise), and both endpoints are non-negative integers. The object-level v.check
	// enforces the ordering after the per-field shape gates pass.
	v.pipe(
		v.object({
			kind: v.literal('resupply'),
			side: v.string(),
			item: v.string(),
			from: v.pipe(v.number(), v.integer(), v.minValue(0)),
			to: v.pipe(v.number(), v.integer(), v.minValue(0)),
			source: v.string(),
			turn: v.number()
		}),
		v.check((o) => o.to >= o.from, 'resupply cannot lower a count')
	),
	v.object({ kind: v.literal('destroyed'), unit: v.string(), turn: v.number() }),
	v.object({
		kind: v.literal('rejected'),
		actor: v.string(),
		action: v.string(),
		reason: v.string(),
		turn: v.number()
	}),
	v.object({ kind: v.literal('clock'), from: v.string(), to: v.string(), turn: v.number() }),
	v.object({ kind: v.literal('phase'), from: PhaseSchema, to: PhaseSchema, turn: v.number() }),
	// Phase 6 Slice A (UI-06): the display-only narrative event must be import-legal so a
	// save carrying persisted prose round-trips (export → import folds it back into narrativeLog).
	v.object({ kind: v.literal('narrative'), text: v.string(), turn: v.number() })
]);

// ── GameState (mirror state.ts §4 — built bottom-up) ───────────────────────────

const ManifestSchema = v.object({
	doctrine: v.string(),
	echelon: v.string(),
	organicAssets: v.array(v.string()),
	supportingAssets: v.array(v.string()),
	prohibited: v.array(v.string())
});

// AUTHORITY RULE (CR-01): the materialized snapshot view of expends carries the same
// positive-integer constraint as the `expend` event — a forged snapshot's `expended`
// view cannot encode a count-raising qty.
const ExpendEntrySchema = v.object({
	turn: v.number(),
	item: v.string(),
	qty: v.pipe(v.number(), v.integer(), v.minValue(1)),
	actor: v.string(),
	reason: v.string()
});

// AUTHORITY RULE (CR-01): the materialized resupply view mirrors the `resupply` event —
// non-negative integer endpoints with `to >= from` so a forged snapshot cannot disguise
// a decrement as a resupply.
const ResupplyEntrySchema = v.pipe(
	v.object({
		turn: v.number(),
		item: v.string(),
		from: v.pipe(v.number(), v.integer(), v.minValue(0)),
		to: v.pipe(v.number(), v.integer(), v.minValue(0)),
		source: v.string()
	}),
	v.check((o) => o.to >= o.from, 'resupply cannot lower a count')
);

const ConsumablesSchema = v.object({
	// AUTHORITY RULE (CR-01): a loadout count is a non-negative integer. Bands are already
	// tightly enforced via StrengthBandSchema; a bare-number loadout was the asymmetry that
	// let a forged/fractional/negative starting count cross the import boundary.
	loadout: v.record(v.string(), v.pipe(v.number(), v.integer(), v.minValue(0))),
	expended: v.array(ExpendEntrySchema),
	resupplied: v.array(ResupplyEntrySchema)
});

const SupplyLevelSchema = v.picklist(['high', 'med', 'low', 'none', 'na'] as const);

const UnitSupplySchema = v.object({
	ammo: SupplyLevelSchema,
	fuel: SupplyLevelSchema,
	rations: SupplyLevelSchema,
	medical: SupplyLevelSchema
});

const UnitSchema = v.object({
	id: v.string(),
	type: v.string(),
	strength: StrengthBandSchema,
	morale: MoraleSchema,
	supply: UnitSupplySchema,
	position: v.string(),
	posture: v.string(),
	status: v.array(v.string())
});

const SideSchema = v.object({
	id: v.string(),
	commander: v.picklist(['player', 'ai'] as const),
	objectives: v.array(v.string()),
	manifest: ManifestSchema,
	consumables: ConsumablesSchema,
	units: v.array(UnitSchema)
});

const IntelSchema = v.object({
	knows: v.record(v.string(), v.array(v.string())),
	unconfirmedReports: v.array(v.string())
});

const MetaSchema = v.object({
	campaignName: v.string(),
	turn: v.number(),
	clock: v.string(),
	weather: v.string(),
	terrain: v.string(),
	phase: PhaseSchema
});

const GameStateSchema = v.object({
	meta: MetaSchema,
	sides: v.array(SideSchema),
	intel: IntelSchema,
	graveyard: v.array(v.string()),
	// Phase 6 Slice A (UI-06): display-only narrative scrollback — admitted so an imported
	// snapshot's persisted prose is not stripped on the import boundary (the round-trip
	// identity test asserts importedState deep-equals sourceState, narrativeLog included).
	narrativeLog: v.array(v.object({ turn: v.number(), text: v.string() })),
	// Phase 13 (OBJ-04): display-only mission briefing — admitted via v.optional so a save WITH a
	// briefing round-trips (it is not stripped at the import boundary) AND a save WITHOUT one still
	// passes (the field is absent, NOT a reject — no schemaVersion bump). Mirrors how narrativeLog
	// is admitted. The nested shape MUST match state.ts GameState.briefing exactly (both optional,
	// hints itself optional) or the `_typecheck` reconciliation below fails npm run check.
	briefing: v.optional(
		v.object({
			situation: v.string(),
			victory: v.string(),
			defeat: v.string(),
			hints: v.optional(v.array(v.string()))
		})
	)
});

const SnapshotSchema = v.object({ turn: v.number(), state: GameStateSchema });

/**
 * The top-level allow-list. `v.strictObject` HARD-REJECTS any hallucinated extra
 * key at the top level (T-04-02 Tampering) — only the four known fields are admitted.
 * `schemaVersion` is REQUIRED + integer + non-negative (never v.optional — T-04-03):
 * a missing or forged version fails safeParse before the D-05 migrate gate runs.
 * Inner objects stay v.object (strip-unknown acceptable nested, per the analog).
 */
export const SaveEnvelopeSchema = v.strictObject({
	schemaVersion: v.pipe(v.number(), v.integer(), v.minValue(0)),
	campaignName: v.string(),
	// At least one snapshot is REQUIRED — an envelope with no base has nothing to fold over
	// (Phase 8 Open Question 2 / T-08-04 phantom-state guard). `minLength(1)` does not change
	// the inferred type (`Snapshot[]` either way), so the `_typecheck` reconciliation below
	// still compiles against SaveEnvelope.
	snapshots: v.pipe(v.array(SnapshotSchema), v.minLength(1)),
	events: v.array(GameEventSchema)
});

// Reconcile the schema with the hand-written interface — this line fails to compile
// if the schema and `SaveEnvelope` drift (every field/optional/literal must agree).
const _typecheck: SaveEnvelope = {} as v.InferOutput<typeof SaveEnvelopeSchema>;
void _typecheck;

// ── The raw-JSON safeParse → Result boundary (SAVE-04 / V5) ─────────────────────

/**
 * `validateSaveEnvelope(parsed)` — the TOTAL, non-throwing shape gate an uploaded
 * `.frosty.json` crosses before any use. The caller does `JSON.parse` in its own
 * try/catch (a malformed file is recoverable upstream); this function runs valibot
 * `safeParse` against the strictObject allow-list and joins any issues into ONE
 * human-readable error string. EVERY input returns a `Result`; it NEVER throws
 * (T-04-01). Mirrors `extractAndValidate` MINUS the fenced-block extraction (a save
 * file is raw JSON, not prose).
 */
export function validateSaveEnvelope(parsed: unknown): Result<SaveEnvelope> {
	const result = v.safeParse(SaveEnvelopeSchema, parsed);
	if (!result.success) {
		// v.flatten → { root?: string[], nested?: Record<dottedPath, string[]> }.
		// Join into ONE readable string (extra keys + wrong types both surface here).
		const flat = v.flatten<typeof SaveEnvelopeSchema>(result.issues);
		const msgs = [
			...(flat.root ?? []),
			...Object.entries(flat.nested ?? {}).map(
				([path, errs]) => `${path}: ${(errs ?? []).join(', ')}`
			)
		];
		return { ok: false, error: `The imported save had shape errors: ${msgs.join('; ')}` };
	}
	return { ok: true, value: result.output };
}
