<!--
  ExpendStepper.svelte — ORDER-05, the −/+ proposal stepper bound to the DERIVED remaining.

  The ceiling is `game.remaining[sideId]?.[item]` read through `$derived` — NEVER a stored
  copy (CLAUDE.md #1 hazard / prefer-writable-derived). ORDER-05 ("cannot exceed remaining")
  is true BY CONSTRUCTION: the component holds only the local `qty` proposal, bounded by the
  derived `max`; there is no number here that could outrun the ledger. The stepper proposes —
  the resolver owns every delta (authority rule).

  Phone-first: each button is a ≥44px tap target with an aria-label (`decrease {item}` /
  `increase {item}`). `−` disables at the floor (qty ≤ 0), `+` at the ceiling (qty ≥ max).
  An over-tap on a disabled `+` flashes the readout destructive for ~200ms, honoring
  `prefers-reduced-motion` (no flash under reduce — UI-SPEC line 114). The readout exposes
  aria-valuenow/aria-valuemax (UI-SPEC line 239). Escaped text only.
-->
<script lang="ts">
	import { game } from '../game.svelte';

	let {
		sideId,
		item,
		qty = $bindable(0)
	}: { sideId: string; item: string; qty?: number } = $props();

	// The DERIVED ceiling — read straight from the singleton's `remaining` map, never stored.
	const max = $derived(game.remaining[sideId]?.[item] ?? 0);

	// Transient over-tap flash (a local UI signal, not engine state). Cleared by a timer.
	let flash = $state(false);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	const dec = (): void => {
		if (qty > 0) qty -= 1;
	};

	const inc = (): void => {
		if (qty < max) {
			qty += 1;
			return;
		}
		// At the ceiling — flash the readout destructive (unless reduced motion is preferred).
		const reduce =
			typeof window !== 'undefined' &&
			window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		if (reduce) return;
		flash = true;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flash = false), 200);
	};
</script>

<div class="stepper">
	<button
		type="button"
		class="step"
		aria-label={`decrease ${item}`}
		disabled={qty <= 0}
		onclick={dec}>−</button
	>
	<span
		class="readout tabular-nums"
		class:flash
		role="spinbutton"
		aria-valuenow={qty}
		aria-valuemin={0}
		aria-valuemax={max}
		aria-label={`${item} quantity`}>{item} {qty} / {max}</span
	>
	<button
		type="button"
		class="step"
		aria-label={`increase ${item}`}
		disabled={qty >= max}
		onclick={inc}>+</button
	>
</div>

<style>
	.stepper {
		display: flex;
		align-items: center;
		gap: 8px; /* sm */
		font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
		font-size: 14px;
		color: #d7dee6; /* text */
	}

	/* ≥44px tap target (UI-SPEC line 62-64) — stepper buttons are utility, NEVER accent. */
	.step {
		min-width: 44px;
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px solid #243040; /* border */
		border-radius: 6px;
		background: #151b23; /* secondary */
		color: #d7dee6; /* text */
		font: inherit;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
	}
	.step:focus-visible {
		outline: 2px solid #3fb68b; /* accent focus ring */
		outline-offset: 2px;
	}
	.step:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.readout {
		min-width: 7ch;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	/* Over-tap on a disabled + flashes destructive (~200ms; suppressed under reduced motion). */
	.readout.flash {
		color: #d8604c; /* destructive red */
	}

	@media (prefers-reduced-motion: reduce) {
		.readout.flash {
			/* No flash under reduced motion — the readout simply stays at max. */
			color: #d7dee6;
		}
	}
</style>
