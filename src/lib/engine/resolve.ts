// resolve.ts — the dice-driven ADJUDICATOR (the second half of the trust
// boundary, spec §6.3; DICE-04/05/06 + the EMIT halves of STATE-04 + FOG-02).
//
// validate.ts decided WHICH proposals are eligible; resolve.ts decides their
// NUMERIC effect within code-owned bounds and emits the turn's `GameEvent[]`. It
// never mutates state — `fold` (state.ts) is the single mutation path, so the
// emitted stream is the auditable, replay-equal record (CORE-03).
//
// The four authority guarantees this module enforces over the untrusted (but
// already-categorically-validated) `ResolvedActionProposal[]`:
//   1. SINGLE-ROLL CONTEST (DICE-04): `opposes`-linked actions resolve on ONE
//      neutral `roll()` in the INITIATOR's frame — only the initiator's
//      `proposedModifiers` reach the roller (the defender's mirrored modifiers are
//      surfaced upstream for transparency but NEVER re-added; doing so would
//      double-count, e.g. §5.4 net would become +2 not +1).
//   2. BOUNDED, DIRECTION-SANE DELTAS (DICE-05): each side's
//      `proposedOutcome.casualties[].deltaBand` is band-gated by `capDelta` —
//      negative-only (`Math.min(0, …)`, so a positive deltaBand can never raise
//      strength / resurrect), and a clean success can never heavily wound its own
//      winner. The cap REFUSES forbidden magnitudes; it never invents casualties.
//   3. CODE-DECIDED HAND-OFF (DICE-06): the engagement-end / `phase` flip is read
//      from POST-casualty strength thresholds — the AI `proposedOutcome.note` has
//      ZERO authority over it.
//   4. RETIRE-THE-DEAD / REVEAL EMIT (STATE-04 / FOG-02): a unit resolved to 0
//      strength gets a `destroyed` event emitted LAST among its events; each
//      `reveals[]` entry becomes one `reveal` event. (The reducer halves —
//      graveyard collapse + intel move — landed in Plan 02-03's `fold`.)
//
// PURE: no mutation of `state`; entropy enters ONLY via the injected `roller`
// (default the real `roll`) and is captured as a `dice` event BEFORE any fold, so
// the §5.4 `[3,4]` golden is reproducible and replay-equality holds. NO Svelte /
// idb / valibot import (CLAUDE.md engine-purity rule, CORE-02).

import type { GameState, StrengthBand, Morale } from './state';
import type { GameEvent, OutcomeBand } from './events';
import type { ResolvedActionProposal, Reveal } from './envelope';
import { roll } from './dice';
import { applyDeltaBand, fold } from './state';

/** The role a unit plays in a contest — its band-relative casualty cap differs. */
type Role = 'initiator' | 'opposer';

/**
 * The morale ladder ordered best→worst. `moraleRank` is the index, so a SMALLER
 * rank is steadier and a transition is an IMPROVEMENT iff it lowers the rank
 * (toward `steady`). Used by the WR-01 outcome-coherence guard to forbid the AI
 * from authoring a free morale recovery on a side that did not prevail.
 */
const MORALE_LADDER: Morale[] = ['steady', 'shaken', 'broken', 'routed'];
const moraleRank = (m: Morale): number => MORALE_LADDER.indexOf(m);

/**
 * Finding 3 — the REAL-loss casualties of an action: only `deltaBand < 0` entries.
 *
 * A `deltaBand >= 0` casualty is a no-op the engine drops BEFORE the roll decision
 * (capDelta would already clamp it to 0, but a positive/zero entry must never even
 * reach the roll — otherwise an unpaired no-loss action emits a cosmetic `dice` event
 * + a misleading band, the §5.4-MTR-style spurious roll). This mirrors the shipped
 * 05.2 `qty<=0` expend skip: a non-effect never produces an event.
 */
const realCasualties = (act: ResolvedActionProposal): { unit: string; deltaBand: number }[] =>
	(act.proposedOutcome?.casualties ?? []).filter((c) => c.deltaBand < 0);

