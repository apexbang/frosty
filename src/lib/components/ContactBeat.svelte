<!--
  ContactBeat.svelte — FOG-03, the staged "contact!" banner.

  THE signal moment of a fog-reveal turn: the moment THIS turn produces one or more
  `reveal` events the banner stages a terse CONTACT alert ABOVE the panels (pinned by
  +page.svelte, never buried in the NarrativePanel paragraph — the whole point of FOG-03)
  and, on mobile, fires a short haptic pulse. The full reveal list lives in the CampaignLog.

  REACTIVITY (CLAUDE.md #1 hazard): the "did this turn reveal?" trigger is the bridge's
  `game.contactBeat` $derived signal — NEVER a stored $state boolean. The only local $state
  is `acknowledgedKey`: the identity of the contact the player dismissed, so a NEW contact
  (different sub-line/count) re-stages while a dismissed one stays hidden. `visible` is a
  pure $derived over (signal present) ∧ (not yet acknowledged) — no $state visible flag kept
  in sync (the prefer-writable-derived guardrail).

  SECURITY (T-06D-01): the reveal `resolvesTo` sub-line is rendered as ESCAPED text via
  `{beat.first}` interpolation — the raw-HTML render directive MUST NOT appear in this file.
  Injected markup appears as literal text, never executes.

  HAPTIC (T-06D-04): `navigator.vibrate?.([0, 60])` is feature-detected — an absent API on
  desktop is a silent no-op, never a crash.

  Tokens: binds the EXISTING Phase-5 palette/type/spacing values (no new tokens — UI-SPEC).
-->
<script lang="ts">
	import { game } from '../game.svelte';

	// The bridge's $derived trigger — { count, first } over THIS turn's reveal events.
	const beat = $derived(game.contactBeat);

	// A stable identity for the current contact so a NEW reveal re-stages but a dismissed
	// one stays hidden. Acknowledging stores this key; `visible` compares against it.
	const beatKey = $derived(beat.count > 0 ? `${beat.count}|${beat.first ?? ''}` : null);

	// The ONLY local $state — the dismissed contact's identity (never a "visible" boolean).
	let acknowledgedKey = $state<string | null>(null);

	// Pure derived visibility: a present, not-yet-acknowledged contact (no stored-derived).
	const visible = $derived(beatKey !== null && beatKey !== acknowledgedKey);

	// Fire the defensive mobile haptic exactly when a fresh contact stages (true→present
	// transition for a not-yet-seen key). $effect mirrors a side effect (vibration), not
	// reactive state — this is the sanctioned $effect use (an external side-effect), not a
	// derived-as-state. `navigator.vibrate?.(…)` is feature-detected (no desktop crash).
	let vibratedKey: string | null = null;
	$effect(() => {
		if (visible && beatKey !== null && beatKey !== vibratedKey) {
			vibratedKey = beatKey;
			navigator.vibrate?.([0, 60]);
		}
	});

	const acknowledge = (): void => {
		acknowledgedKey = beatKey;
	};
</script>

{#if visible}
	<section class="contact-beat" role="alert" aria-live="assertive" aria-label="Contact">
		<span class="glyph" aria-hidden="true">◉</span>
		<div class="copy">
			<div class="headline">CONTACT{beat.count > 1 ? ` ×${beat.count}` : ''}</div>
			{#if beat.first}
				<div class="subline">{beat.first}</div>
			{/if}
		</div>
		<button class="acknowledge" onclick={acknowledge}>Acknowledge</button>
	</section>
{/if}

<style>
	.contact-beat {
		display: flex;
		align-items: center;
		gap: 8px; /* sm */
		/* Intrinsic transient strip — 12px (sm+xs) block padding, md inline. */
		padding: 12px 16px;
		background: #151b23; /* secondary — the banner surface */
		/* The reserved accent: the "look here now" left- + top-rule (UI-SPEC ## Color). */
		border-top: 2px solid #3fb68b; /* accent */
		border-left: 4px solid #3fb68b; /* accent */
		color: #d7dee6; /* text */
	}

	/* The accent headline glyph — the single ◉ alert mark. */
	.glyph {
		color: #3fb68b; /* accent */
		font-size: 20px;
		line-height: 1;
		font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
	}

	.copy {
		display: flex;
		flex-direction: column;
		gap: 4px; /* xs — glyph-to-text register gap */
		flex: 1;
		min-width: 0;
	}

	/* Display register: mono 20/600, tight 1.2 line-height — terse alert. */
	.headline {
		font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
		font-size: 20px;
		font-weight: 600;
		line-height: 1.2;
		letter-spacing: 0.04em;
	}

	/* Caption register: mono 14/400 muted — the reveal sub-line (escaped text). */
	.subline {
		font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
		font-size: 14px;
		font-weight: 400;
		line-height: 1.4;
		color: #7e8a99; /* muted */
		/* Preserve the AI text verbatim without ever interpreting markup. */
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	/* ≥44px tap target (the single allowed spacing exception — mobile accessibility floor). */
	.acknowledge {
		min-height: 44px;
		min-width: 44px;
		padding: 0 16px; /* md */
		border: 1px solid #243040; /* border */
		border-radius: 6px;
		background: #0b0f14; /* dominant — the dismiss button is chrome, NEVER accent-filled */
		color: #d7dee6; /* text */
		font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
		font-size: 14px;
		cursor: pointer;
	}
	.acknowledge:focus-visible {
		outline: 2px solid #3fb68b; /* accent */
		outline-offset: 2px;
	}
</style>
