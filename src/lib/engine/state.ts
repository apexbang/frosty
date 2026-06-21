// state.ts — the full typed state model + the ONE mutation path (`fold`).
//
// State is the fold of events (spec §4.1): the authority is
// (latest snapshot) + (events since). `fold` is a pure, total, deterministic,
// ordered left-fold; `applyEvent` is an exhaustive switch over GameEvent.kind
// with a `never` default (a missed kind is a COMPILE error, not a silent no-op).
//
// PURITY (CORE-03): no Date.now / Math.random / crypto is reachable from
// applyEvent or fold — all non-determinism is captured AS events (dice, clock)
// before fold. fold never mutates the input snapshot (clone-then-mutate per step)
// so replay-equality holds.
//
// NO Svelte / idb / valibot import (CLAUDE.md engine-purity rule, CORE-02).

import type { GameEvent } from './events';
import { BANDS } from './events';
import type { StrengthBand, Morale, Phase } from './events';

// Re-export the small enum-like primitives so consumers can import them from the
// state module (events.ts owns them to keep the graph acyclic — events.ts is the
// leaf that imports nothing).
export { BANDS };
export type { StrengthBand, Morale, Phase, GameEvent };

// ── State types (spec §4) — pure data, no behavior ──────────────────────────

export type SupplyLevel = 'high' | 'med' | 'low' | 'none' | 'na';

export interface Manifest {
	doctrine: string;
	echelon: string;
	organicAssets: string[];
	supportingAssets: string[];
	prohibited: string[];
}

export interface ExpendEntry {
	turn: number;
	item: string;
	qty: number;
	actor: string;
	reason: string;
}

/**
 * The snapshot-time materialized view of a `resupply` event — the ONLY path that may
 * RAISE a consumable count (CLAUDE.md authority rule). `fold` materializes these so a
 * loaded/folded state carries the raise the same way `expended` carries the decrement;
 * `boot()` reconstructs `resupply` GameEvents from this view so `ledgerRemaining`
 * (already resupply-aware) derives identically post-reload. from/to are NUMBERS.
 */
export interface ResupplyEntry {
	turn: number;
	item: string;
	from: number;
	to: number;
	source: string;
}

/**
 * Consumables carries `loadout`, the materialized `expended` view, AND the materialized
 * `resupplied` view — there is deliberately NO `remaining` field (LEDGER-02 by
 * construction). `remaining(item)` is a derived query over the event stream (ledger.ts),
 * never a stored value that could drift. Both `expended` and `resupplied` are rebuilt by
 * `fold` from their respective events, never hand-edited.
 */
export interface Consumables {
	loadout: Record<string, number>;
	expended: ExpendEntry[];
	resupplied: ResupplyEntry[];
}

export interface UnitSupply {
	ammo: SupplyLevel;
	fuel: SupplyLevel;
	rations: SupplyLevel;
	medical: SupplyLevel;
}

export interface Unit {
	/** IMMUTABLE — applyEvent never renames/renumbers a unit id (STATE-05). */
	id: string;
	type: string;
	strength: StrengthBand;
	morale: Morale;
	supply: UnitSupply;
	position: string;
	posture: string;
	status: string[];
}

export interface Side {
	id: string;
	commander: 'player' | 'ai';
	objectives: string[];
	manifest: Manifest;
	consumables: Consumables;
	units: Unit[];
}

/** Fog-of-war STRUCTURE (FOG-01) — presence only in Phase 1; reveal BEHAVIOR is Phase 2. */
export interface Intel {
	knows: Record<string, string[]>;
	unconfirmedReports: string[];
}

export interface Meta {
	campaignName: string;
	turn: number;
	clock: string;
	weather: string;
	terrain: string;
	phase: Phase;
}

