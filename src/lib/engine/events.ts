// events.ts — the GameEvent discriminated union (the LEAF of the engine graph).
//
// This module imports NOTHING (no Svelte, no state.ts) so the dependency graph
// stays acyclic: both state.ts (which consumes events via `fold`) and the future
// resolve.ts (which produces events, Phase 2) depend on this union. To keep it a
// true leaf, the small enum-like primitives the event union needs
// (StrengthBand / Morale / Phase / OutcomeBand) live here and are re-exported
// from state.ts (CITED: RESEARCH "Project Structure" — events.ts is a leaf split
// from state.ts; CLAUDE.md engine-purity rule — no framework imports).

/** Strength is a band, never a fine percentage (spec §4.3; CLAUDE.md authority rule). */
export const BANDS = [0, 25, 50, 75, 100] as const;
export type StrengthBand = (typeof BANDS)[number];

/** Unit morale ladder (spec §4). */
export type Morale = 'steady' | 'shaken' | 'broken' | 'routed';

/** Engagement phase (spec §4). */
export type Phase =
	| 'planning'
	| 'engagement'
	| 'consolidation'
	| 'disengaging'
	| 'transit'
	| 'resupply'
	| 'recovery';

/** The four contest outcome bands read from `2d6 + net` (spec §6.3). */
export type OutcomeBand = 'success_clean' | 'success_costly' | 'stalled' | 'failure';

/**
 * The GameEvent discriminated union — the ONLY input that may mutate state via
 * `fold`. All 11 kinds from spec §6.3, each carrying `turn: number` (CORE-06) so
 * the per-turn boundary is segmentable for M3 undo and replay (CITED: spec §6.3,
 * RESEARCH Pitfall 4). No event may rename a unit id (STATE-05 invariant).
 */
export type GameEvent =
	| {
			kind: 'dice';
			actor: string;
			roll: [number, number];
			modifiers: { label: string; value: number }[];
			net: number;
			band: OutcomeBand;
			turn: number;
	  }
	| {
			kind: 'expend';
			side: string;
			actor: string;
			item: string;
			qty: number;
			reason?: string;
			turn: number;
	  }
	| {
			kind: 'strength';
			unit: string;
			from: StrengthBand;
			to: StrengthBand;
			reason: string;
			turn: number;
	  }
	| { kind: 'morale'; unit: string; from: Morale; to: Morale; turn: number }
	| { kind: 'posture'; unit: string; from: string; to: string; turn: number }
	| {
			kind: 'reveal';
			report: string;
			resolvesTo: string;
			confirmedBy: string;
			turn: number;
	  }
	| {
			kind: 'resupply';
			side: string;
			item: string;
			from: number;
			to: number;
			source: string;
			turn: number;
	  }
	| { kind: 'destroyed'; unit: string; turn: number }
	| { kind: 'rejected'; actor: string; action: string; reason: string; turn: number }
	| { kind: 'clock'; from: string; to: string; turn: number }
	| { kind: 'phase'; from: Phase; to: Phase; turn: number }
	// Phase 6 Slice A (UI-06): the AI's prose as a STORED, replay-equal, display-only
	// event. It folds into state.narrativeLog with ZERO ledger authority (mirrors the
	// graveyard string arm) — prose can never mint or alter categorical/ledger state.
	| { kind: 'narrative'; text: string; turn: number };