/**
 * DICE-05 — bound a proposed `deltaBand` by the contest band and the actor's role.
 *
 * NEGATIVE-ONLY by construction: `Math.min(0, proposed)` means a positive deltaBand
 * is a no-op (no resurrection — strength rises only via a logged `resupply`, T-02-16).
 * Then the band gates the magnitude (RESEARCH Code Example 2, the direction-sanity
 * table). The cap is a magnitude REFUSAL, never a substitution — code never invents
 * casualties, it only declines to apply ones the band forbids (T-02-13):
 *
 *   success_clean  → initiator unharmed (0); opposer takes up to proposed (e.g. −3)
 *   success_costly → initiator ≤ −1;        opposer takes up to proposed   (§5.4: 1-1 −1, DEF −3)
 *   stalled        → both ≤ −1 (light losses, no objective change)
 *   failure        → initiator takes the heavy loss (proposed); opposer ≤ −1
 */
export function capDelta(band: OutcomeBand, role: Role, proposed: number): number {
	const d = Math.min(0, proposed); // negative-only — a positive deltaBand never raises strength
	if (band === 'success_clean') return role === 'initiator' ? 0 : d; // winner unharmed
	if (band === 'success_costly') return role === 'initiator' ? Math.max(d, -1) : d;
	if (band === 'stalled') return Math.max(d, -1); // light both sides
	/* failure */ return role === 'initiator' ? d : Math.max(d, -1); // initiator takes the heavy loss
}

/**
 * `resolveTurn(state, accepted, reveals, turn, roller?)` — adjudicate the turn's
 * already-validated actions into a `GameEvent[]` in the §5.4 canonical order.
 *
 * `accepted` is `validate(...).accepted` — resolve stays free of re-validation so
 * `validate` is the single categorical gate (the orchestrator, Phase 5, sequences
 * validate → resolveTurn; the §5.4 golden wires the same two calls). `reveals` is
 * `envelope.reveals`. `roller` (default the real `roll`) is the determinism seam.
 *
 * Emission order (matches the §5.4 fixture exactly):
 *   dice → strength → morale → posture → expend → clock → phase,
 *   with a unit's `destroyed` LAST among its events.
 *
 * Pure: never mutates `state`; returns events only.
 */
