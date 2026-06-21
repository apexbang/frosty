<!--
  StatusStrip.svelte — UX-01/UX-02, the slim, always-visible per-side glance summary.

  The mobile shell's pinned top strip: a read-ONLY $derived projection of `game.state`
  (sides/units → pips + morale) and `game.remaining` (ONE key consumable per side). It is
  the summary that drills into the full StatePanel — the WHOLE strip is a single
  `aria-label="Open full unit state"` button that fires the parent-supplied `onopenstate`
  callback (the State sheet that consumes it lands in Plan 02).

  AUTHORITY (T-12-01-02): the strip holds NO independent number. Every value is read THROUGH
  the `game` proxy each render — strength from `unit.strength`, the key consumable from a
  $derived projection of `game.remaining[side.id]`. There is no edit affordance; it cannot
  touch the ledger (consumables only ever decrease via a logged expend, owned by the engine).

  BAND→PIP CONTRACT (do NOT fork): PIP_STEP/pipsFilled/segments/bandClass and the pip markup +
  the visually-hidden `strength {n}%` label are COPIED VERBATIM from StatePanel (the rule is
  already tested there — duplicating the numbers would fork the contract, so the identical
  logic + the same `BANDS` import is reused). Strength is conveyed in TEXT (the `.vh` label),
  never colour-only (UI-SPEC Accessibility); morale is a text chip, never colour-only.

  SECURITY (T-12-01-01): renders ONLY escaped `{interpolation}` — NEVER the raw-HTML render
  directive. AI/folded strings (side ids, unit ids, item names) appear as literal text, never
  executed.

  KEY-CONSUMABLE selection (D-03 / RESEARCH A3 — planner discretion): exactly ONE per side,
  the MOST-DEPLETED item by remaining qty (lowest `game.remaining[side][item]`; ties resolve
  to the first key in loadout order). A pure inline $derived projection of `game.remaining` —
  never a stored copy, never the full consumables list. Its qty is `game.remaining` (UI-SPEC
  line 136/239: `{item} {qty}`); `0` renders the destructive `.zero` class (authority made
  visible). Slim: one mono line of chips, horizontal scroll, never a second row (D-03).
-->
<script lang="ts">
	import { game } from '../game.svelte';
	import { BANDS } from '../engine/events';

	interface Props {
		/** Parent-supplied open-the-State-sheet callback (Plan 02 wires the sheet). */
		onopenstate?: () => void;
	}
	const { onopenstate }: Props = $props();

	// Fixed pip scale {0,25,50,75,100} → 4 segments; filled = band / 25.
	// COPIED VERBATIM from StatePanel (StatePanel.svelte:31-39) — the band→pip rule is the one
	// tested contract; reusing it identically (with the same BANDS import) keeps it unforked.
	const PIP_STEP = 25;
	const pipsFilled = (strength: number): number => Math.round(strength / PIP_STEP);
	const segments = BANDS.filter((b) => b > 0);
	const bandClass = (strength: number): string =>
		strength >= 75 ? 'healthy' : strength === 50 ? 'degraded' : strength === 25 ? 'critical' : 'gone';

	/**
	 * The ONE key consumable for a side: the most-depleted item by remaining qty (lowest
	 * `game.remaining[side.id][item]`; ties keep loadout order). A pure read of the folded
	 * `game.remaining` derive — no stored copy. Returns null only when the side has no
	 * consumables at all (a degenerate scenario), so the strip simply renders no chip.
	 */
	const keyConsumable = (sideId: string): { item: string; qty: number } | null => {
		const perItem = game.remaining[sideId];
		if (!perItem) return null;
		const items = Object.keys(perItem);
		if (items.length === 0) return null;
		let pick = items[0];
		for (const item of items) {
			if (perItem[item] < perItem[pick]) pick = item;
		}
		return { item: pick, qty: perItem[pick] };
	};

	/**
	 * OBJ-02 / CONTEXT D-02 — the ONE pinned current objective: the player-commanded
	 * side's `Side.objectives[0]`. A pure $derived read of already-folded state (mirrors
	 * `keyConsumable`'s compute-or-null projection and +page.svelte's player-side selector),
	 * NEVER a stored copy (the `remaining`-as-a-field anti-pattern is forbidden — the pinned
	 * line follows the same rule). Read through the `game` proxy, never destructure (CLAUDE.md
	 * #1 hazard). Returns null when there is no player side or it has no objectives → the
	 * strip renders NO pinned line (no placeholder cramping). The briefing is turn-0/static,
	 * so "current objective" is the FIRST authored objective for v1 (per-turn progression is
	 * deferred — CONTEXT D-02). The objective text renders ESCAPED via default interpolation
	 * — never the raw-HTML render directive (the ScenarioPicker/NarrativePanel discipline).
	 */
	const pinnedObjective = $derived.by((): string | null => {
		const player = game.state?.sides.find((s) => s.commander === 'player');
		const first = player?.objectives[0];
		return first ?? null;
	});
</script>

