<!--
  CampaignLog.svelte — UI-06, the after-action scrollback over the PERSISTED narrative.

  The persisted twin of NarrativePanel: where NarrativePanel renders the in-memory
  `game.log`, CampaignLog renders `game.state.narrativeLog` ({ turn, text }[], the
  Finding-1 persisted field) — turn-tagged prose that survives a full reload. It REUSES
  NarrativePanel's escaped-text + register-break + independent-scroll + current-turn
  patterns verbatim (UI-SPEC: "a near-twin of NarrativePanel").

  Pre-Phase-6 turns whose prose predates narrative persistence (or an empty text) render
  the `(no prose recorded for this turn)` placeholder, never a crash (T-06D-02; the
  upstream defensive `narrativeLog ??= []` on boot guarantees the array exists).

  SECURITY CONTRACT (T-06D-01, carry-forward from NarrativePanel T-05-07): AI prose is
  untrusted and rendered as ESCAPED text via `{entry.text}` interpolation — the raw-HTML
  render directive MUST NOT appear anywhere in this file. Injected markup appears as
  literal text, never executes.

  Read-only: no edit/delete/destructive controls — after-action scrollback only.

  Tokens: binds the EXISTING Phase-5 palette/type/spacing values (no new tokens — UI-SPEC).
-->
<script lang="ts">
	import { game } from '../game.svelte';

	// The persisted narrative scrollback (defensive ?? [] mirrors boot()'s upstream default —
	// a pre-Phase-6 state could still be mid-boot). Read through the proxy (no destructure).
	const entries = (): { turn: number; text: string }[] => game.state?.narrativeLog ?? [];

	// The most-recent turn is the last appended entry — most prominent (accent left-rule).
	const lastTurn = (): number | null => {
		const log = entries();
		return log.length > 0 ? log[log.length - 1].turn : null;
	};
</script>

<section class="campaign-log" aria-label="After-action log">
	{#if entries().length === 0}
		<div class="empty">
			<p class="empty-heading">No engagement yet</p>
			<p class="empty-body">
				Resolve your first turn — the after-action log records every turn's prose and reveals
				here.
			</p>
		</div>
	{:else}
		<ol class="scrollback">
			{#each entries() as entry (entry.turn)}
				<li class="block" class:current={entry.turn === lastTurn()}>
					<div class="turn-marker">Turn {entry.turn}</div>
					{#if entry.text}
						<p class="prose">{entry.text}</p>
					{:else}
						<p class="placeholder">(no prose recorded for this turn)</p>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.campaign-log {
		display: flex;
		flex-direction: column;
		gap: 12px;
		/* Independent scroll — a long campaign never pushes chrome off-screen. */
		overflow-y: auto;
		/* The register break: sans (prose only), 16px/1.5 — distinct from the mono panels. */
		font-family: ui-sans-serif, system-ui;
		font-size: 16px;
		line-height: 1.5;
		color: #d7dee6; /* text */
		background: #0b0f14; /* dominant */
		/* The hairline that, with the typeface switch, separates the two registers. */
		border-left: 1px solid #243040; /* border */
		padding-left: 16px; /* md */
	}

	/* Turn marker is the one mono run here — it anchors the prose to the ledger. */
	.turn-marker {
		font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #7e8a99; /* muted */
	}

	.empty {
		text-align: center;
		padding: 32px 16px; /* xl / md */
	}
	.empty-heading {
		margin: 0;
		color: #d7dee6; /* text */
	}
	.empty-body {
		margin: 4px 0 0; /* xs */
		color: #7e8a99; /* muted */
		font-size: 14px;
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
		/* Prior turns at slightly reduced emphasis; the most-recent turn overrides to 1. */
		opacity: 0.78;
	}
	.block.current {
		opacity: 1;
		border-left-color: #3fb68b; /* accent — the most-recent turn (reserved accent use) */
	}

	.prose {
		margin: 4px 0 0; /* xs */
		/* Preserve the AI's paragraphing without ever interpreting markup (escaped text only). */
		white-space: pre-wrap;
	}

	/* Pre-Phase-6 / prose-less turn — mono muted caption, never an empty block (T-06D-02). */
	.placeholder {
		margin: 4px 0 0; /* xs */
		font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
		font-size: 14px;
		font-style: italic;
		color: #7e8a99; /* muted */
	}
</style>