export function resolveTurn(
	state: GameState,
	accepted: ResolvedActionProposal[],
	reveals: Reveal[],
	turn: number,
	roller: typeof roll = roll
): GameEvent[] {
	// A working copy of unit strengths that advances as we apply each contest's
	// casualties, so the post-casualty threshold (DICE-06) reads resolved values and
	// chained contests in one turn see each other's losses. Mutates a LOCAL map only.
	const strength = new Map<string, StrengthBand>();
	// Current morale/posture so a `from` on the emitted event reflects real state
	// (the AI authors only the `to`; the `from` is code-owned, read from the unit).
	const moraleOf = new Map<string, Morale>();
	const postureOf = new Map<string, string>();
	for (const side of state.sides)
		for (const u of side.units) {
			strength.set(u.id, u.strength);
			moraleOf.set(u.id, u.morale);
			postureOf.set(u.id, u.posture);
		}
	// WR-03 — NEVER invent a phantom 100% for an id the engine has not seen. An
	// unknown id returns `undefined` (the casualty gate refuses it; the overrun check
	// reads `undefined <= 25` as false), instead of silently materializing a full-
	// strength unit and polluting the stream with a phantom `strength` event.
	const strengthOf = (id: string): StrengthBand | undefined => strength.get(id);

	// Resolved categorical events, accumulated in the canonical per-kind order.
	const diceEvents: GameEvent[] = [];
	const strengthEvents: GameEvent[] = [];
	const moraleEvents: GameEvent[] = [];
	const postureEvents: GameEvent[] = [];
	const expendEvents: GameEvent[] = [];
	const destroyedEvents: GameEvent[] = [];
	// Track kill order so a unit's `destroyed` is emitted after ALL its other events.
	const killed = new Set<string>();

	// The commander of each side, so the initiator tie-break can pick the
	// PLAYER-commanded (attacking) side explicitly rather than by lexical side-id
	// ordering ('BLUE' < 'RED'), which breaks for any side ids that do not sort
	// attacker-first (WR-02).
	const commanderOf = new Map(state.sides.map((s) => [s.id, s.commander]));
	const handled = new Set<ResolvedActionProposal>();

	// (1) Pair actions by mutual `opposes`; the player/attacker action is the initiator
	//     (RESEARCH A5; §5.4: 1-1 initiator, DEF opposer). Solo actions roll alone.
	for (const action of accepted) {
		if (handled.has(action)) continue;

		// WR-02 — resolve the opposing action SIDE-AWARE. `opposes` carries only an
		// actor id, and actor ids are not guaranteed unique across sides (a BLUE and a
		// RED unit may share one). A bare `byActor` map keyed on actor alone keeps only
		// the LAST such action and can bind a contest to the wrong proposal. Instead,
		// find the unhandled action on the OPPOSING side whose actor is the one this
		// action opposes AND which opposes this action back — a genuine mutual pair.
		const opposer = action.opposes
			? accepted.find(
					(a) =>
						!handled.has(a) &&
						a !== action &&
						a.side !== action.side &&
						a.actor === action.opposes &&
						a.opposes === action.actor
				)
			: undefined;
		// A true contest = a MUTUAL opposes pair across two sides.
		const isMutualPair = opposer !== undefined;

		// Decide which of the pair is the initiator: the PLAYER-commanded side attacks
		// (A5). Falls back to the original action only if neither side is player-commanded.
		let initiator = action;
		let defender = opposer;
		if (isMutualPair && opposer) {
			const actionIsPlayer = commanderOf.get(action.side) === 'player';
			const opposerIsPlayer = commanderOf.get(opposer.side) === 'player';
			const playerFirst = actionIsPlayer || !opposerIsPlayer;
			initiator = playerFirst ? action : opposer;
			defender = playerFirst ? opposer : action;
		}

		// A pure support / expend action — UNPAIRED and with no casualties to adjudicate
		// (e.g. §5.4's MTR fire_support: it suppresses + expends, but contests nothing) —
		// rolls NO dice. There is no contest to resolve, so emitting a roll would be a
		// spurious second `dice` event (§5.4 has exactly one). It still expends below.
		const hasCasualties = realCasualties(initiator).length > 0;
		if (!isMutualPair && !hasCasualties) {
			handled.add(action);
			continue;
		}

		// (2) ONE roll per contest — the INITIATOR's modifiers ONLY (Pitfall 2: the
		//     defender's mirrored modifiers are surfaced upstream, never re-added). clampNet
		//     (inside roll) bounds net to ±3. For a solo action this is its own roll.
		const dice = roller(initiator.actor, initiator.proposedModifiers, turn);
		diceEvents.push(dice);
		const band = dice.band;

		const sides: [ResolvedActionProposal, Role][] = isMutualPair && defender
			? [
					[initiator, 'initiator'],
					[defender, 'opposer']
				]
			: [[initiator, 'initiator']];

		// The genuine PARTICIPANTS of this contest, by the actor units actually engaged
		// (NOT by which proposal authored a casualty, and NOT merely by shared side).
		// The initiator's actor plays 'initiator'; the opposer's actor plays 'opposer'.
		// A casualty may only name one of these participant units — and its role is the
		// role of the unit it DAMAGES, not the proposal that authored it (CR-01). A
		// casualty naming any other unit — a side-mate that did not engage, an enemy not
		// in this pair, or an unknown id — is a non-participant the AI has no authority
		// to damage here: it is REFUSED, never applied, never defaulted to a phantom
		// 100% (CR-02 / WR-03). Restricting to actor units (rather than whole sides) is
		// what stops a solo action from reaching an uninvolved friendly unit.
		const participantRole = new Map<string, Role>();
		if (sideOwning(state, initiator.actor) !== undefined)
			participantRole.set(initiator.actor, 'initiator');
		if (isMutualPair && defender && sideOwning(state, defender.actor) !== undefined)
			participantRole.set(defender.actor, 'opposer');

		// (3a) CASUALTIES FIRST (both sides) — so the code-derived morale/posture below
		//      read the POST-casualty strength (an overrun opposer at ≤25% breaks).
		//      Each casualty is gated by the role of the unit it DAMAGES, not the proposal
		//      that authored it, so a losing side cannot wound the winner (CR-01) and an
		//      AI cannot reach a non-participant unit through the casualty channel (CR-02).
		for (const [act] of sides) {
			// Iterate REAL-loss casualties only (deltaBand < 0). A deltaBand >= 0 entry is a
			// no-op dropped pre-application (Finding 3) — it never produces a strength event.
			for (const c of realCasualties(act)) {
				const role = participantRole.get(c.unit);
				if (role === undefined) continue; // not a contest participant — refuse (CR-01/CR-02/WR-03)
				const from = strengthOf(c.unit);
				if (from === undefined) continue; // unknown id — never invent a phantom strength (WR-03)
				const delta = capDelta(band, role, c.deltaBand); // bound + direction-sane (DICE-05)
				const to = applyDeltaBand(from, delta); // snap + clamp, no resurrection (state.ts)
				if (to !== from) {
					strength.set(c.unit, to);
					strengthEvents.push({
						kind: 'strength',
						unit: c.unit,
						from,
						to,
						reason: `${act.actionType} casualties`,
						turn
					});
				}
				if (to === 0) killed.add(c.unit);
			}
		}

		// (3b) MORALE then POSTURE, in initiator→opposer order (the §5.4 canonical order:
		//      morale DEF, then posture 1-1, then posture DEF). The `to` may be AI-authored
		//      (proposedOutcome.moraleShift/postureChange — allowed narrative state) OR
		//      code-DERIVED from the contest outcome when the AI omits it. The `from` is
		//      always code-owned (read from current state); the AI never authors it.
		for (const [act, role] of sides) {
			const out = act.proposedOutcome;
			// Code-derived consequence of the band (§5.4): an overrun opposer (a unit that
			// prevailed against in a success_* contest and fell to ≤25%) breaks; the
			// prevailing initiator consolidates. These are categorical outcomes the AI
			// narrates but does not decide — emitted only when the AI did not author them.
			const won = band === 'success_clean' || band === 'success_costly';
			const actorStrength = strengthOf(act.actor); // undefined only for an unseen id (WR-03)
			const overrun = role === 'opposer' && won && actorStrength !== undefined && actorStrength <= 25;
			// WR-01 — outcome-coherence: a side PREVAILS only when the contest went its
			// way (the initiator on a success_*, the opposer on a failure; `stalled` is
			// no win for either). A side that did NOT prevail may not have an AI-authored
			// morale IMPROVEMENT (a free `broken → steady` recovery on a contest it lost):
			// such an authored shift is dropped, so the AI cannot rally a beaten unit by
			// prose. (Worsening shifts, and any shift on the prevailing side, pass through.)
			const prevailed = role === 'initiator' ? won : band === 'failure';

			const authoredMorale = new Map((out?.moraleShift ?? []).map((m) => [m.unit, m.to]));
			if (overrun && !authoredMorale.has(act.actor)) authoredMorale.set(act.actor, 'broken');
			for (const [unit, to] of authoredMorale) {
				const from = moraleOf.get(unit) ?? 'steady';
				// Refuse an AI-authored morale improvement for a non-prevailing side (WR-01).
				if (!prevailed && moraleRank(to) < moraleRank(from)) continue;
				if (from !== to) moraleEvents.push({ kind: 'morale', unit, from, to, turn });
				moraleOf.set(unit, to);
			}

			const authoredPosture = new Map((out?.postureChange ?? []).map((p) => [p.unit, p.to]));
			if (overrun && !authoredPosture.has(act.actor)) authoredPosture.set(act.actor, 'broken');
			if (role === 'initiator' && won && isMutualPair && !authoredPosture.has(act.actor))
				authoredPosture.set(act.actor, 'consolidating');
			for (const [unit, to] of authoredPosture) {
				const from = postureOf.get(unit) ?? '';
				if (from !== to) postureEvents.push({ kind: 'posture', unit, from, to, turn });
				postureOf.set(unit, to);
			}
		}

		handled.add(action);
		if (isMutualPair && opposer) handled.add(opposer);
	}

	// (4) One `expend` event per accepted expend entry — the ONLY decrement path.
	for (const action of accepted) {
		for (const e of action.expend) {
			expendEvents.push({
				kind: 'expend',
				side: action.side,
				actor: action.actor,
				item: e.item,
				qty: e.qty,
				turn
			});
		}
	}

	// (5) One `reveal` event per envelope.reveals[] entry (FOG-02 EMIT; the fold half
	//     moves the report unconfirmedReports → knows[confirmedBy], Plan 02-03).
	const revealEvents: GameEvent[] = reveals.map((r) => ({
		kind: 'reveal',
		report: r.report,
		resolvesTo: r.resolvesTo,
		confirmedBy: r.confirmedBy,
		turn
	}));

	// (6) `destroyed` LAST among a unit's events (STATE-04 EMIT). Emitted after all
	//     strength/morale/posture so fold still finds the unit for those (Pitfall 4).
	for (const unit of killed) destroyedEvents.push({ kind: 'destroyed', unit, turn });

	// (7) Advance the clock — exactly one `clock` event per turn (§5.4: D1 0700 → D1 0720).
	const clockEvents: GameEvent[] = [
		{ kind: 'clock', from: state.meta.clock, to: advanceClock(state.meta.clock), turn }
	];

	// (8) END CONDITION (DICE-06): project post-casualty strengths and decide the
	//     hand-off from CODE-owned thresholds — the AI `note` has zero authority. Fold the
	//     strength/destroyed events onto a working copy and evaluate per side.
	const phaseEvents = endConditionPhase(state, [...strengthEvents, ...destroyedEvents], turn);

	// Canonical emission order (matches the §5.4 fixture):
	//   dice → strength → morale → posture → reveal → expend → clock → phase, destroyed LAST per unit.
	// §5.4 has no destroyed (DEF ends at 25); when present, a unit's destroyed trails its events.
	return [
		...diceEvents,
		...strengthEvents,
		...moraleEvents,
		...postureEvents,
		...revealEvents,
		...expendEvents,
		...clockEvents,
		...phaseEvents,
		...destroyedEvents
	];
}

