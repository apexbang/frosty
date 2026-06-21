// size-turn.ts — stakes-to-payload sizing (DEPTH-02, spec §8/§7.1).
//
// `sizeTurn(state, order)` is a pure function returning `{ ruleModules, detail,
// stateSlice }` sized from CODE-KNOWN stakes — never positions (M4 deferred; RESEARCH
// A3). The detail tier is derived from three signals (spec §8): contesting actions in
// the order, live unconfirmed reports, and engagement phase + high enemy strength. The
// THRESHOLD VALUES below are TUNABLE named constants, not correctness invariants; the
// floor/ceiling discipline IS the invariant — a quiet patrol ships few/no modules and a
// terse slice; an engagement ships the relevant subset; and NO slice, at any tier, ever
// ships `narrativeLog` or `graveyard` (the §8 ceiling — not the whole campaign log).
//
// `composeSlice` FIELD-PICKS the allowed fields per tier (never spread-then-delete), so a
// future GameState field is excluded by DEFAULT — the structural guard against leaking
// narrativeLog/graveyard (RESEARCH Pattern 3, anti-pattern §"Spreading whole state").
//
// `detail` REUSES the narrator.ts TurnPayload union (do not redeclare) so
// `payload.detail = sized.detail` type-checks with no cast.
//
// PURE: no mutation, no stored field, no AI/narrative input, no Date.now /
// Math.random / crypto. NO Svelte / idb / valibot import (CLAUDE.md engine-purity
// rule, CORE-02).

import type { GameState } from './state';
import type { PlayerOrder } from './envelope';
import type { TurnPayload } from './narrator';
import { selectModules } from './rules/registry';

/** REUSE the narrator.ts detail union (do not redeclare it). */
export type DetailTier = TurnPayload['detail'];

/** spec §7.1/§8 — the sized turn payload sizeTurn produces. */
export interface SizedTurn {
	ruleModules: string[];
	detail: DetailTier;
	stateSlice: Partial<GameState>;
}

// ── TUNABLE thresholds (NOT correctness invariants — playtest/planner tunes) ────────
/** A contesting action commits a unit into contact (the §8 "in contact" proxy in M2). */
const CONTESTING_ACTIONS = ['assault', 'defend_fire', 'fire_support', 'break_contact', 'breach', 'defend'];
/** ≥ this many contesting actions in one order escalates to deep. */
const DEEP_CONTACT_COUNT = 2;
/** An AI unit at/above this band counts as "high enemy strength". */
const HIGH_ENEMY_BAND = 75;

/** Count the order's contesting actions (the "units in contact" proxy). */
function contactActionCount(order: PlayerOrder): number {
	return order.actions.filter((a) =>
		CONTESTING_ACTIONS.some((c) => a.actionType.toLowerCase().includes(c))
	).length;
}

/** Any AI-side unit at/above the high-strength band. */
function hasHighEnemyStrength(state: GameState): boolean {
	const enemy = state.sides.find((s) => s.commander === 'ai');
	return !!enemy && enemy.units.some((u) => u.strength >= HIGH_ENEMY_BAND);
}

/** Derive the detail tier from code-known stakes (spec §8). */
function selectTier(state: GameState, order: PlayerOrder): DetailTier {
	const inEngagement = state.meta.phase === 'engagement';
	const liveReports = state.intel.unconfirmedReports.length > 0;
	const contacts = contactActionCount(order);

	// deep: multiple units in contact, OR any live unconfirmed report, OR an engagement
	// against a strong enemy.
	const deep = contacts >= DEEP_CONTACT_COUNT || liveReports || (inEngagement && hasHighEnemyStrength(state));
	if (deep) return 'deep';

	// standard: limited contact — one contesting action, or simply being in engagement.
	if (contacts >= 1 || inEngagement) return 'standard';

	// light: no contact, simple action (patrol/move).
	return 'light';
}

/**
 * Field-PICK the bounded slice per tier. NEVER spreads `...state` (so a future field is
 * excluded by default) and NEVER includes `narrativeLog`/`graveyard` (the §8 ceiling).
 *
 *   - light:    meta + the player's own units + intel.knows (no live reports, no enemy internals)
 *   - standard: meta + both sides + full intel (limited contact)
 *   - deep:     meta + both sides + full intel (reports drive reveals; reproduces §5.4)
 */
function composeSlice(state: GameState, detail: DetailTier): Partial<GameState> {
	const meta = state.meta;

	if (detail === 'light') {
		return {
			meta,
			sides: state.sides.filter((s) => s.commander === 'player'),
			intel: { knows: state.intel.knows, unconfirmedReports: [] }
		};
	}

	// standard + deep both carry both sides + full intel.
	return { meta, sides: state.sides, intel: state.intel };
}

/**
 * `sizeTurn(state, order)` — the pure stakes-to-payload sizer. Picks the firing rule
 * modules (DEPTH-01), the detail tier, and the bounded state slice (DEPTH-02).
 */
export function sizeTurn(state: GameState, order: PlayerOrder): SizedTurn {
	const { ids } = selectModules(state, order);
	const detail = selectTier(state, order);
	return { ruleModules: ids, detail, stateSlice: composeSlice(state, detail) };
}
