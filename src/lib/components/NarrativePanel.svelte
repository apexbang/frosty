<!--
  NarrativePanel.svelte — UI-02, the AI prose scrollback.

  The deliberate REGISTER BREAK from the State Panel: sans 16px/1.5 prose (vs the State
  Panel's mono data), with a 1px #243040 hairline + the typeface switch as the separation
  signal (UI-SPEC ## Layout — "two registers, clearly separated", spec §9).

  Reads `game.log` ONLY (the turn-tagged scrollback). The CURRENT turn (the last entry) is
  most prominent — full opacity + an accent left-rule (one of the four reserved accent uses,
  UI-SPEC ## Color); prior turns sit at slightly reduced emphasis. A `Turn {n}` marker (mono,
  muted) anchors each block to the ledger.

  SECURITY CONTRACT (T-05-07, UI-SPEC Copywriting): AI prose is untrusted. It is rendered as
  ESCAPED text via `{entry.narrative}` interpolation — NEVER the raw-HTML render directive.
  Injected markup must appear as literal text, never execute. There is no raw-HTML directive
  anywhere in this file (the Task-3 grep gate asserts its absence).

  Independent scroll: the scrollback owns its own overflow so a long story never pushes the
  interaction controls off-screen (UI-SPEC ## Layout).
-->
<script lang="ts">
	import { game } from '../game.svelte';

	// The current turn is the last appended entry — most prominent (accent left-rule).
	const lastTurn = (): number | null =>
		game.log.length > 0 ? game.log[game.log.length - 1].turn : null;
</script>

<section class="narrative-panel" aria-label="Narrative">
	{#if game.machine === 'awaitingPaste'}
		<p class="pending">awaiting the AI's reply…</p>
	{/if}

	{#if game.log.length === 0}
		<p class="empty">No prose yet — Issue your first order to begin the engagement.</p>
	{:else}
		<ol class="scrollback">
			{#each game.log as entry, i (i)}
				<li class="block" class:current={entry.turn === lastTurn()}>
					<div class="turn-marker">Turn {entry.turn}</div>
					<p class="prose">{entry.narrative}</p>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.narrative-panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
		/* Independent scroll — the scrollback must not push controls off-screen. */
		overflow-y: auto;
		/* The register break: sans (prose only), 16px/1.5 — distinct from the mono State Panel. */
		font-family: ui-sans-serif, system-ui;
		font-size: 16px;
		line-height: 1.5;
		color: #d7dee6; /* text */
		background: #0b0f14; /* dominant */
		/* The hairline that, with the typeface switch, separates the two registers. */
		border-left: 1px solid #243040; /* border */
		padding-left: 16px; /* md */
	}

	/* Turn marker is the one mono run here — it anchors the story to the ledger. */
	.turn-marker {
		font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #7e8a99; /* muted */
	}

	.pending {
		margin: 0;
		font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
		font-size: 14px;
		font-style: italic;
		color: #7e8a99; /* muted */
	}

	.empty {
		margin: 0;
		text-align: center;
		padding: 32px 16px; /* xl / md */
		color: #7e8a99; /* muted */
	}

	.scrollback {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 24px; /* lg — section breaks between turns */
	}

	.block {
		border-left: 2px solid #243040; /* border — prior turns at base emphasis */
		padding-left: 12px;
		/* Prior turns at slightly reduced emphasis; the current turn overrides to 1. */
		opacity: 0.78;
	}
	.block.current {
		opacity: 1;
		border-left-color: #3fb68b; /* accent — the active turn marker (reserved accent use) */
	}

	.prose {
		margin: 4px 0 0;
		/* Preserve the AI's paragraphing without ever interpreting markup (escaped text only). */
		white-space: pre-wrap;
		/* UX-07 measure cap: ~66ch keeps lines readable now that the prose is the dominant,
		   full-width column (research §B). Inert at 393px (the phone is narrower than 66ch);
		   it only bites on a wide viewport. The 16px/1.5/sans register above is untouched. */
		max-width: 66ch;
	}
</style>