/**
 * Find the id of the side that OWNS `unit`, or `undefined` if no side does.
 *
 * This is the ownership lookup the casualty gate uses to decide a damaged unit's
 * contest role by WHO IT BELONGS TO — never by which proposal named it (CR-01) —
 * and to refuse a casualty naming a unit the engine has never seen (CR-02 / WR-03):
 * an unknown id returns `undefined`, which the caller treats as a non-participant
 * and skips, rather than silently inventing a 100%-strength phantom.
 */
function sideOwning(state: GameState, unit: string): string | undefined {
	for (const side of state.sides) if (side.units.some((u) => u.id === unit)) return side.id;
	return undefined;
}

/**
 * Advance the turn clock by one 20-minute step ('D<day> HHMM' → +20m, day rolls at
 * 2400). The §5.4 contract is `D1 0700 → D1 0720`. Pure string arithmetic — no Date.now.
 * A non-'D<day> HHMM' clock is passed through unchanged (defensive; never throws).
 */
function advanceClock(clock: string): string {
	const m = /^D(\d+)\s+(\d{2})(\d{2})$/.exec(clock);
	if (!m) return clock;
	let day = Number(m[1]);
	let mins = Number(m[2]) * 60 + Number(m[3]) + 20;
	if (mins >= 24 * 60) {
		mins -= 24 * 60;
		day += 1;
	}
	const hh = String(Math.floor(mins / 60)).padStart(2, '0');
	const mm = String(mins % 60).padStart(2, '0');
	return `D${day} ${hh}${mm}`;
}

/**
 * DICE-06 — code-decided engagement hand-off. Fold the turn's strength/destroyed
 * events onto a working copy, then for each side evaluate the post-casualty threshold:
 * a side whose every live committed unit is below ~50% (≤ 25%) has effectively broken
 * contact → emit a `phase` event (engagement → consolidation). The AI `note` is ignored.
 *
 * Returns at most one `phase` event (none if no side has broken, or the phase is not
 * an active `engagement`). Pure: folds onto a clone, reads strengths, returns events.
 */
function endConditionPhase(state: GameState, casualtyEvents: GameEvent[], turn: number): GameEvent[] {
	if (state.meta.phase !== 'engagement') return [];
	const projected = fold(state, casualtyEvents); // post-casualty working copy (clone, never mutates state)

	const sideBroken = projected.sides.some((side) => {
		if (side.units.length === 0) return true; // all units destroyed → broken contact
		return side.units.every((u) => u.strength <= 25);
	});

	if (!sideBroken) return [];
	return [{ kind: 'phase', from: state.meta.phase, to: 'consolidation', turn }];
}