export interface GameState {
	meta: Meta;
	sides: Side[];
	intel: Intel;
	graveyard: string[];
	/**
	 * Phase 6 Slice A (UI-06) — the turn-tagged narrative scrollback, DISPLAY-ONLY with
	 * ZERO ledger authority (exactly like `graveyard`'s string entries). Folded from
	 * `narrative` GameEvents; NO resolver / ledger / derive path may read it (the authority
	 * invariant). Persists with the rest of state, so prose survives a save→load round-trip.
	 */
	narrativeLog: { turn: number; text: string }[];
	/**
	 * Phase 13 (OBJ-04) — a DISPLAY-ONLY mission briefing with ZERO ledger authority, the third
	 * member of the additive zero-authority family after `graveyard` and `narrativeLog`. It is
	 * SEED-AUTHORED (carried on a turn-0 scenario / save), NEVER folded from an event: there is
	 * NO `briefing` case in `applyEvent`, and NO resolver / ledger / derive / `validateSeed` path
	 * reads it. It is `?:` OPTIONAL — unlike `narrativeLog` — so a briefing-less seed plus the
	 * load boot-default work WITHOUT a `schemaVersion` bump (the field is simply absent). The
	 * shape is locked by CONTEXT D-01 and reconciled against `GameStateSchema` (save-schema.ts)
	 * via the `_typecheck` guard. Win/lose prose only — the engine never detects victory/defeat.
	 */
	briefing?: {
		situation: string;
		victory: string;
		defeat: string;
		hints?: string[];
	};
}

// ── Banded-strength arithmetic ──────────────────────────────────────────────

/**
 * Map a band + an integer band-step count to a snapped, clamped band.
 * deltaBand is the integer count of 25-pt bands (negative on the casualty path).
 * Clamps to [0,100] — never negative, never off-band (STATE-02).
 *
 *   applyDeltaBand(100, -1) === 75   (the §5.4 1-1 result)
 *   applyDeltaBand(100, -3) === 25   (the §5.4 DEF redline)
 *   applyDeltaBand(25,  -3) === 0    (clamped at 0, never negative)
 *
 * The delta DECISION (deltaBand → from/to) is Phase 2's resolver; Phase 1
 * provides + tests this helper so the §5.4 numbers are locked (RESEARCH Pattern 4).
 */
export function applyDeltaBand(from: StrengthBand, deltaBand: number): StrengthBand {
	const idx = BANDS.indexOf(from);
	const next = Math.max(0, Math.min(BANDS.length - 1, idx + deltaBand));
	return BANDS[next];
}

// ── The reducer ─────────────────────────────────────────────────────────────

/** Find a unit by immutable id across all sides (read-only lookup). */
function findUnit(state: GameState, id: string): Unit | undefined {
	for (const side of state.sides) {
		const u = side.units.find((unit) => unit.id === id);
		if (u) return u;
	}
	return undefined;
}

/**
 * Apply ONE event to state, returning a fresh state (clone-then-mutate so the
 * input is never mutated — replay-equality depends on it). Pure, total, and
 * exhaustive: the `never` default makes a new GameEvent kind a compile error.
 *
 * NO Date.now / Math.random / crypto here (CORE-03). 'destroyed'/'reveal' are
 * STRUCTURAL only in Phase 1 — graveyard-collapse (STATE-04) and reveal behavior
 * (FOG-02) are Phase 2.
 */
