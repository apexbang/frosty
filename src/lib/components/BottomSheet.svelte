<!--
  BottomSheet.svelte — UX-03 / CONTEXT D-02: the hand-rolled NON-MODAL bottom sheet, reused by
  the State sheet and the Orders sheet (+page.svelte owns which is open via one `openSheet` enum).

  CRITICAL (the load-bearing contract — RESEARCH Pattern 2 / UI-SPEC line 120,256):
  This is a plain positioned `<aside>`, NOT a native top-layer modal element and NOT the Popover
  API. Both of those make the rest of the page inert / move the element to the top layer with
  light-dismiss semantics — which would break "prose stays readable AND interactive behind the
  sheet". We use `aria-label` on an `<aside>`, never the modal-dialog ARIA role (a non-modal layer
  is not a modal dialog). There is NO dimming overlay element — the only "over prose" signal is the
  `border-top` hairline. The one allowed dimming layer is the Plan-03 confirm modal's own, never here.

  GESTURE (CONTEXT D-02 / RESEARCH Pitfall 5): drag-to-dismiss lives on the HANDLE ONLY, with
  `touch-action: none` so the browser does not hijack the vertical drag for page scroll; the
  `.sheet-body` owns its OWN `overflow-y:auto` (content scroll is separate from the handle
  gesture). The visible Close `✕` is MANDATORY and is the keyboard path (drag is pointer-only;
  Esc-to-close is wired by the parent, +page.svelte).

  FOCUS (UI-SPEC Accessibility Basics): focus moves INTO the sheet on open and returns to the
  trigger on close — a labeled-section focus move, NOT a focus trap (the non-modal sheet must
  leave the page interactive, so the narrative behind stays in the AT reading order).

  REACTIVITY (CLAUDE.md #1 hazard): drag offset is local `$state`, mutate-never-reassign; props
  via `$props()`. SECURITY: renders only escaped children — the raw-HTML directive never appears.
-->
<script lang="ts">
	import { onMount } from 'svelte';

	let { title, onclose, children }: {
		title: string;
		onclose: () => void;
		children: import('svelte').Snippet;
	} = $props();

	// Local drag state — $state, mutate-never-reassign-the-reference (CLAUDE.md #1 hazard).
	let dragY = $state(0); // current downward drag offset (px)
	let dragging = $state(false);
	const DISMISS_PX = 80; // drag past this → dismiss (gesture physics: discretion)

	// The sheet element — focus moves here on open and returns to the trigger on close.
	let sheetEl = $state<HTMLElement | null>(null);

	// Focus into the sheet on mount; return focus to the element that opened it on unmount.
	// A sanctioned external DOM side-effect (focus management), NOT derived-as-state.
	onMount(() => {
		const trigger = document.activeElement as HTMLElement | null;
		sheetEl?.focus();
		return () => trigger?.focus?.();
	});

	// Pointer Events unify touch+mouse; setPointerCapture keeps tracking even if the finger
	// leaves the handle, with no document-level listener leak (RESEARCH "Don't Hand-Roll").
	const onPointerDown = (e: PointerEvent): void => {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragging = true;
	};
	const onPointerMove = (e: PointerEvent): void => {
		if (!dragging) return;
		dragY = Math.max(0, dragY + e.movementY); // down-only
	};
	const onPointerUp = (): void => {
		dragging = false;
		if (dragY > DISMISS_PX) onclose();
		dragY = 0;
	};
</script>

<!-- NON-MODAL: a plain <aside aria-label>, never a top-layer modal element / modal-dialog ARIA
     role. tabindex=-1 so focus can move into the sheet on open without making it a tab stop.
     No dimming-overlay element exists — prose stays at full legibility behind. -->
<aside
	bind:this={sheetEl}
	class="sheet"
	class:dragging
	aria-label={title}
	tabindex="-1"
	style="transform: translateY({dragY}px)"
>
	<div
		class="handle"
		role="button"
		tabindex="0"
		aria-label="Drag to dismiss"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
	>
		<span class="handle-bar" aria-hidden="true">⎯</span>
	</div>
	<header class="sheet-head">
		<h2>{title}</h2>
		<button class="close" aria-label="Close" onclick={onclose}>✕</button>
	</header>
	<div class="sheet-body">{@render children()}</div>
</aside>

<style>
	/* Tokens are the literal-hex convention (app.css :root names in comments) — match StatePanel/
	   ContactBeat, NOT var(--…). */
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		/* Anchor the sheet's bottom edge at the TOP of the sticky `.controls` footer (its live
		   height is published to :root as `--footer-h` by +page.svelte; 0px on desktop/SSR where
		   there is no overlap). This honors "a sheet EXPANDS ABOVE this anchor, never buries it":
		   no part of the sheet sits behind the footer, so the in-sheet "Start turn" is always
		   tappable (the prior bottom:0 left the sheet tail occluded by the z-index:45 footer). */
		bottom: var(--footer-h, 0px);
		z-index: 40;
		/* Cap to the expanded snap MINUS the reserved footer band so the sheet head stays on-screen
		   (single snap — RESEARCH OQ#1). */
		max-height: calc(85dvh - var(--footer-h, 0px));
		display: flex;
		flex-direction: column;
		background: #151b23; /* secondary */
		border-top: 1px solid #243040; /* border — the ONLY over-prose signal, no dimming layer */
		/* The sheet content clears the home indicator too. */
		padding-bottom: env(safe-area-inset-bottom);
		/* Eased slide; suppressed mid-drag (the handle drives translateY directly) and for
		   reduced-motion (below). */
		transition: transform 180ms ease;
	}
	.sheet.dragging {
		transition: none;
	}
	.sheet:focus {
		outline: none; /* the sheet itself is a programmatic focus target, not a control */
	}

	/* The drag handle — the gesture lives HERE only; touch-action:none so the vertical drag
	   isn't hijacked as page scroll (RESEARCH Pitfall 5). 44px tap-target floor. */
	.handle {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		min-width: 44px;
		margin: 0 auto;
		touch-action: none;
		cursor: grab;
		color: #7e8a99; /* muted — the handle is chrome */
	}
	.handle:active {
		cursor: grabbing;
	}
	.handle-bar {
		font-size: 20px;
		line-height: 1;
		font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
	}
	.handle:focus-visible {
		outline: 2px solid #3fb68b; /* accent */
		outline-offset: 2px;
	}

	.sheet-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px; /* md */
		padding: 0 16px 8px;
	}
	/* Display register: mono 20/600 — the sheet title. */
	.sheet-head h2 {
		margin: 0;
		font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
		font-size: 20px;
		font-weight: 600;
		line-height: 1.2;
		color: #d7dee6; /* text */
	}

	/* The MANDATORY visible Close ✕ — the keyboard path (drag is pointer-only). 44px floor. */
	.close {
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

	/* The body owns its OWN scroll — separate from the handle gesture (D-02). */
	.sheet-body {
		overflow-y: auto;
		min-height: 0;
		padding: 0 16px 16px;
	}

	/* Appear/disappear instantly for reduced-motion (UI-SPEC a11y). */
	@media (prefers-reduced-motion: reduce) {
		.sheet {
			transition: none;
		}
	}
</style>
