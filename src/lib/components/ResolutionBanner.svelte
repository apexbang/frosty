<!--
  ResolutionBanner.svelte — UI-05, the transient "show your work" beat.

  On a resolve the banner stages a glanceable collapsed strip — `{band} · roll {d1} {d2} ·
  net {±n} ⤢` — and is tappable to expand the full `dice` event (the DiceConfirmPanel
  itemized-modifier projection). It is ADDITIVE over the EXISTING `game.lastResolution`
  data — no new engine field. The full detail always also remains in the persistent
  DiceConfirmPanel below; this banner is a transient highlight, not the only home.

  REACTIVITY (CLAUDE.md #1 hazard) — cloned VERBATIM from ContactBeat's staging discipline:
    - `res`  is a $derived TRIGGER over `game.lastResolution` (never a stored boolean).
    - `key`  is a $derived identity `${band}|${d1}${d2}|${net}` (RESEARCH Pattern 4) so a
      NEW resolution re-stages while a dismissed/undone one stays hidden.
    - `acknowledgedKey` is the ONLY local reactive $state (the dismissed resolution's id).
    - `visible` is a PURE $derived over (present) ∧ (not yet acknowledged) — NEVER a $state
      visible flag kept in sync (the prefer-writable-derived guardrail).
    After undo `game.lastResolution` is null (Plan 03 / OQ#2) so `key` is null and the banner
    derives hidden — no stale/dropped resolution shown.

  NON-GATING (the UI-05 core, D-04): this component NEVER reads or writes the turn machine.
  The player can start the next order while it is staged; it auto-dismisses on the next
  order start (lastResolution clears to null). `aria-live="polite"` — a resolution is
  informational, not consequential-blocking (vs ContactBeat's assertive).

  SECURITY (T-07-04-01): AI-supplied band + modifier labels render as ESCAPED text via
  `{value}` interpolation — the raw-HTML render directive MUST NOT appear in this file.
  Injected markup appears as literal text, never executes.

  MOTION: honors `prefers-reduced-motion` — the banner appears/dismisses instantly (no
  slide/fade); no timer is stored anywhere.

  Tokens: binds the EXISTING Phase-5 palette/type/spacing values (no new tokens — UI-SPEC),
  reusing the ContactBeat surface + the DiceConfirmPanel band-colour rule exactly.
-->
<script lang="ts">
	import { game } from '../game.svelte';

	const signed = (n: number): string => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

	// The bridge's $derived TRIGGER — this turn's resolution, or null after undo / next start.
	const res = $derived(game.lastResolution);

	// A stable identity for the current resolution so a NEW one re-stages but a dismissed /
	// undone one stays hidden. Null when there is no resolution (post-undo) → banner hidden.
	const key = $derived(res ? `${res.band}|${res.roll[0]}${res.roll[1]}|${res.net}` : null);

	// The ONLY local reactive $state — the dismissed resolution's identity (never "visible").
	let acknowledgedKey = $state<string | null>(null);

	// Pure derived visibility: a present, not-yet-acknowledged resolution (no stored-derived).
	const visible = $derived(key !== null && key !== acknowledgedKey);

	// The expand toggle — plain UI state local to the banner (the full dice projection). The
	// banner stages COLLAPSED (one terse mono line: band · roll · net · ⤢ — UI-SPEC line 139);
	// a tap expands the itemized modifier list (the full "show your work" dice projection).
	let expanded = $state(false);

	const acknowledge = (): void => {
		acknowledgedKey = key;
	};

	const toggleExpand = (): void => {
		expanded = !expanded;
	};
</script>

{#if visible && res}
	<section class="resolution-banner" aria-live="polite" aria-label="Turn resolution">
		<button
			class="strip mono"
			type="button"
			aria-expanded={expanded}
			aria-label="Resolution — tap for detail"
			onclick={toggleExpand}
		>
			<span
				class="band"
				class:good={res.band === 'success_clean' || res.band === 'success_costly'}
				class:bad={res.band === 'failure'}>{res.band}</span
			>
			<span class="sep" aria-hidden="true">·</span>
			<span class="roll">roll <span class="tabular-nums">{res.roll[0]} {res.roll[1]}</span></span>
			<span class="sep" aria-hidden="true">·</span>
			<span class="net">net <span class="tabular-nums">{signed(res.net)}</span></span>
			<span class="expand-glyph" aria-hidden="true">⤢</span>
		</button>

		{#if !expanded}
			<p class="hint muted">Tap for detail</p>
		{:else}
			<ul class="modifiers mono" aria-label="Modifiers">
				{#each res.modifiers as m (m.label)}
					<li>
						<span class="label">{m.label}</span>
						<span class="val tabular-nums">{signed(m.value)}</span>
					</li>
				{/each}
			</ul>
		{/if}

		<button class="acknowledge mono" type="button" onclick={acknowledge}>Dismiss</button>
	</section>
{/if}

<style>
	.resolution-banner {
		display: flex;
		flex-direction: column;
		gap: 8px; /* sm */
		padding: 12px 16px; /* (sm+xs) block, md inline — mirrors ContactBeat */
		background: #151b23; /* secondary — the transient banner surface */
		/* The reserved accent: the "look here now" left + top rule (UI-SPEC ## Color). */
		border-top: 2px solid #3fb68b; /* accent */
		border-left: 4px solid #3fb68b; /* accent */
		color: #d7dee6; /* text */
	}

	/* The collapsed strip is the tappable expand control (≥44px tap target). */
	.strip {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		min-height: 44px;
		width: 100%;
		padding: 0;
		border: none;
		background: none;
		color: inherit;
		font-size: 16px;
		line-height: 1.2;
		text-align: left;
		cursor: pointer;
	}
	.strip:focus-visible {
		outline: 2px solid #3fb68b; /* accent */
		outline-offset: 2px;
	}

	.mono {
		font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
	}
	.tabular-nums {
		font-variant-numeric: tabular-nums;
	}
	.muted {
		color: #7e8a99; /* muted */
	}
	.sep {
		color: #7e8a99; /* muted */
	}

	/* Band label — the DiceConfirmPanel colour rule, copied EXACTLY (UI-SPEC line 188). */
	.band {
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: #7e8a99; /* stalled → muted (default) */
	}
	.band.good {
		color: #3fb68b; /* success_* → accent green */
	}
	.band.bad {
		color: #d8604c; /* failure → destructive */
	}

	.expand-glyph {
		margin-left: auto;
		color: #3fb68b; /* accent */
		font-size: 18px;
		line-height: 1;
	}

	.hint {
		margin: 0;
		font-size: 12px; /* xs caption */
	}

	/* The expanded full dice projection — itemized modifiers (escaped text). */
	.modifiers {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.875rem;
	}
	.modifiers li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}
	.label {
		/* Preserve the AI label verbatim without ever interpreting markup. */
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	/* ≥44px tap target (the mobile accessibility floor). Chrome, never accent-filled. */
	.acknowledge {
		align-self: flex-start;
		min-height: 44px;
		min-width: 44px;
		padding: 0 16px; /* md */
		border: 1px solid #243040; /* border */
		border-radius: 6px;
		background: #0b0f14; /* dominant — the dismiss button is chrome */
		color: #d7dee6; /* text */
		font-size: 14px;
		cursor: pointer;
	}
	.acknowledge:focus-visible {
		outline: 2px solid #3fb68b; /* accent */
		outline-offset: 2px;
	}

	/* Reduced motion: there is no transition to suppress (instant appear/dismiss by design),
	   but pin the contract explicitly so future additions cannot regress it (UI-SPEC). */
	@media (prefers-reduced-motion: reduce) {
		.resolution-banner {
			transition: none;
		}
	}
</style>
