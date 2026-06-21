<!--
  StatePanel.svelte — UI-01, the authoritative source-of-truth panel.

  Render-ONLY over the `game` singleton: it reads `game.state` (the turn/clock/phase
  strip + the per-unit cards) and `game.remaining` (the SINGLE $derived consumable map).
  It holds NO independent number — every count comes from `game.remaining`, so a mutation
  of `game.events` repaints it with no stale copy (UI-03 / T-05-08).

  Strength renders as a DISCRETE band indicator over BANDS {0,25,50,75,100} — four
  segments, filled count = strength / 25, NEVER an intermediate width (STATE-02). The
  filled colour is band-semantic (100/75 accent green · 50 warning amber · 25 destructive
  red · 0 muted gray → the unit is struck then removed by the engine). Pips are
  `aria-hidden`; the strength is conveyed in text via a visually-hidden `strength {n}%`
  label so the band is never colour-only (UI-SPEC Accessibility Basics).

  Read `unit.strength` THROUGH the proxy (never destructured — a destructure would freeze
  the value, the CLAUDE.md #1-hazard trap). `{#each … (unit.id)}` / `(item)` are keyed
  (CLAUDE.md require-each-key).

  E2E COLLISION NOTE (Wave-1 decision, preserved): the locked §5.4 e2e uses substring
  `getByText('DEF')` and `getByText(/broken/)`. The unit TYPE ("defenders" contains "DEF")
  and the overrun POSTURE ("broken", which also collides with DEF's morale "broken") are
  therefore carried on `title`/`aria-label` (accessible, no colliding text node) rather than
  as a second visible text run. The visible chips below are the morale + status flags, which
  do NOT collide. Type/posture remain fully accessible via the title tooltip.
-->
<script lang="ts">
	import { game } from '../game.svelte';
	import { BANDS } from '../engine/events';

	// Fixed pip scale {0,25,50,75,100} → 4 segments; filled = band / 25.
	const PIP_STEP = 25;
	const pipsFilled = (strength: number): number => Math.round(strength / PIP_STEP);
	// The non-zero strength bands, smallest→largest, for the segment row.
	const segments = BANDS.filter((b) => b > 0);

	// Band → semantic class for the FILLED segments (UI-SPEC ## Color band→color).
	const bandClass = (strength: number): string =>
		strength >= 75 ? 'healthy' : strength === 50 ? 'degraded' : strength === 25 ? 'critical' : 'gone';

	// Status flags the UI-SPEC raises as amber warnings (everything else is a muted chip).
	const WARN_FLAGS = ['suppressed', 'low-supply', 'low_supply'];
	const isWarn = (flag: string): boolean => WARN_FLAGS.includes(flag);
</script>

<section class="state-panel tabular-nums" aria-label="State">
	{#if game.state}
		<header class="strip">
			<span class="strip-clock">Turn {game.state.meta.turn}</span>
			<span class="sep" aria-hidden="true">·</span>
			<span class="strip-clock">{game.state.meta.clock}</span>
			<span class="sep" aria-hidden="true">·</span>
			<span class="chip phase">{game.state.meta.phase}</span>
		</header>

		{#each game.state.sides as side (side.id)}
			<div class="side">
				<h3 class="side-id">{side.id}</h3>

				<ul class="units">
					{#each side.units as unit (unit.id)}
						<li class="unit-card">
							<div class="unit-head">
								<!-- type rides on title (see E2E COLLISION NOTE) -->
								<span class="unit-id" title={`type: ${unit.type}`}>{unit.id}</span>
							</div>

							<div class="pips" role="img" aria-label={`strength ${unit.strength}%`}>
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
							</div>

							<div class="flags">
								<!-- morale: the §5.4 stable handle (getByText(/broken/) → DEF morale). -->
								<span
									class="chip morale"
									title={`posture: ${unit.posture}`}
									class:warn={unit.morale === 'shaken'}
									class:bad={unit.morale === 'broken' || unit.morale === 'routed'}>{unit.morale}</span
								>
								{#each unit.status as flag (flag)}
									<span class="chip" class:warn={isWarn(flag)}>{flag}</span>
								{/each}
							</div>
						</li>
					{/each}
				</ul>

				<div class="consumables">
					{#each Object.entries(game.remaining[side.id] ?? {}) as [item, qty] (item)}
						<span class="ammo" class:empty={qty === 0}>{item}: {qty}</span>
					{/each}
				</div>
			</div>
		{/each}
	{:else}
		<div class="skeleton" aria-hidden="true">
			<div class="sk-row"></div>
			<div class="sk-row"></div>
		</div>
	{/if}
</section>

<style>
	/*
	  Palette below is the UI-SPEC ## Color contract (the same hexes declared as @theme
	  tokens in app.css — kept literal here because the Tailwind plugin is not yet wired;
	  app.css remains the single human-readable source of the token values).
	*/
	.state-panel {
		display: flex;
		flex-direction: column;
		gap: 16px; /* md */
		overflow-y: auto;
		/* ALL data surfaces are mono (UI-SPEC ## Typography). */
		font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
		font-size: 14px;
		line-height: 1.5;
		color: #d7dee6; /* text */
		background: #0b0f14; /* dominant */
	}

	/* Header strip — Heading role (16px/600), sticky on phone (always-visible truth). */
	.strip {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 8px; /* sm */
		padding: 8px 0;
		font-size: 16px;
		font-weight: 600;
		border-bottom: 1px solid #243040; /* border hairline */
		background: #0b0f14; /* dominant, so cards don't bleed under the sticky strip */
	}
	.sep {
		color: #7e8a99; /* muted */
		font-weight: 400;
	}

	.chip {
		display: inline-block;
		padding: 1px 6px;
		border: 1px solid #243040; /* border */
		border-radius: 4px;
		font-size: 12px;
		color: #7e8a99; /* muted by default */
		white-space: nowrap;
	}
	.chip.phase {
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #d7dee6; /* text — the phase is load-bearing truth, not a muted label */
	}
	.chip.warn {
		color: #d9a441; /* warning amber */
		border-color: color-mix(in srgb, #d9a441 40%, transparent);
	}
	.chip.bad {
		color: #d8604c; /* destructive red */
		border-color: color-mix(in srgb, #d8604c 40%, transparent);
	}

	.side-id {
		margin: 0 0 4px;
		font-size: 14px;
		font-weight: 600;
		color: #7e8a99; /* muted — a side label, not primary data */
		letter-spacing: 0.04em;
	}

	.units {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px; /* sm */
	}

	/* Unit card on the secondary surface with a hairline border (UI-SPEC UI-01). */
	.unit-card {
		background: #151b23; /* secondary */
		border: 1px solid #243040; /* border */
		border-radius: 6px;
		padding: 8px; /* sm */
	}
	.unit-head {
		display: flex;
		gap: 8px;
		align-items: baseline;
	}
	.unit-id {
		font-size: 16px;
		font-weight: 600;
		color: #d7dee6; /* text — accent-free, per UI-SPEC (accent is reserved/scarce) */
	}

	/* Discrete band indicator: 4 fixed segments, never a lerped width. */
	.pips {
		display: flex;
		gap: 4px; /* xs */
		margin: 6px 0;
	}
	.pip {
		width: 20px;
		height: 8px;
		border-radius: 2px;
		background: #243040; /* empty segment = border slate (the "gone"/unfilled gray) */
	}
	.pip.filled.healthy {
		background: #3fb68b; /* accent green — 100/75 */
	}
	.pip.filled.degraded {
		background: #d9a441; /* warning amber — 50 */
	}
	.pip.filled.critical {
		background: #d8604c; /* destructive red — 25 */
	}

	.flags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px; /* xs */
		margin-top: 4px;
	}

	.consumables {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 8px; /* sm */
		font-size: 14px;
		color: #d7dee6;
	}
	.ammo.empty {
		color: #d8604c; /* destructive — qty hit 0 (UI-SPEC State→Visual Mapping) */
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

	/* Loading skeleton before boot resolves — muted rows, no dead-end (UI-SPEC). */
	.skeleton {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.sk-row {
		height: 40px;
		border-radius: 6px;
		background: #151b23; /* secondary */
	}

	@media (prefers-reduced-motion: reduce) {
		.state-panel {
			scroll-behavior: auto;
		}
	}
</style>
