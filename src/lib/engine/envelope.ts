// envelope.ts — the MoveEnvelope type CONTRACT (TS types ONLY in Phase 1).
//
// The AI's pasted output is shape-validated at the ClipboardNarrator boundary in
// Phase 3 (valibot). Here we establish only the TS *type shapes* (spec §5.1/§5.2)
// so later phases target a concrete contract. NO valibot, NO runtime schema, NO
// Svelte import (CLAUDE.md authority rule: the envelope is cosmetic over state —
// it has zero authority over the ledger).

import type { Morale } from './events';

/** A single action proposed/resolved by the model (spec §5.2). */
export interface ResolvedActionProposal {
	actor: string;
	side: string;
	actionType: string;
	target?: string;
	opposes?: string;
	capabilitiesUsed: string[];
	expend: { item: string; qty: number }[];
	proposedModifiers: { label: string; value: number }[];
	proposedOutcome?: {
		casualties?: { unit: string; deltaBand: number }[];
		moraleShift?: { unit: string; to: Morale }[];
		postureChange?: { unit: string; to: string }[];
		note?: string;
	};
	feasibilityNote?: string;
}

/** A fog-of-war reveal proposed by the model (spec §5.2; structure only in P1). */
export interface Reveal {
	report: string;
	resolvesTo: string;
	confirmedBy: string;
}

/** The full pasted move envelope the narrator returns (spec §5.2). */
export interface MoveEnvelope {
	narrative: string;
	playerActions: ResolvedActionProposal[];
	enemyActions: ResolvedActionProposal[];
	reveals: Reveal[];
}

/** A single parsed order action (spec §5.1). */
export interface OrderAction {
	actor: string;
	actionType: string;
	target?: string;
	capabilitiesUsed: string[];
	expend?: { item: string; qty: number }[];
}

/** The player's prose order plus its parsed actions (spec §5.1). */
export interface PlayerOrder {
	raw: string;
	actions: OrderAction[];
}