export function applyEvent(state: GameState, event: GameEvent): GameState {
	// Structural clone keeps fold pure: the input snapshot is never mutated, so
	// `fold(base, events)` leaves `base` byte-identical (replay-equality).
	const next: GameState = structuredClone(state);

	// Per-turn boundary (CORE-06): every event carries `turn`; meta.turn tracks the
	// highest turn seen so the stream is segmentable for M3 undo. Monotonic — an
	// event never rewinds the clock counter.
	if (event.turn > next.meta.turn) next.meta.turn = event.turn;

	switch (event.kind) {
		case 'dice':
			// The dice event is the captured roll/modifiers/net/band — an audit
			// record. It does not itself mutate categorical state here.
			break;

		case 'expend': {
			// Append an itemized ExpendEntry to the materialized view. The derived
			// `remaining(item)` (ledger.ts) sums these — only path that decrements.
			const side = next.sides.find((s) => s.id === event.side);
			if (side) {
				side.consumables.expended.push({
					turn: event.turn,
					item: event.item,
					qty: event.qty,
					actor: event.actor,
					reason: event.reason ?? ''
				});
			}
			break;
		}

		case 'strength': {
			// event.to is a pre-snapped band produced upstream (Phase 2 resolver).
			// Phase 1 simply assigns it; the invariant tests assert it is a band
			// and is monotonic-except-resupply (STATE-02 / STATE-03).
			const unit = findUnit(next, event.unit);
			if (unit) unit.strength = event.to;
			break;
		}

		case 'morale': {
			const unit = findUnit(next, event.unit);
			if (unit) unit.morale = event.to;
			break;
		}

		case 'posture': {
			const unit = findUnit(next, event.unit);
			if (unit) unit.posture = event.to;
			break;
		}

		case 'reveal': {
			// FOG-02: resolve an unconfirmed report into durable intel. Drop the
			// report from `unconfirmedReports` and append `resolvesTo` to the
			// confirming side's `knows[]` (creating the bucket if absent). Avoid
			// duplicating an already-known fact. Writes go through `next` only.
			next.intel.unconfirmedReports = next.intel.unconfirmedReports.filter(
				(report) => report !== event.report
			);
			const known = (next.intel.knows[event.confirmedBy] ??= []);
			if (!known.includes(event.resolvesTo)) known.push(event.resolvesTo);
			break;
		}

		case 'resupply': {
			// The ONLY event that may raise a count. Materialize a ResupplyEntry into the
			// side's `resupplied` view (mirrors the expend case) so a save→load round-trip
			// carries the raise: `boot()` reconstructs a `resupply` GameEvent from this and
			// the derived ledger query (ledger.ts, resupply-aware) sums (to − from). Writes
			// go through `next` only; no stored `remaining` to mutate.
			const side = next.sides.find((s) => s.id === event.side);
			if (side) {
				side.consumables.resupplied.push({
					turn: event.turn,
					item: event.item,
					from: event.from,
					to: event.to,
					source: event.source
				});
			}
			break;
		}

		case 'destroyed': {
			// STATE-04: retire the dead. Keep the structural status marker, then
			// collapse the unit out of play — remove it from its owning side's
			// `units` and push a one-line audit entry to `next.graveyard`. Removing
			// it from `units` is what makes the alive gate (validate.ts) reject any
			// later action naming it ("cannot act next turn" needs no extra code).
			// If the unit is already gone (a re-folded stream), this is a no-op —
			// never throw (T-02-11: graveyard preserves the auditable trace once).
			const unit = findUnit(next, event.unit);
			if (unit && !unit.status.includes('destroyed')) unit.status.push('destroyed');
			const owner = next.sides.find((s) => s.units.some((u) => u.id === event.unit));
			if (owner) {
				owner.units = owner.units.filter((u) => u.id !== event.unit);
				next.graveyard.push(`destroyed: ${event.unit} (${owner.id})`);
			}
			break;
		}

		case 'rejected':
			// A rejected action changes NO state (the authority-leak guard: the AI's
			// proposal had no effect). Recorded in the event log for audit only.
			break;

		case 'clock':
			next.meta.clock = event.to;
			break;

		case 'phase':
			next.meta.phase = event.to;
			break;

		case 'narrative':
			// Phase 6 Slice A: push the AI's prose to the display-only scrollback — mirrors
			// the `destroyed` graveyard.push discipline (a string view, never read by the
			// ledger/resolver/derive). ZERO authority: prose cannot mint categorical state.
			next.narrativeLog.push({ turn: event.turn, text: event.text });
			break;

		default: {
			// Exhaustiveness: a new GameEvent kind that is not handled above is a
			// COMPILE error here (CORE-03 totality guarantee). At RUNTIME, an unknown
			// kind — reachable once schemaVersion folds an older/newer stream forward
			// (Phase 4 migration) — must fail LOUD rather than return a non-GameState
			// object that every subsequent applyEvent would build corrupt state on.
			const _exhaustive: never = event;
			throw new Error(`fold: unhandled GameEvent kind: ${(_exhaustive as GameEvent).kind}`);
		}
	}

	return next;
}

/**
 * THE TRUTH. State is the left-fold of events over a base snapshot (spec §4.1).
 * Pure, deterministic, ordered. `fold(base, [])` returns a clone equal to base;
 * `fold` never mutates `base`.
 */
export function fold(base: GameState, events: GameEvent[]): GameState {
	return events.reduce(applyEvent, base);
}
