<!--
  BriefingCard.svelte — OBJ-01 / OBJ-03: the turn-0 mission-briefing surface and its
  on-demand recall twin. ONE card, two entry points — +page.svelte auto-opens it at turn 0
  and re-opens it via the log-sheet "?" affordance (the host owns the open/closed $state;
  this card renders + fires `onclose`).

  READ-PROJECTION (CLAUDE.md #1 hazard / 13-PATTERNS): reads `game.state?.briefing` and the
  `commander === 'player'` side's `Side.objectives[]` THROUGH the `game` proxy — NEVER
  destructure (a destructured snapshot would freeze the value and miss proxy updates). The two
  donor patterns: CampaignLog's escaped read-projection + placeholder discipline, and
  ScenarioPicker's keyed escaped objectives list. Chrome (Close ✕ + focus-on-mount +
  return-to-trigger) mirrors BottomSheet.

  SECURITY CONTRACT (T-13-05, carry-forward from CampaignLog/ScenarioPicker/NarrativePanel):
  briefing/objective/hint text originates from an UNTRUSTED AI paste. EVERY string renders as
  ESCAPED `{value}` interpolation — the raw-HTML render directive MUST NOT appear anywhere in
  this file. Injected markup appears as literal text, never executes.

  Section order (UI-SPEC D-01): SITUATION → OBJECTIVES → VICTORY → DEFEAT → HINTS (HINTS last,
  only when authored). VICTORY label = accent (#3fb68b), DEFEAT label = destructive (#d8604c) —
  the one semantic color pairing, TEXT-backed (the literal words), never color-only. A missing
  situation/victory/defeat string renders a muted `—` placeholder, never a crash.

  States (UI-SPEC State→Visual Mapping):
    full       — briefing present → all sections render.
    fallback   — no briefing but player objectives present → objectives + a muted
                 "No briefing provided for this scenario." line.
    suppressed — no briefing AND no objectives → render nothing (the host should not mount it;
                 the card guards defensively).

  Tokens are the literal-hex twins of app.css :root (the StatusStrip/BottomSheet convention,
  NOT var(--…)). NO new token / size / weight / color is introduced (UI-SPEC strict-extension).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { game } from '../game.svelte';

	// The host owns the open/closed $state; the card just renders and fires close.
	const { onclose }: { onclose: () => void } = $props();

	// Read through the proxy — NEVER destructure (CLAUDE.md #1 hazard). Functions (not stored
	// values) keep the read live so a state swap re-renders. Defensive `?.` mirrors CampaignLog's
	// upstream-default discipline (a state could still be mid-boot).
	const briefing = (): GameStateBriefing | undefined => game.state?.briefing;
	const playerObjectives = (): string[] =>
		game.state?.sides.find((s) => s.commander === 'player')?.objectives ?? [];

	// The scenario name as a muted subtitle when available (read through the proxy).
	const scenarioName = (): string | undefined => game.state?.meta.campaignName;

	// SUPPRESSED guard (defensive — the host should not mount this when both are absent):
	// nothing to show when there is neither a briefing nor any player objective.
	const hasContent = (): boolean => briefing() !== undefined || playerObjectives().length > 0;

	// HINTS render only when the briefing carries a non-empty hints array (CONTEXT D-03).
	const hints = (): string[] => {
		const b = briefing();
		return b?.hints && b.hints.length > 0 ? b.hints : [];
	};

	// Focus management mirrors BottomSheet: focus moves INTO the card on mount and returns to the
	// trigger (the CTA / the "?" recall) on close. A sanctioned external DOM side-effect, NOT a
	// derived-as-state. The card is NON-MODAL — this is a focus MOVE, never a focus trap.
	let cardEl = $state<HTMLElement | null>(null);
	onMount(() => {
		const trigger = document.activeElement as HTMLElement | null;
		cardEl?.focus();
		return () => trigger?.focus?.();
	});
</script>

<script module lang="ts">
	import type { GameState } from '../engine/state';
	// The display-only briefing shape (locked by CONTEXT D-01 / state.ts). Derived from the
	// canonical GameState type so this file never re-declares the contract.
	type GameStateBriefing = NonNullable<GameState['briefing']>;
</script>

{#if hasContent()}
	<!-- NON-MODAL labeled section (UI-SPEC Accessibility): a real aria-label, a real Close button
	     and a Dismiss button. tabindex=-1 so focus can move in on open without making the card a
	     tab stop. It must NOT trap focus (non-blocking — the Phase-12 "confirm/dice is the only
	     modal" rule). -->
	<section
		bind:this={cardEl}
		class="briefing-card"
		aria-label="Mission briefing"
		tabindex="-1"
	>
		<header class="card-head">
			<div class="titles">
				<h2 class="card-title">Mission briefing</h2>
				{#if scenarioName()}
					<p class="subtitle">{scenarioName()}</p>
				{/if}
			</div>
			<button class="close" aria-label="Close briefing" onclick={onclose}>✕</button>
		</header>

		<div class="body">
			{#if briefing()}
				{@const b = briefing()}
				<!-- SITUATION -->
				<section class="block">
					<h3 class="label">SITUATION</h3>
					{#if b?.situation}
						<p class="prose">{b.situation}</p>
					{:else}
						<p class="prose missing">—</p>
					{/if}
				</section>

				<!-- OBJECTIVES (the player side's Side.objectives[] — single source of truth) -->
				{#if playerObjectives().length > 0}
					<section class="block">
						<h3 class="label">OBJECTIVES</h3>
						<ul class="objectives">
							{#each playerObjectives() as objective, i (i)}
								<li class="prose">{objective}</li>
							{/each}
						</ul>
					</section>
				{/if}

				<!-- VICTORY — accent label, text-color prose body -->
				<section class="block">
					<h3 class="label victory">VICTORY</h3>
					{#if b?.victory}
						<p class="prose">{b.victory}</p>
					{:else}
						<p class="prose missing">—</p>
					{/if}
				</section>

				<!-- DEFEAT — destructive label, text-color prose body -->
				<section class="block">
					<h3 class="label defeat">DEFEAT</h3>
					{#if b?.defeat}
						<p class="prose">{b.defeat}</p>
					{:else}
						<p class="prose missing">—</p>
					{/if}
				</section>

				<!-- HINTS — only when authored (CONTEXT D-03) -->
				{#if hints().length > 0}
					<section class="block">
						<h3 class="label">HINTS</h3>
						<ul class="hints">
							{#each hints() as hint, i (i)}
								<li class="prose">{hint}</li>
							{/each}
						</ul>
					</section>
				{/if}
			{:else}
				<!-- FALLBACK — no briefing but player objectives present: surface the objectives plus a
				     muted "no briefing" line (objectives still surface; OBJ-05). -->
				<section class="block">
					<h3 class="label">OBJECTIVES</h3>
					<ul class="objectives">
						{#each playerObjectives() as objective, i (i)}
							<li class="prose">{objective}</li>
						{/each}
					</ul>
				</section>
				<p class="prose missing fallback-line">No briefing provided for this scenario.</p>
			{/if}
		</div>

		<div class="dismiss-row">
			<button class="dismiss" onclick={onclose}>Dismiss briefing</button>
		</div>
	</section>
{/if}

<style>
	/* Tokens are the literal-hex twins of app.css :root (the StatusStrip/BottomSheet convention) —
	   NO new token / size / weight / color (UI-SPEC strict-extension). */
	.briefing-card {
		display: flex;
		flex-direction: column;
		gap: 16px; /* md — section break between head/body/dismiss */
		/* Cap the readable measure at ~66ch so the situation paragraph stays readable; centered
		   within the column on desktop (the --prose-measure readability cap, NOT a spacing step). */
		max-width: 66ch;
		margin: 0 auto;
		box-sizing: border-box;
		padding: 16px; /* md — card content padding */
		background: #151b23; /* secondary — the card surface */
		border: 1px solid #243040; /* border */
		border-radius: 8px;
		color: #d7dee6; /* text */
	}
	.briefing-card:focus {
		/* Programmatic focus target (the card itself), not a control — no visible ring on the
		   section; the controls inside carry the accent focus ring. */
		outline: none;
	}

	.card-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px; /* md */
	}
	.titles {
		display: flex;
		flex-direction: column;
		gap: 4px; /* xs */
		min-width: 0;
	}
	/* Display register: mono 20/600 — the card title. */
	.card-title {
		margin: 0;
		font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
		font-size: 20px;
		font-weight: 600;
		line-height: 1.2;
		color: #d7dee6; /* text */
	}
	/* Muted scenario meta subtitle. */
	.subtitle {
		margin: 0;
		font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
		font-size: 14px;
		color: #7e8a99; /* muted */
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* The MANDATORY visible Close ✕ — 44px tap-target floor, chrome (never accent-filled). */
	.close {
		flex: none;
		min-height: 44px;
		min-width: 44px;
		padding: 0 12px;
		border: 1px solid #243040; /* border */
		border-radius: 6px;
		background: #0b0f14; /* dominant — chrome, NEVER accent-filled */
		color: #d7dee6; /* text */
		font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
		font-size: 16px;
		line-height: 1;
		cursor: pointer;
	}
	.close:focus-visible {
		outline: 2px solid #3fb68b; /* accent */
		outline-offset: 2px;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 16px; /* md — section break situation → objectives → win/lose → hints */
	}
	.block {
		display: flex;
		flex-direction: column;
		gap: 8px; /* sm — gap between a section heading and its body */
	}

	/* Section LABELS — mono 16/600 (the data/chrome register). */
	.label {
		margin: 0;
		font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
		font-size: 16px;
		font-weight: 600;
		line-height: 1.2;
		letter-spacing: 0.04em;
		color: #d7dee6; /* text */
	}
	/* The one semantic color pairing — text-backed labels, never color-only. */
	.label.victory {
		color: #3fb68b; /* accent — the win condition */
	}
	.label.defeat {
		color: #d8604c; /* destructive — the lose condition */
	}

	/* Prose bodies — sans 16/400/1.5 (the prose register, mirrors NarrativePanel). The win/lose
	   prose beneath each label stays text color (readable regardless of label color). */
	.prose {
		margin: 0;
		font-family: ui-sans-serif, system-ui, sans-serif;
		font-size: 16px;
		font-weight: 400;
		line-height: 1.5;
		color: #d7dee6; /* text */
		/* Preserve the AI's paragraphing without interpreting markup (escaped text only). */
		white-space: pre-wrap;
	}
	/* A missing section string / the fallback line is muted (the CampaignLog placeholder discipline). */
	.prose.missing {
		color: #7e8a99; /* muted */
	}
	.fallback-line {
		font-style: italic;
	}

	/* Keyed escaped objectives + hints lists (the ScenarioPicker precedent). */
	.objectives,
	.hints {
		margin: 0;
		padding-left: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 8px; /* sm — stacked list items */
	}
	.dismiss-row {
		display: flex;
		margin-top: 8px; /* lg break is carried by the parent gap; keep this tight */
	}
	/* Dismiss — chrome, NEVER accent-filled (the morphing CTA is the single primary action). */
	.dismiss {
		min-height: 44px;
		padding: 0 0.9rem;
		border: 1px solid #243040; /* border */
		border-radius: 6px;
		background: #0b0f14; /* dominant — chrome, never accent */
		color: #d7dee6; /* text */
		font: inherit;
		cursor: pointer;
	}
	.dismiss:focus-visible {
		outline: 2px solid #3fb68b; /* accent */
		outline-offset: 2px;
	}

	/* Reduced motion: the card appears/disappears instantly (no slide/fade) — there is no
	   transition on the card, so this is satisfied by construction; declared for intent. */
	@media (prefers-reduced-motion: reduce) {
		.briefing-card {
			transition: none;
		}
	}
</style>
