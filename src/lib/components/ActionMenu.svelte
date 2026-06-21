<!--
  ActionMenu.svelte — ORDER-04, the shallow tap-to-order menu opened from a unit card.

  Render-ONLY/proposal-only over the `game` singleton. The offered list is `$derived` over
  the PURE `offerableActions(side, unit, game.remaining[side])` — unofferable verbs are simply
  ABSENT from `offered` (never rendered-and-disabled; CONTEXT "unofferable means not rendered").
  A materiel verb embeds an ExpendStepper bound to the derived `remaining` ceiling (ORDER-05).
  Tapping a verb builds an `OrderAction` via the pure `toOrderAction` and accumulates it into
  `game.pendingActions` — a PROPOSAL only; the resolver owns every delta (authority rule). A
  queued row carries the reserved accent left-rule and is tap-toggle removable (UI-SPEC 170).

  Phone-first: opens IN-FLOW beneath the unit card (never a modal — the Phase-5 lock). Every
  row + stepper button is a ≥44px tap target. Escaped text ONLY — the raw-HTML directive is
  never used (the carried-forward security contract).
-->
<script lang="ts">
	import { game } from '../game.svelte';
	import { offerableActions, toOrderAction, type ActionVerb } from '../engine/action-catalog';
	import type { Side, Unit } from '../engine/state';
	import ExpendStepper from './ExpendStepper.svelte';

	let { side, unit }: { side: Side; unit: Unit } = $props();

	// The offered verbs for THIS unit — pure, derived over the live state + remaining map.
	const offered = $derived(offerableActions(side, unit, game.remaining[side.id] ?? {}));

	// Per-verb stepper proposal qty (local UI state; defaults to the verb's expend qty, min 1).
	// Keyed by verb id so each materiel verb tracks its own proposed count independently.
	let qtys = $state<Record<string, number>>({});
	const qtyFor = (verb: ActionVerb): number => qtys[verb.id] ?? verb.expends?.qty ?? 1;

	// Is this verb already queued for this unit? (identity = actor + actionType + expend item)
	const isQueued = (verb: ActionVerb): boolean =>
		game.pendingActions.some(
			(a) =>
				a.actor === unit.id &&
				a.actionType === verb.actionType &&
				(a.expend?.[0]?.item ?? null) === (verb.expends?.item ?? null)
		);

	const removeQueued = (verb: ActionVerb): void => {
		game.pendingActions = game.pendingActions.filter(
			(a) =>
				!(
					a.actor === unit.id &&
					a.actionType === verb.actionType &&
					(a.expend?.[0]?.item ?? null) === (verb.expends?.item ?? null)
				)
		);
	};

	// Tap a verb: toggle it in/out of the pending order. Mutate-then-reassign (runes reactivity).
	const tapVerb = (verb: ActionVerb): void => {
		if (isQueued(verb)) {
			removeQueued(verb);
			return;
		}
		const action = toOrderAction(unit, verb, qtyFor(verb));
		game.pendingActions = [...game.pendingActions, action];
	};
</script>

<section class="action-menu" aria-label={`${unit.id} orders`}>
	<h4 class="menu-head">{unit.id} — orders</h4>

	{#if offered.length === 0}
		<p class="empty">No actions available for this unit this turn.</p>
	{:else}
		<ul class="verbs">
			{#each offered as verb (verb.id)}
				<li class="verb-row" class:queued={isQueued(verb)}>
					<button
						type="button"
						class="verb-btn"
						aria-pressed={isQueued(verb)}
						onclick={() => tapVerb(verb)}
					>
						<span class="verb-label">{verb.label}</span>
						<span class="needs">
							{#if verb.requiresCapabilities.length > 0}
								▸ needs: {verb.requiresCapabilities.join(', ')}
							{:else}
								▸
							{/if}
						</span>
					</button>

					{#if verb.expends}
						<div class="stepper-host">
							<ExpendStepper
								sideId={side.id}
								item={verb.expends.item}
								bind:qty={
									() => qtyFor(verb),
									(v) => (qtys = { ...qtys, [verb.id]: v })
								}
							/>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.action-menu {
		display: flex;
		flex-direction: column;
		gap: 8px; /* sm */
		margin-top: 8px;
		padding: 8px; /* sm */
		background: #0b0f14; /* dominant — opens in-flow beneath the card, no modal */
		border: 1px solid #243040; /* border hairline */
		border-radius: 6px;
		font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
		font-size: 14px;
		color: #d7dee6; /* text */
	}
	.menu-head {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		color: #7e8a99; /* muted — a section label, not primary data */
		letter-spacing: 0.04em;
	}
	.empty {
		margin: 0;
		color: #7e8a99; /* muted */
		font-size: 13px;
	}
	.verbs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.verb-row {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-left: 0; /* the accent left-rule appears only when queued */
		border-left: 4px solid transparent;
	}
	/* A queued verb gets the RESERVED accent left-rule (UI-SPEC ## Color #8). */
	.verb-row.queued {
		border-left-color: #3fb68b; /* accent */
		padding-left: 6px;
	}
	.verb-btn {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-height: 44px; /* ≥44px tap target */
		width: 100%;
		padding: 0 8px;
		text-align: left;
		background: #151b23; /* secondary surface — unselected rows are NOT accent */
		border: 1px solid #243040; /* border */
		border-radius: 6px;
		color: #d7dee6; /* text */
		font: inherit;
		cursor: pointer;
	}
	.verb-btn:focus-visible {
		outline: 2px solid #3fb68b; /* accent focus ring */
		outline-offset: 2px;
	}
	.verb-label {
		font-weight: 600;
	}
	.needs {
		font-size: 12px;
		color: #7e8a99; /* muted requirement hint */
	}
	.stepper-host {
		padding-left: 8px;
	}
</style>
