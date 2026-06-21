<!--
  ScenarioPicker.svelte — SCEN-08: the scenario library card grid.

  RENDER + DISPATCH ONLY (mirrors NarrativePanel's discipline): it imports the `game` bridge,
  lists the two shipped scenarios via `game.listScenarios()`, and renders each as a card with
  readable metadata (sides · terrain/weather · objectives · starting forces) PLUS a "Create new
  via AI" card. No engine imports, no load logic here — selecting a shipped card calls the bridge
  `game.newGameFromScenario(id)`; selecting "Create new via AI" fires the `oncreatenew` callback
  prop the page wires to the Plan-03 import flow (a PLACEHOLDER hook here — the paste round-trip
  is Plan 03, not this plan).

  SCOPE GUARD (CONTEXT Out-of-scope): this picker only STARTS new games from scenarios. It does
  NOT list/resume/rename/delete existing campaigns (Phase 10) and is NOT the global boot entry
  point — it is reached via a "New game" action on the page.

  SECURITY CONTRACT (T-09B-01, clone NarrativePanel): scenario / AI-authored metadata is
  UNTRUSTED. EVERY scenario-supplied string (name, terrain, weather, objectives, forces) is
  rendered as ESCAPED `{value}` interpolation — there is NO raw-HTML render directive anywhere
  in this file. Injected markup appears as literal text, never executes.
-->
<script lang="ts">
	import { game } from '../game.svelte';
	import { buildScenarioPrompt } from '../engine';
	import { copyTextToClipboard } from '../copy-text';
	import type { CatalogEntry } from '../engine';

	// Optional callback the page can pass to be notified when the player opens the "Create new
	// via AI" flow (e.g. to reveal additional page chrome). The import round-trip itself lives
	// entirely in this picker + the bridge — this is purely an opt-in page hook.
	const { oncreatenew }: { oncreatenew?: () => void } = $props();

	// Load the bundled scenario rows once. A $state list populated from the async store call;
	// it is reassigned (mutate-then-reassign) so runes reactivity holds. Never derived (the
	// source is an async Promise, not a synchronous reactive value).
	let scenarios = $state<CatalogEntry[]>([]);
	$effect(() => {
		void game.listScenarios().then((rows) => {
			scenarios = rows;
		});
	});

	const choose = (id: string): void => {
		void game.newGameFromScenario(id);
	};

	// ── "Create new via AI" import flow (SCEN-01/02) — the SAME round-trip the turn uses ──────
	// `creating` reveals the brief→copy-prompt→paste→create slice; `brief`/`paste` are the two
	// local textarea buffers; `copied`/`copyFailed` give the copy button momentary feedback.
	// The rejection reason is read from the bridge (`game.scenarioImportError`) so the picker
	// renders + dispatches only — the recoverable-paste machinery stays in the bridge.
	let creating = $state(false);
	let brief = $state('');
	let paste = $state('');
	let copied = $state(false);
	let copyFailed = $state(false);

	const openCreate = (): void => {
		creating = true;
		game.scenarioImportError = null;
		oncreatenew?.();
	};

	const copyPrompt = async (): Promise<void> => {
		copyFailed = false;
		// buildScenarioPrompt is TOTAL — a terse or empty brief still yields a complete prompt.
		const ok = await copyTextToClipboard(buildScenarioPrompt(brief));
		if (ok) {
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} else {
			// Visible failure, never a silent swallow — the player can select the prompt manually.
			copyFailed = true;
		}
	};

	// Hand the RAW paste to the bridge; it runs extract → shape-validate → load and sets
	// `game.scenarioImportError` on any failure (the box stays open, re-pasteable). On success
	// the bridge closes the picker, so this resolves into a mounted new campaign.
	const createCampaign = async (): Promise<void> => {
		await game.importScenarioFromPaste(paste);
	};
</script>

<section class="picker" aria-label="Choose a scenario">
	<header class="picker-head">
		<h2>New game</h2>
		<button class="close" type="button" onclick={() => game.closePicker()}>Close</button>
	</header>

	<div class="cards">
		{#each scenarios as scenario (scenario.id)}
			<article class="card">
				<h3 class="title">{scenario.name}</h3>

				<dl class="meta">
					{#if scenario.terrain}
						<div class="meta-row">
							<dt>Terrain</dt>
							<dd>{scenario.terrain}</dd>
						</div>
					{/if}
					{#if scenario.weather}
						<div class="meta-row">
							<dt>Weather</dt>
							<dd>{scenario.weather}</dd>
						</div>
					{/if}
				</dl>

				{#if scenario.sides}
					<ul class="sides">
						{#each scenario.sides as side (side.id)}
							<li class="side">
								<div class="side-head">
									<span class="side-id">{side.id}</span>
									<span class="side-role">{side.commander}</span>
								</div>
								<div class="forces">{side.forces}</div>
								<ul class="objectives">
									{#each side.objectives as objective, i (i)}
										<li>{objective}</li>
									{/each}
								</ul>
							</li>
						{/each}
					</ul>
				{/if}

				<button class="play" type="button" onclick={() => choose(scenario.id)}>
					Play {scenario.name}
				</button>
			</article>
		{/each}

		<!-- The "Create new via AI" card (SCEN-01/02). Describe a scenario → copy a generation
		     prompt → paste the AI's turn-0 seed → it imports through the SAME validated round-trip
		     turns use. A bad paste is a recoverable inline error; the box stays re-pasteable. All
		     brief / error text is rendered ESCAPED {value} — never a raw-HTML directive. -->
		<article class="card create-new">
			<h3 class="title">Create new via AI</h3>
			{#if !creating}
				<p class="create-blurb">
					Describe a scenario and have an AI author the starting board — then paste it back to
					play it.
				</p>
				<button class="play" type="button" onclick={openCreate}>Create new via AI</button>
			{:else}
				<div class="create-flow">
					<label class="field">
						<span class="field-label">Describe your scenario</span>
						<textarea
							class="brief"
							rows="3"
							bind:value={brief}
							placeholder="e.g. usmc squad on patrol in kandahar"
						></textarea>
					</label>

					<div class="copy-row">
						<button class="secondary" type="button" onclick={copyPrompt}>
							{copied ? 'Copied!' : 'Copy prompt'}
						</button>
						<span class="copy-hint">Paste it into any AI, then paste its JSON below.</span>
					</div>
					{#if copyFailed}
						<p class="copy-failed" role="status" aria-live="polite">
							Couldn’t copy automatically — select the prompt manually if needed.
						</p>
					{/if}

					<label class="field">
						<span class="field-label">Paste the AI’s scenario JSON</span>
						<textarea
							class="paste"
							rows="4"
							bind:value={paste}
							placeholder="Paste the AI's ```json block here"
						></textarea>
					</label>

					{#if game.scenarioImportError}
						<p class="import-error" role="alert" aria-live="assertive">
							{game.scenarioImportError}
						</p>
					{/if}

					<button class="play" type="button" onclick={createCampaign}>Create campaign</button>
				</div>
			{/if}
		</article>
	</div>
</section>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 16px;
		background: #0b0f14;
		color: #d7dee6;
		font-family: ui-sans-serif, system-ui, sans-serif;
		padding: 1.5rem;
	}
	.picker-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.picker-head h2 {
		margin: 0;
		font-size: 1.25rem;
	}
	.close {
		min-height: 44px;
		padding: 0 0.9rem;
		border-radius: 0.375rem;
		border: 1px solid #243040;
		background: #1a232f;
		color: #cdd6e4;
		cursor: pointer;
		font: inherit;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 16px;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 12px;
		border: 1px solid #243040;
		border-radius: 0.5rem;
		padding: 1rem;
		background: #101720;
	}
	.card.create-new {
		border-style: dashed;
		border-color: #3f7ae0;
	}
	.title {
		margin: 0;
		font-size: 1.05rem;
	}
	.meta {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.meta-row {
		display: flex;
		gap: 8px;
		font-size: 0.85rem;
	}
	.meta-row dt {
		margin: 0;
		color: #7e8a99;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-size: 0.72rem;
		min-width: 4.5rem;
	}
	.meta-row dd {
		margin: 0;
	}
	.sides {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.side {
		border-left: 2px solid #243040;
		padding-left: 10px;
	}
	.side-head {
		display: flex;
		gap: 8px;
		align-items: baseline;
	}
	.side-id {
		font-family: ui-monospace, 'SF Mono', monospace;
		font-weight: 600;
	}
	.side-role {
		color: #7e8a99;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.forces {
		font-size: 0.85rem;
		color: #b6c0cd;
	}
	.objectives {
		margin: 4px 0 0;
		padding-left: 1rem;
		font-size: 0.85rem;
		color: #cdd6e4;
	}
	.create-blurb {
		margin: 0;
		font-size: 0.9rem;
		color: #b6c0cd;
	}
	.create-flow {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.field-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #7e8a99;
	}
	.brief,
	.paste {
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		border: 1px solid #243040;
		border-radius: 0.375rem;
		background: #0b0f14;
		color: #d7dee6;
		padding: 0.5rem;
		font: inherit;
	}
	.brief:focus-visible,
	.paste:focus-visible {
		outline: 2px solid #3f7ae0;
		outline-offset: 1px;
	}
	.copy-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.copy-hint {
		font-size: 0.8rem;
		color: #7e8a99;
	}
	.copy-failed {
		margin: 0;
		font-size: 0.8rem;
		color: #e0b03f;
	}
	.import-error {
		margin: 0;
		font-size: 0.85rem;
		color: #e06a6a;
	}
	.secondary {
		min-height: 44px;
		padding: 0 0.9rem;
		border-radius: 0.375rem;
		border: 1px solid #243040;
		background: #1a232f;
		color: #cdd6e4;
		cursor: pointer;
		font: inherit;
	}
	.secondary:focus-visible {
		outline: 2px solid #3f7ae0;
		outline-offset: 2px;
	}
	.play {
		margin-top: auto;
		min-height: 44px;
		padding: 0 0.9rem;
		border-radius: 0.375rem;
		border: 1px solid #3f7ae0;
		background: #2a5db0;
		color: #fff;
		cursor: pointer;
		font: inherit;
	}
	.play:focus-visible,
	.close:focus-visible {
		outline: 2px solid #3f7ae0;
		outline-offset: 2px;
	}
</style>
