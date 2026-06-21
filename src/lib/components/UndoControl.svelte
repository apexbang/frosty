<!--
  UndoControl.svelte — UI-07, the single always-visible "undo last turn" affordance.

  A single real `<button>` (`↶ Undo last turn`) lives in the persistent chrome (mounted by
  +page.svelte near the turn controls) so it is reachable without scrolling — NOT buried in
  a menu (CONTEXT D-03 / UI-SPEC ## Undo). It is ALWAYS rendered:
    - enabled once ≥1 turn is resolved (`game.state.meta.turn >= 1`);
    - else `disabled` + `title`/`aria-label` "Nothing to undo yet" (the turn-0 pre-resolve
      state — muted, announced as unavailable, never just color-only).

  CONFIRM (the ONE destructive action this phase): tapping opens a SINGLE inline confirm
  (in-flow, NEVER off-canvas — the Phase-5 inline-never-overlay lock, mirrored from
  DiceConfirmPanel): the copy `Drop turn {n}? Its order, dice, and prose are removed and the
  turn resets. This can't be redone.` with `Undo` (destructive red) + `Keep` (secondary).
  Focus moves to the confirm; Esc = Keep (UI-SPEC accessibility). Single-level only — no
  multi-step undo stack.

  On `Undo` confirm: `await game.undoLastTurn()` — the bridge drops the tail turn and rolls
  the live reactive mirror back to the historical state (StatePanel/NarrativePanel/etc all
  re-render). REACTIVITY (CLAUDE.md #1 hazard): the availability gate is `$derived` over
  `game.state.meta.turn` — never a stored boolean; the only local $state is `confirming`
  (the inline-dialog open flag). SECURITY: no raw-HTML render directive — copy is escaped.
-->
<script lang="ts">
	import { game } from '../game.svelte';

	// The current turn — the availability gate AND the `{n}` in the confirm copy. $derived
	// over the reactive state so it tracks resolve/undo; -1 sentinel when there is no state.
	const currentTurn = $derived(game.state?.meta.turn ?? -1);
	// Enabled once ≥1 turn is resolved (turn 0 base / no state ⇒ nothing to undo yet).
	const canUndo = $derived(currentTurn >= 1);

	// The ONLY local $state — the inline confirm open flag (never a stored "visible" derived).
	let confirming = $state(false);

	// The confirm element to move focus to when the dialog opens (UI-SPEC accessibility).
	let confirmEl = $state<HTMLDivElement | null>(null);

	const open = (): void => {
		if (!canUndo) return;
		confirming = true;
	};

	const keep = (): void => {
		confirming = false;
	};

	const doUndo = async (): Promise<void> => {
		confirming = false;
		await game.undoLastTurn();
	};

	// Esc = Keep (UI-SPEC line 241) — close the inline confirm without undoing.
	const onKeydown = (e: KeyboardEvent): void => {
		if (e.key === 'Escape') {
			e.stopPropagation();
			keep();
		}
	};

	// Move focus into the confirm when it opens so keyboard/AT users land on the dialog.
	$effect(() => {
		if (confirming && confirmEl) confirmEl.focus();
	});
</script>

<div class="undo-control">
	<button
		type="button"
		class="undo-btn"
		onclick={open}
		disabled={!canUndo}
		title={canUndo ? undefined : 'Nothing to undo yet'}
		aria-label={canUndo ? 'Undo last turn' : 'Nothing to undo yet'}
	>
		↶ Undo last turn
	</button>

	{#if confirming}
		<!-- A single INLINE confirm — renders in-flow beneath the button, never an overlay. -->
		<div
			class="confirm"
			role="alertdialog"
			aria-label="Undo last turn"
			aria-live="assertive"
			tabindex="-1"
			bind:this={confirmEl}
			onkeydown={onKeydown}
		>
			<p class="confirm-copy">
				Drop turn {currentTurn}? Its order, dice, and prose are removed and the turn resets. This
				can't be redone.
			</p>
			<div class="confirm-actions">
				<button type="button" class="destructive" onclick={doUndo}>Undo</button>
				<button type="button" class="secondary" onclick={keep}>Keep</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.undo-control {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		align-items: flex-start;
	}

	.undo-btn {
		min-height: 44px;
		padding: 0 0.9rem;
		border-radius: 0.375rem;
		border: 1px solid #243040; /* border */
		background: #151b23; /* secondary */
		color: #d7dee6; /* text */
		font: inherit;
		cursor: pointer;
	}
	.undo-btn:focus-visible {
		outline: 2px solid #3fb68b; /* accent */
		outline-offset: 2px;
	}
	.undo-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
		color: #7e8a99; /* muted — "Nothing to undo yet" */
	}

	/* The inline destructive confirm — in-flow, on the secondary surface, hairline border. */
	.confirm {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px solid #6b2422; /* destructive border — the one destructive surface */
		border-radius: 0.375rem;
		background: #151b23; /* secondary */
		max-width: 22rem;
	}
	.confirm:focus-visible {
		outline: 2px solid #3fb68b;
		outline-offset: 2px;
	}
	.confirm-copy {
		margin: 0;
		font-size: 0.9rem;
		color: #d7dee6;
		line-height: 1.4;
	}
	.confirm-actions {
		display: flex;
		gap: 0.5rem;
	}
	.confirm-actions button {
		min-height: 44px;
		padding: 0 0.9rem;
		border-radius: 0.375rem;
		border: 1px solid #243040;
		background: #0b0f14; /* dominant — chrome */
		color: #d7dee6;
		font: inherit;
		cursor: pointer;
	}
	.confirm-actions button:focus-visible {
		outline: 2px solid #3fb68b;
		outline-offset: 2px;
	}
	/* Destructive = red text + a red hairline (mirrors DiceConfirmPanel .destructive). */
	.confirm-actions .destructive {
		color: #d8604c; /* destructive */
		border-color: #6b2422;
	}
</style>