<button class="strip tabular-nums" aria-label="Open full unit state" onclick={onopenstate}>
	{#if pinnedObjective}
		<!--
		  OBJ-02 — the pinned current objective (player side objectives[0]). ONE mono line in
		  the strip's existing Body-data register, truncated with ellipsis (never wraps, never a
		  2nd row). The leading marker is aria-hidden decorative; the escaped objective TEXT is
		  the accessible content. Absent → this whole element is not rendered (no cramping).
		-->
		<span class="pinned-objective">
			<span class="marker" aria-hidden="true">▸</span>
			<span class="objective-text">{pinnedObjective}</span>
		</span>
	{/if}
	{#each game.state?.sides ?? [] as side (side.id)}
		{@const key = keyConsumable(side.id)}
		<span class="side">
			<span class="side-id">{side.id}</span>

			{#each side.units as unit (unit.id)}
				<span class="unit">
					<span class="unit-id">{unit.id}</span>
					<span class="pips" role="img" aria-label={`strength ${unit.strength}%`}>
						{#each segments as seg (seg)}
							<span
								class="pip"
								class:filled={pipsFilled(unit.strength) >= seg / PIP_STEP}
								class:healthy={pipsFilled(unit.strength) >= seg / PIP_STEP &&
									bandClass(unit.strength) === 'healthy'}
								class:degraded={pipsFilled(unit.strength) >= seg / PIP_STEP &&
									bandClass(unit.strength) === 'degraded'}
								class:critical={pipsFilled(unit.strength) >= seg / PIP_STEP &&
									bandClass(unit.strength) === 'critical'}
								aria-hidden="true"
							></span>
						{/each}
						<span class="vh">strength {unit.strength}%</span>
					</span>
					<span
						class="chip morale"
						class:warn={unit.morale === 'shaken'}
						class:bad={unit.morale === 'broken' || unit.morale === 'routed'}>{unit.morale}</span
					>
				</span>
			{/each}

			{#if key}
				<span class="key-consumable" class:zero={key.qty === 0}>{key.item} {key.qty}</span>
			{/if}
		</span>
	{/each}

	<span class="drill" aria-hidden="true">▸</span>
</button>

<style>
	/*
	  Palette is the UI-SPEC ## Color contract as LITERAL hexes (the same values declared as
	  tokens in app.css — kept literal here because the Tailwind plugin is not wired; app.css
	  stays the single human-readable source). The strip is data on the dominant surface with
	  semantic band colours only — NO accent chrome (healthy pips already carry accent under the
	  reused band rule). Slim ≤~56px: one mono line, horizontal scroll, never a second row.
	*/
	.strip {
		display: flex;
		align-items: center;
		gap: 16px; /* md — between side groups */
		width: 100%;
		min-height: 44px; /* tap target floor */
		padding: 8px 12px; /* sm vertical keeps it slim (≤~56px) */
		overflow-x: auto;
		white-space: nowrap;
		text-align: left;
		border: 0;
		border-bottom: 1px solid #243040; /* border hairline */
		background: #0b0f14; /* dominant */
		color: #d7dee6; /* text */
		/* ALL strip data is mono (UI-SPEC ## Typography). */
		font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
		font-size: 14px;
		line-height: 1.5;
		cursor: pointer;
	}
	.strip:focus-visible {
		outline: 2px solid #3fb68b; /* accent */
		outline-offset: 2px;
	}

	/*
	  OBJ-02 pinned current objective — ONE mono line in the strip's existing register
	  (inherits font-family 14/400/1.5 from .strip; UI-SPEC Typography Body — data). It
	  truncates to a single line with an ellipsis (never wraps, never a 2nd row), keeping the
	  strip slim. flex-shrink:0 so it does not collapse; max-width caps the measure so a long
	  objective ellipsizes rather than pushing the per-side chips off-screen.
	*/
	.pinned-objective {
		display: inline-flex;
		align-items: center;
		gap: 4px; /* xs — marker→text */
		flex: 0 0 auto;
		max-width: 22ch; /* readability cap; longer objectives ellipsize on one line */
		min-width: 0;
	}
	.pinned-objective .marker {
		color: #3fb68b; /* accent — the single one-char "current objective" marker (UI-SPEC Color 2) */
	}
	.pinned-objective .objective-text {
		color: #d7dee6; /* text — the objective stays text, never accent */
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.side {
		display: inline-flex;
		align-items: center;
		gap: 8px; /* sm */
	}
	.side-id {
		font-size: 16px;
		font-weight: 600;
		color: #7e8a99; /* muted — a side label at rest */
		letter-spacing: 0.04em;
	}

	.unit {
		display: inline-flex;
		align-items: center;
		gap: 4px; /* xs */
	}
	.unit-id {
		color: #d7dee6; /* text */
	}

	/* Discrete band indicator: 4 fixed segments, never a lerped width (reused rule). */
	.pips {
		display: inline-flex;
		gap: 4px; /* xs */
	}
	.pip {
		width: 12px;
		height: 6px;
		border-radius: 2px;
		background: #243040; /* empty segment = border slate */
	}
	.pip.filled.healthy {
		background: #3fb68b; /* accent green — 100/75 (existing band rule) */
	}
	.pip.filled.degraded {
		background: #d9a441; /* warning amber — 50 */
	}
	.pip.filled.critical {
		background: #d8604c; /* destructive red — 25 */
	}

	.chip.morale {
		padding: 0 4px;
		color: #7e8a99; /* muted by default */
	}
	.chip.morale.warn {
		color: #d9a441; /* warning amber — shaken */
	}
	.chip.morale.bad {
		color: #d8604c; /* destructive red — broken/routed */
	}

	.key-consumable {
		color: #d7dee6; /* text */
	}
	.key-consumable.zero {
		color: #d8604c; /* destructive — qty hit 0 (authority made visible) */
	}

	.drill {
		margin-left: auto;
		padding-left: 8px;
		color: #7e8a99; /* muted */
	}

	/* Visually-hidden but screen-reader-available strength text (colour is never sole signal). */
	.vh {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}
</style>
