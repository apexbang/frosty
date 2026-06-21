<!--
  CampaignsScreen.svelte — the Phase-10 Campaigns "shelf" (CAMP-01, CAMP-02, CAMP-05, CAMP-08).

  RENDER + DISPATCH ONLY (clones ScenarioPicker's discipline): imports the `game` bridge + the
  `CampaignRow` TYPE only — no engine value-import, no idb (CORE-02). It lists every campaign
  most-recent-first via an async `game.listCampaigns()` read (the ScenarioPicker $effect idiom:
  mutate-then-reassign a $state list — never derived, the source is a Promise), renders an explicit
  empty state, and offers the two TOP-LEVEL actions:
    - New game        → game.openPicker()  (the ONE accent CTA; dispatches into the EXISTING
                        Phase-9 ScenarioPicker — CAMP-02 / D-01, NOT rebuilt here)
    - Import campaign → a real <input type="file"> → game.importCampaignFile(file)  (CAMP-05 / D-08;
                        reuses the validate-at-load import() seam, creates-new)

  Each campaign renders as a <CampaignRow> (resume / rename / duplicate / export / type-to-confirm
  delete). After any row mutation the row calls back into `reload()` so the list re-reads (the
  re-read-after-mutate contract) and a rename/duplicate/delete reflects immediately.

  Sort order (D-06): rows are sorted descending `updatedAt` at RENDER time — never a stored sort
  key the UI maintains in parallel to the store's by_updatedAt index.

  SECURITY CONTRACT (T-10-07): every campaign name renders inside <CampaignRow> as ESCAPED
  interpolation; this screen's only interpolated bridge string is `game.lifecycleWarning`
  (a recoverable notice), also escaped. There is NO raw-HTML render directive anywhere.

  TOKENS: every colour binds the locked app.css token literal. Accent #3fb68b is the New game CTA +
  focus rings ONLY; warning-amber on the import/export notice. NO ScenarioPicker blue.
  Every control is ≥44px.
-->
<script lang="ts">
	import { game } from '../game.svelte';
	import type { CampaignRow } from '../engine';
	import CampaignRowView from './CampaignRow.svelte';

	// The campaign rows — a $state list populated from the async store read (mutate-then-reassign,
	// the ScenarioPicker idiom). Never derived: the source is a Promise, not a reactive value.
	let campaigns = $state<CampaignRow[]>([]);

	// A monotonic bump signal: a row's `onmutate` increments it; the load $effect reads it, so any
	// rename/duplicate/delete re-runs `listCampaigns()` and the list reflects the mutation. Plain
	// $state counter — nothing renders it; it only drives the effect's re-run (CONTEXT discretion).
	let reloadTick = $state(0);

	$effect(() => {
		// Read the bump so a mutation re-runs the load (the re-read-after-mutate contract).
		void reloadTick;
		void game.listCampaigns().then((rows) => {
			// Sort descending updatedAt at render time (D-06) — a copy, never an in-place sort of
			// the store's array. The store's by_updatedAt index owns the canonical order; this is a
			// defensive presentation sort so the shelf is most-recent-first regardless of list() order.
			campaigns = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
		});
	});

	const reload = (): void => {
		reloadTick += 1;
	};

	const onImportChange = (e: Event): void => {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		// Reset the input so re-selecting the SAME file fires change again (a re-try affordance).
		input.value = '';
		if (!file) return;
		void game.importCampaignFile(file).then(reload);
	};
</script>

<section class="campaigns" aria-label="Campaigns">
	<header class="head">
		<h2 class="title">Campaigns</h2>
		<!-- The header actions are the New game / Import entry points for a POPULATED shelf. When the
		     store is empty the empty-state hero below already surfaces the identical pair as the primary
		     next-step, so showing them here too is redundant duplication (the "two New game buttons"
		     polish). Render the header pair only when there is at least one row. -->
		{#if campaigns.length > 0}
			<div class="head-actions">
				<button class="cta" type="button" onclick={() => game.openPicker()}>New game</button>
				<label class="secondary import-label">
					Import campaign
					<input
						class="import-input"
						type="file"
						accept=".json,application/json"
						aria-label="Import campaign"
						onchange={onImportChange}
					/>
				</label>
			</div>
		{/if}
	</header>

	<!-- OFFL-04 durability nudge (D-07): a persistent, ALWAYS-SHOWN static caption near the
	     import/export affordance. Reference info that lives where the user backs up — NOT a
	     dismissible toast, NOT gated on the storage-persistence state (the escalating variant is
	     deferred), NO new persistence logic (D-08 — that stays in idb-save-store.ts).
	     STATIC copy only: no interpolation, no raw-HTML render directive (preserves the
	     T-10-07 escape contract). Muted/informational register — never accent, never warning-amber. -->
	<p class="durability-nudge">Device storage can be cleared — export to back up.</p>

	{#if game.lifecycleWarning}
		<!-- Recoverable import/export failure notice — warning-amber, assertive (possible data
		     loss / consequential). Escaped text only — no raw-HTML render directive. -->
		<p class="notice" role="alert" aria-live="assertive">{game.lifecycleWarning}</p>
	{/if}

	{#if campaigns.length === 0}
		<!-- Empty state (D-05): the boot landing for an empty store. Hero + prose + the two
		     next-step actions (real buttons — not a dead-end). -->
		<div class="empty">
			<h3 class="empty-hero">No campaigns yet</h3>
			<p class="empty-body">Start your first campaign from a scenario, or import a saved one.</p>
			<div class="empty-actions">
				<button class="cta" type="button" onclick={() => game.openPicker()}>New game</button>
				<label class="secondary import-label">
					Import campaign
					<input
						class="import-input"
						type="file"
						accept=".json,application/json"
						aria-label="Import campaign"
						onchange={onImportChange}
					/>
				</label>
			</div>
		</div>
	{:else}
		<ul class="list">
			{#each campaigns as campaign (campaign.id)}
				<li class="list-item">
					<CampaignRowView {campaign} onmutate={reload} />
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.campaigns {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-lg);
		padding: var(--spacing-md);
		background: var(--color-dominant);
		color: var(--color-text);
		font-family: var(--font-sans);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--spacing-md);
	}
	.title {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 20px;
		font-weight: 600;
		line-height: 1.2;
	}
	.head-actions {
		display: flex;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}
	.list-item {
		margin: 0;
		padding: 0;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--spacing-md);
		padding: var(--spacing-2xl) var(--spacing-md);
		text-align: center;
	}
	.empty-hero {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 20px;
		font-weight: 600;
		line-height: 1.2;
	}
	.empty-body {
		margin: 0;
		font-family: var(--font-sans);
		font-size: 16px;
		line-height: 1.5;
		color: var(--color-muted);
		max-width: 28rem;
	}
	.empty-actions {
		display: flex;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
		justify-content: center;
	}

	.notice {
		margin: 0;
		padding: var(--spacing-sm) var(--spacing-md);
		border: 1px solid var(--color-warning);
		border-radius: 0.375rem;
		font-family: var(--font-sans);
		font-size: 14px;
		color: var(--color-warning);
	}

	/* OFFL-04 nudge — the `.notice` structure in the INFORMATIONAL register: muted, never
	   warning-amber, never accent. Borderless (reference info, not an alarm) per D-07. */
	.durability-nudge {
		margin: 0;
		font-family: var(--font-sans);
		font-size: 14px;
		color: var(--color-muted);
	}

	/* The ONE accent CTA on the screen (New game). */
	.cta {
		min-height: 44px;
		padding: 0 0.9rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-accent);
		background: var(--color-secondary);
		color: var(--color-accent);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.cta:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	/* Import campaign — secondary surface (NOT accent). A <label> wrapping a hidden file input so
	   the whole control is the 44px tap target and the native file picker stays accessible. */
	.secondary,
	.import-label {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 0.9rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-secondary);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}
	.import-label:focus-within {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
	/* The file input itself is visually hidden but stays focusable/operable within the label. */
	.import-input {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}
</style>
