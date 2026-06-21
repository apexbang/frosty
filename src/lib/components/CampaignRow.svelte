<!--
  CampaignRow.svelte — one row of the Phase-10 Campaigns "shelf" (CAMP-01..06, CAMP-07).

  RENDER + DISPATCH ONLY (clones ScenarioPicker / NarrativePanel discipline): imports the `game`
  bridge + the `CampaignRow` TYPE only — no engine value-import, no idb (CORE-02). Every action is
  a dispatch over a `game` bridge seam; the bridge owns the store mutation, the atomic switch, and
  the recoverable result. The singleton is mutated, never reassigned (CLAUDE.md #1 hazard). After a
  mutating action the parent re-reads `listCampaigns()` via the `onmutate` callback prop.

  The lifecycle actions:
    - Resume ▸   → game.switchCampaign(id)   (atomic resume; CAMP-01/07)
    - ✎ Rename   → inline mono edit + Save name / Discard → game.rename(id, draft)  (CAMP-03; no confirm)
    - ⧉ Duplicate→ game.duplicate(id).then(onmutate)  (full-history clone; CAMP-06; no confirm)
    - ↥ Export   → game.exportCampaignById(id)  (per-row export; CAMP-05; no confirm)
    - ✕ Delete   → arms an inline type-to-confirm region (the ONE destructive flow; CAMP-04 / D-03)

  TYPE-TO-CONFIRM DELETE (T-10-08): the irreversible 3-store cascade is gated behind
  `disabled={typed !== campaign.name}` (GitHub-style exact-name match) inside a focus-moved
  `role="alertdialog" aria-live="assertive"` region; Esc = Keep. Enablement is the `disabled`
  attribute, not colour-only.

  ACTIVE-ROW ACCENT (CAMP-07): when `campaign.id === game.campaignId` the row gets the `.current`
  accent left-rule (NarrativePanel L105-108 #3fb68b) + `aria-current="true"` + a text `● Live`
  marker — the single live row, never conveyed by colour alone.

  SECURITY CONTRACT (T-10-07): the campaign name (possibly from an imported/AI save) renders as
  ESCAPED `{campaign.name}` interpolation everywhere — NEVER a raw-HTML render directive. Injected
  markup appears as literal text, never executes.

  TOKENS: every colour binds the locked app.css token literal. Accent #3fb68b appears ONLY on the
  active-row rule + focus rings; destructive #d8604c ONLY inside the armed confirm. NO ScenarioPicker
  ad-hoc blue. Every control is ≥44px.
-->
<script lang="ts">
	import { game } from '../game.svelte';
	import type { CampaignRow } from '../engine';

	const { campaign, onmutate }: { campaign: CampaignRow; onmutate: () => void } = $props();

	// Local UI flags — plain $state (never derived). The row holds NO campaign state of its own;
	// the data is the immutable `campaign` prop, re-read by the parent after any mutation.
	let confirming = $state(false);
	let typed = $state('');
	let editing = $state(false);
	// Seeded empty; `openRename()` pre-fills it with the current name the instant the editor opens
	// (reading `campaign` at init would only capture its first value — state_referenced_locally).
	let draft = $state('');
	let nameError = $state(false);

	// Focus targets so keyboard/AT users land on the armed control (UndoControl idiom).
	let confirmEl = $state<HTMLDivElement | null>(null);
	let renameEl = $state<HTMLInputElement | null>(null);

	// The live row (CAMP-07) — the one whose id matches the currently-mounted campaign. $derived
	// over the reactive bridge id so an atomic switch re-paints exactly one accent row.
	const isLive = $derived(campaign.id === game.campaignId);

	// The destructive Delete is enabled ONLY on an exact-name match (T-10-08). The `disabled`
	// attribute IS the gate — not colour.
	const matched = $derived(typed === campaign.name);

	// Display-only relative time over updatedAt (D-06: never a stored/re-derived sort key — the
	// list order is the store's by_updatedAt index; this is presentation of the same field).
	const relative = (ts: number): string => {
		const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
		if (secs < 60) return 'just now';
		const mins = Math.floor(secs / 60);
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		if (days === 1) return 'yesterday';
		return `${days}d ago`;
	};

	const resume = (): void => {
		// Atomic resume (CAMP-01/07), then close the shelf so the player lands in the resumed game.
		// closeCampaigns also clears campaignsDismissible. (A row resume is distinct from the active-
		// delete fall-through, which keeps the shelf open to show the remaining campaigns.)
		void game.switchCampaign(campaign.id).then(() => game.closeCampaigns());
	};

	const openRename = (): void => {
		nameError = false;
		draft = campaign.name;
		editing = true;
	};

	const saveName = (): void => {
		if (draft.trim().length === 0) {
			nameError = true;
			return;
		}
		void game.rename(campaign.id, draft.trim()).then(() => {
			editing = false;
			onmutate();
		});
	};

	const discardRename = (): void => {
		editing = false;
		nameError = false;
		draft = campaign.name;
	};

	const onRenameKeydown = (e: KeyboardEvent): void => {
		if (e.key === 'Escape') {
			e.stopPropagation();
			discardRename();
		}
	};

	const duplicate = (): void => {
		void game.duplicate(campaign.id).then(onmutate);
	};

	const exportRow = (): void => {
		void game.exportCampaignById(campaign.id);
	};

	const armDelete = (): void => {
		typed = '';
		confirming = true;
	};

	const keep = (): void => {
		confirming = false;
		typed = '';
	};

	const confirmDelete = (): void => {
		if (!matched) return;
		void game.deleteCampaign(campaign.id).then(onmutate);
	};

	const onConfirmKeydown = (e: KeyboardEvent): void => {
		if (e.key === 'Escape') {
			e.stopPropagation();
			keep();
		}
	};

	// Move focus into the armed control when it opens (UndoControl accessibility idiom).
	$effect(() => {
		if (confirming && confirmEl) confirmEl.focus();
	});
	$effect(() => {
		if (editing && renameEl) renameEl.focus();
	});
</script>

<article class="row" class:current={isLive} aria-current={isLive ? 'true' : undefined}>
	<div class="row-main">
		<div class="identity">
			<h3 class="name" data-campaign-name>{campaign.name}</h3>
			{#if isLive}
				<span class="live-marker">● Live</span>
			{/if}
		</div>
		<p class="meta tabular-nums">
			Turn {campaign.currentTurn} · {relative(campaign.updatedAt)}
		</p>
	</div>

	{#if editing}
		<!-- INLINE RENAME (CAMP-03) — no confirm; Save name / Discard, Esc = Discard. -->
		<div class="rename" role="group" aria-label="Rename campaign">
			<label class="vh" for="rename-{campaign.id}">Campaign name</label>
			<input
				id="rename-{campaign.id}"
				class="rename-input"
				type="text"
				bind:value={draft}
				bind:this={renameEl}
				onkeydown={onRenameKeydown}
				aria-label="Campaign name"
				placeholder="Campaign name"
			/>
			{#if nameError}
				<p class="hint" aria-live="polite">Name can’t be empty</p>
			{/if}
			<div class="rename-actions">
				<button class="action" type="button" onclick={saveName}>Save name</button>
				<button class="action" type="button" onclick={discardRename}>Discard</button>
			</div>
		</div>
	{:else}
		<div class="actions">
			<button
				class="action"
				type="button"
				onclick={resume}
				aria-label="Resume {campaign.name}">Resume ▸</button
			>
			<button
				class="action"
				type="button"
				onclick={openRename}
				aria-label="Rename {campaign.name}">✎ Rename</button
			>
			<button
				class="action"
				type="button"
				onclick={duplicate}
				aria-label="Duplicate {campaign.name}">⧉ Duplicate</button
			>
			<button
				class="action"
				type="button"
				onclick={exportRow}
				aria-label="Export {campaign.name}">↥ Export</button
			>
			<button
				class="action delete-idle"
				type="button"
				onclick={armDelete}
				aria-label="Delete {campaign.name}">✕ Delete</button
			>
		</div>
	{/if}

	{#if confirming}
		<!-- TYPE-TO-CONFIRM DELETE (the ONE destructive flow, T-10-08). Inline, focus-moved,
		     aria-live assertive — Esc = Keep. The destructive Delete is disabled until the typed
		     string equals the campaign name EXACTLY (the disabled attribute, not colour). -->
		<div
			class="confirm"
			role="alertdialog"
			aria-label="Delete {campaign.name}"
			aria-live="assertive"
			tabindex="-1"
			bind:this={confirmEl}
			onkeydown={onConfirmKeydown}
		>
			<h4 class="confirm-head">Delete "{campaign.name}"?</h4>
			<p class="confirm-body">
				This permanently removes the campaign and all {campaign.currentTurn} of its turns. This can’t
				be undone.
			</p>
			<label class="confirm-label" for="confirm-{campaign.id}">
				Type the campaign name to confirm
			</label>
			<input
				id="confirm-{campaign.id}"
				class="confirm-input"
				type="text"
				bind:value={typed}
				aria-label="Type the campaign name to confirm"
			/>
			{#if typed.length > 0 && !matched}
				<p class="hint" aria-live="polite">
					Name doesn’t match — type "{campaign.name}" exactly to enable delete.
				</p>
			{/if}
			<div class="confirm-actions">
				<button
					class="destructive"
					type="button"
					onclick={confirmDelete}
					disabled={typed !== campaign.name}
					aria-label="Confirm delete {campaign.name}">Delete</button
				>
				<button class="action" type="button" onclick={keep}>Keep</button>
			</div>
		</div>
	{/if}
</article>

<style>
	.row {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		min-height: 44px;
		padding: var(--spacing-md);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: var(--color-secondary);
		color: var(--color-text);
	}
	/* The single live row — accent left-rule (NarrativePanel .block.current idiom). */
	.row.current {
		border-left: 2px solid var(--color-accent);
	}

	.row-main {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}
	.identity {
		display: flex;
		align-items: baseline;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
	}
	.name {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 16px;
		font-weight: 600;
		line-height: 1.2;
		/* Never interpret markup — the escaped name renders as literal text. */
		overflow-wrap: anywhere;
	}
	.live-marker {
		font-family: var(--font-mono);
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-accent);
	}
	.meta {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 14px;
		font-weight: 400;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.actions,
	.rename-actions,
	.confirm-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
	}

	.action {
		min-height: 44px;
		padding: 0 0.9rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-secondary);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}
	.action:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
	/* Idle delete is muted/border like its siblings — it earns red only once armed. */
	.delete-idle {
		color: var(--color-muted);
	}

	.rename {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}
	.rename-input,
	.confirm-input {
		min-height: 44px;
		box-sizing: border-box;
		padding: 0 0.6rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-dominant);
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: 14px;
	}
	.rename-input:focus-visible,
	.confirm-input:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.hint {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 14px;
		color: var(--color-muted);
	}

	/* The armed destructive confirm — the one place destructive red appears. */
	.confirm {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		padding: var(--spacing-md);
		border: 1px solid var(--color-destructive);
		border-radius: 0.375rem;
		background: var(--color-secondary);
	}
	.confirm:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
	.confirm-head {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 16px;
		font-weight: 600;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}
	.confirm-body {
		margin: 0;
		/* The one prose surface in the row (sans 16/1.5 — the register break). */
		font-family: var(--font-sans);
		font-size: 16px;
		line-height: 1.5;
		color: var(--color-text);
	}
	.confirm-label {
		font-family: var(--font-mono);
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-muted);
	}

	.destructive {
		min-height: 44px;
		padding: 0 0.9rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-destructive);
		background: var(--color-secondary);
		color: var(--color-destructive);
		font: inherit;
		cursor: pointer;
	}
	.destructive:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
	.destructive:disabled {
		opacity: 0.45;
		cursor: not-allowed;
		color: var(--color-muted);
		border-color: var(--color-border);
	}

	/* Visually-hidden label (the +page.svelte .vh idiom) for the rename input. */
	.vh {
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
