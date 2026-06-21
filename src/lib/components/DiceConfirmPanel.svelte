<!--
  DiceConfirmPanel.svelte — UI-04, "shows its work" + the inline confirm gate.

  Render-only over `game.lastResolution` (the persistent dice strip), `game.confirmRows`
  (the confirm-step projection the store already supplied — this panel does NOT re-derive
  the rows itself), and `game.confirmEnabled`. The confirm step is INLINE,
  never a modal (CONTEXT locks inline). Confirm controls drive the singleton: Confirm &
  resolve → game.confirm; Adjust → game.adjust; Cancel turn → game.cancel. Every count
  shown here is the player's final authority over the ledger before resolve (the AI has zero
  authority — T-05-09).

  UI-04 contract (05-UI-SPEC.md):
    • Last-resolution strip (persistent, NO timer): roll `{d1} {d2}` · itemized modifier list
      (each `{label} {±value}`, tabular-aligned) · `net {value}` · the outcome-band label,
      coloured success_* → accent green, stalled → muted, failure → destructive. It surfaces
      the §5.4 numbers verbatim: roll `3 4`, `60mm support +2`, `enemy in prepared cover −1`
      (the ACTUAL envelope label the runtime dice event carries), net `+1`, `success_costly`.
    • Inline confirm rows: expend → `{actor} · {side} · {item} ×{qty}`; casualty →
      `{actor} · {side} · {unit} {deltaBand} band(s)` (negative, destructive red).
    • Confirm controls: Confirm & resolve (primary accent) · Adjust (secondary) · Cancel turn
      (destructive text). Inline, never a modal.
    • Confirm toggle: a `confirmEnabled` switch ("Skip confirm once I trust the parse") bound
      to `game.confirmEnabled`, initialised from CONFIRM_DEFAULT_ON === true (ORDER-03).

  Colour is NEVER the sole signal: the band label carries text, and the casualty sign carries
  meaning alongside the destructive colour (UI-SPEC Accessibility).
-->
<script lang="ts">
	import { game } from '../game.svelte';

	const signed = (n: number): string => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
</script>

<section class="dice-confirm-panel" aria-label="Dice and confirm">
	<h2 class="display mono">RESOLUTION</h2>

	<!-- Last-resolution strip (persistent, no timer). -->
	{#if game.lastResolution}
		{@const r = game.lastResolution}
		<div class="resolution" aria-label="Last resolution">
			<div class="roll mono" aria-label="roll {r.roll[0]} {r.roll[1]}">
				<span class="die tabular-nums">{r.roll[0]}</span>
				<span class="die tabular-nums">{r.roll[1]}</span>
			</div>
			<ul class="modifiers">
				{#each r.modifiers as m (m.label)}
					<li class="mono">
						<span class="label">{m.label}</span>
						<span class="val tabular-nums">{signed(m.value)}</span>
					</li>
				{/each}
			</ul>
			<div class="net mono tabular-nums">net {signed(r.net)}</div>
			<div
				class="band mono"
				class:good={r.band === 'success_clean' || r.band === 'success_costly'}
				class:bad={r.band === 'failure'}
			>
				{r.band}
			</div>
		</div>
	{/if}

	<!-- Inline confirm rows + controls (on by default, never a modal). Gated on
	     machine === 'confirming' too (A, defense-in-depth) so a stale-rows edge can
	     never re-show dead controls after a turn resolves. -->
	{#if game.confirmRows.length > 0 && game.machine === 'confirming'}
		<div class="confirm" aria-label="Confirm step">
			<ul class="rows">
				{#each game.confirmRows as row (row.actor + row.side + (row.kind === 'expend' ? row.item : row.unit))}
					{#if row.kind === 'expend'}
						<li class="row mono">{row.actor} · {row.side} · {row.item} ×{row.qty}</li>
					{:else}
						<li class="row mono casualty">
							{row.actor} · {row.side} · {row.unit}
							<span class="delta tabular-nums">{row.deltaBand}</span> band(s)
						</li>
					{/if}
				{/each}
			</ul>

			<div class="controls">
				<button class="cta" onclick={() => game.confirm()}>Confirm &amp; resolve</button>
				<button class="secondary" onclick={() => game.adjust()}>Adjust</button>
				<button class="destructive" onclick={() => game.cancel()}>Cancel turn</button>
			</div>

			<label class="toggle mono">
				<input type="checkbox" bind:checked={game.confirmEnabled} />
				Skip confirm once I trust the parse
			</label>
		</div>
	{/if}
</section>

<style>
	.dice-confirm-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		overflow-y: auto;
		font-family: ui-sans-serif, system-ui, sans-serif;
		color: #d7dee6;
	}
	.display {
		font-size: 20px;
		font-weight: 600;
		line-height: 1.2;
		margin: 0;
		color: #d7dee6;
	}
	.mono {
		font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
	}
	.tabular-nums {
		font-variant-numeric: tabular-nums;
	}
	/* Last-resolution strip on the secondary (raised slate) surface. */
	.resolution {
		background: #151b23;
		border: 1px solid #243040;
		border-radius: 0.375rem;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.roll {
		display: flex;
		gap: 0.5rem;
	}
	.die {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border: 1px solid #243040;
		border-radius: 0.25rem;
		font-weight: 600;
	}
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
	}
	.net {
		font-size: 0.9rem;
		color: #7e8a99;
	}
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
	/* Inline confirm block on the secondary surface — never a modal. */
	.confirm {
		background: #151b23;
		border: 1px solid #243040;
		border-radius: 0.375rem;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.875rem;
	}
	.row.casualty {
		color: #d8604c; /* casualty delta → destructive (sign carries meaning too) */
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: #7e8a99;
		min-height: 44px;
	}
	button {
		min-height: 44px;
		padding: 0 0.9rem;
		border-radius: 0.375rem;
		border: 1px solid #243040;
		background: #151b23;
		color: #d7dee6;
		cursor: pointer;
		font: inherit;
	}
	button:focus-visible,
	.toggle input:focus-visible {
		outline: 2px solid #3fb68b;
		outline-offset: 2px;
	}
	.cta {
		background: #3fb68b;
		border-color: #3fb68b;
		color: #0b0f14;
		font-weight: 600;
	}
	.destructive {
		color: #d8604c;
		border-color: #6b2422;
	}
</style>
