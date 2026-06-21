<!--
  +page.svelte — the M1 app shell: boot the singleton, lay out the three panels in a
  responsive grid, and host the interaction controls driven by `game.machine`.

  The controls implement the ClipboardNarrator flow:
    idle        → Start turn (enabled) + order textarea
    composing/  → Copy prompt
    awaitingPaste→ the labeled paste box (game.submitPaste on input; pasteError inline,
                   box STAYS OPEN on error) + Copy prompt + Cancel turn
    confirming  → the inline confirm controls live in DiceConfirmPanel
  The rejection notice renders whenever game.rejections is non-empty (inline, dismissible,
  one line per {actor}: {reason}). All prose is escaped; no raw-HTML directive anywhere.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { game } from '$lib/game.svelte';
	import { copyTextToClipboard } from '$lib/copy-text';
	import StatePanel from '$lib/components/StatePanel.svelte';
	import StatusStrip from '$lib/components/StatusStrip.svelte';
	import BottomSheet from '$lib/components/BottomSheet.svelte';
	import NarrativePanel from '$lib/components/NarrativePanel.svelte';
	import DiceConfirmPanel from '$lib/components/DiceConfirmPanel.svelte';
	import ContactBeat from '$lib/components/ContactBeat.svelte';
	import ResolutionBanner from '$lib/components/ResolutionBanner.svelte';
	import CampaignLog from '$lib/components/CampaignLog.svelte';
	import ActionMenu from '$lib/components/ActionMenu.svelte';
	import UndoControl from '$lib/components/UndoControl.svelte';
	import ScenarioPicker from '$lib/components/ScenarioPicker.svelte';
	import CampaignsScreen from '$lib/components/CampaignsScreen.svelte';
	import BriefingCard from '$lib/components/BriefingCard.svelte';

	let orderRaw = $state('');
	let copied = $state(false);
	// Phase 12 (D-01/D-02): which on-demand non-modal sheet is open over the mobile rest layout.
	// ONE source of truth (an enum, NEVER two booleans) so "at most one sheet open" (UX-04) is
	// structurally impossible to violate — opening one sheet replaces the other. The StatusStrip's
	// tap-to-drill opens 'state'; the bottom Orders CTA opens 'orders' (which re-hosts the order
	// composition controls). A local UI $state (Svelte 5 runes) — never derived, never a store;
	// mutate-never-reassign holds because it is a primitive reassignment of a component-local `let`,
	// not a cross-module $state export (CLAUDE.md #1 hazard).
	let openSheet = $state<'none' | 'state' | 'orders'>('none');
	// The sticky `.controls` footer paints ABOVE the non-modal sheets (z-index:45 > 40) so the
	// bottom CTA stays reachable. To honor "a sheet EXPANDS ABOVE this anchor, never buries it",
	// the sheet body must reserve the footer's live height so its last control clears the footer
	// (otherwise the in-sheet "Start turn" sits UNDER the footer and a real tap is intercepted).
	// Measure the footer and publish it as the :root `--footer-h` the BottomSheet body pads by.
	// A component-local $state primitive (mutate-never-reassign of a `let`) — not a stored derived.
	let footerEl = $state<HTMLElement | null>(null);
	// Set true when BOTH copy paths fail (insecure context + no execCommand). Reveals a
	// selectable readonly prompt textarea for manual copy. A $state flag (Svelte 5 runes) —
	// never derived, never a store. Deliberately NOT auto-cleared on a timer: the player
	// needs time to manually select-and-copy; it resets only on the next copy attempt.
	let copyFailed = $state(false);
	let rejectionsDismissed = $state(false);
	// The after-action log is a toggled view (UI-SPEC 112) — a local $state flag, not derived.
	let logOpen = $state(false);
	// Phase 13 (OBJ-01 / CONTEXT D-04): the briefing card's open/closed state — EPHEMERAL UI
	// $state ONLY (mutate-never-reassign of a component-local primitive `let`, the exact
	// openSheet/logOpen template; NEVER a cross-module $state export — CLAUDE.md #1 hazard).
	// Nothing is written to GameState / the save / localStorage; on reload at turn 0 the card
	// re-appears (acceptable — D-04). One card, two entry points: auto-open at turn 0 (below) +
	// the "?" recall affordance in the log sheet.
	let briefingOpen = $state(false);
	// Per-campaign auto-open latch (code-review WR-01): the campaignId the briefing was last
	// auto-opened for, NOT a one-shot boolean. `+page.svelte` is never remounted on campaign
	// change — switchCampaign/import/scenario-start reassign `game.state` + `game.campaignId` in
	// place on the singleton — so a one-shot latch would suppress the auto-open for EVERY later
	// turn-0 campaign in the session. Keying on `campaignId` re-arms per campaign: each campaign's
	// turn-0 briefing auto-opens exactly once, and the user's Dismiss still sticks within that
	// campaign (a later state change under the same campaignId never re-fires it until a "?" recall).
	let briefingAutoOpenedFor = $state<string | null>(null);
	// The tapped unit whose ActionMenu is open (ORDER-04) — a local UI selection, not engine
	// state. Null = no menu open. Cleared when the order starts (machine leaves idle/composing).
	let openUnitId = $state<string | null>(null);
	// The player (BLUE) side + its in-play units — the tap-to-order surface offers orders for
	// the player's own units only. $derived over game.state so it tracks casualties/undo.
	const playerSide = $derived(game.state?.sides.find((s) => s.commander === 'player') ?? null);
	const tappedUnit = $derived(
		playerSide && openUnitId
			? (playerSide.units.find((u) => u.id === openUnitId) ?? null)
			: null
	);

	const toggleUnit = (id: string): void => {
		openUnitId = openUnitId === id ? null : id;
	};

	// --- Single-sheet-open helpers (D-02 / UX-04) — opening one always closes the other. ---
	const closeSheet = (): void => {
		openSheet = 'none';
	};
	// Open the Orders sheet for composition. Default-select the player's first unit so the
	// ActionMenu renders INSIDE the sheet immediately (UX-04 — no separate tap-then-menu step,
	// and never a second nested sheet). A no-op selection if one is already open.
	const openOrders = (): void => {
		if (playerSide && !openUnitId) openUnitId = playerSide.units[0]?.id ?? null;
		openSheet = 'orders';
	};
	// Esc closes the open sheet (UI-SPEC Accessibility Basics — the keyboard dismiss path; the
	// pointer path is the handle-drag, the explicit path is the ✕ Close inside the sheet).
	const onKeydown = (e: KeyboardEvent): void => {
		if (e.key !== 'Escape') return;
		// Esc dismisses the briefing card first (it is the topmost non-modal surface when open),
		// then the open sheet — the keyboard dismiss path for both (UI-SPEC Accessibility D-04).
		if (briefingOpen) briefingOpen = false;
		else if (openSheet !== 'none') closeSheet();
	};

	onMount(() => {
		void game.boot();
	});

	// Mirror the live footer height into the :root `--footer-h` custom property (client-only —
	// $effect never runs on the server). A ResizeObserver keeps it correct as the footer grows/
	// shrinks (banner zone staging, secondary controls wrapping, safe-area). The sheets inherit
	// the var via :root, so the BottomSheet body pads its tail clear of the sticky footer.
	$effect(() => {
		const el = footerEl;
		if (!el) return;
		const apply = (): void => {
			document.documentElement.style.setProperty('--footer-h', `${el.offsetHeight}px`);
		};
		apply();
		const ro = new ResizeObserver(apply);
		ro.observe(el);
		return () => {
			ro.disconnect();
			document.documentElement.style.removeProperty('--footer-h');
		};
	});

	// Phase 13 (OBJ-01 / UI-SPEC D-01) — AUTO-OPEN the briefing card at campaign start (turn 0
	// ONLY). The runes-correct per-campaign idiom: this $effect reads `campaignId` + the turn
	// through the proxy and, the FIRST time it observes turn 0 for a campaignId it has not yet
	// auto-opened, opens the card and records that campaignId so a subsequent state change under
	// the SAME campaign never re-fires it — the user's Dismiss therefore sticks within that
	// campaign (auto-open ≠ a persistent re-show). A switch/import/scenario-start to ANOTHER
	// turn-0 campaign re-arms (its id differs), so its briefing auto-opens too (WR-01). At turn > 0
	// the card is recall-only (never auto-shown). On reload at turn 0 it re-appears (acceptable —
	// CONTEXT D-04). It writes NOTHING to the save (ephemeral UI $state).
	$effect(() => {
		const id = game.campaignId;
		if (!id || briefingAutoOpenedFor === id) return;
		if (game.state?.meta.turn === 0) {
			briefingAutoOpenedFor = id;
			briefingOpen = true;
		}
	});

	const start = (): void => {
		rejectionsDismissed = false;
		game.startTurn(orderRaw);
		// The order is in flight — close the tap-to-order menu and clear the typed override box.
		// The Orders sheet stays open so the player can Copy prompt → paste the reply inside it
		// (the composing/awaitingPaste chrome lives in the same sheet — no nested sheet, UX-04).
		openUnitId = null;
		orderRaw = '';
	};

	const copyPrompt = async (): Promise<void> => {
		// Clear any prior failure before re-attempting.
		copyFailed = false;
		// Layered copy: Clipboard API (secure context) → legacy execCommand fallback
		// (insecure context, e.g. plain http:// on the phone). Returns false, never throws,
		// when both paths fail.
		const ok = await copyTextToClipboard(game.prompt);
		if (ok) {
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} else {
			// Visible failure — no silent swallow. Stays set until the next copy attempt so
			// the player has time to manually select-and-copy the prompt textarea below.
			copyFailed = true;
		}
	};

	// Submit on CHANGE (blur/commit), not on every keystroke: settling on `oninput` would
	// advance the machine mid-typing and, on a valid paste, unmount the box out from under
	// an in-flight blur. `onchange` fires once when the field commits — the §5.4 e2e fills
	// then blurs, which dispatches change → submitPaste → machine advances to confirming.
	const onPaste = (e: Event): void => {
		const value = (e.currentTarget as HTMLTextAreaElement).value;
		game.submitPaste(value);
	};

	// ── UX-05: the ONE bottom-anchored morphing CTA (D-05). ──────────────────────────────
	// Its label + disabled + action are a $derived PROJECTION of game.machine — NEVER a stored
	// label (the exact drift this project eliminates: read the machine through the proxy each
	// render). Per the UI-SPEC Copywriting table:
	//   idle          → 'Start turn'   (accent, enabled)  → start()/game.startTurn(orderRaw)
	//   composing     → 'Orders'       (enabled)          → re-open the Orders sheet to copy/paste
	//   awaitingPaste → 'Paste response' (enabled)        → open the Orders sheet (the paste box)
	//   resolving     → 'Resolving…'   (muted, disabled)  → no-op while the engine resolves
	//   confirming    → 'Confirm…'     (disabled)         → the confirm/dice modal owns the beat
	// The action OPENS the Orders sheet for composition/paste (openOrders) — the bottom CTA never
	// itself runs the turn (start() lives on the in-sheet Start-turn button); on idle it opens the
	// sheet so the player can compose. It proposes nothing and writes no ledger value (T-12-03-03).
	const cta = $derived.by<{ label: string; disabled: boolean }>(() => {
		switch (game.machine) {
			case 'idle':
				return { label: 'Start turn', disabled: false };
			case 'composing':
				return { label: 'Orders', disabled: false };
			case 'awaitingPaste':
				return { label: 'Paste response', disabled: false };
			case 'resolving':
				return { label: 'Resolving…', disabled: true };
			case 'confirming':
				return { label: 'Confirm…', disabled: true };
			default:
				return { label: 'Orders', disabled: false };
		}
	});

	// ── UX-06: the ONE modal — the confirm/dice beat, on mobile a native <dialog>. ───────────
	// Sanctioned $effect mirroring the FSM into an EXTERNAL side effect (showModal/close) — the
	// SAME pattern ContactBeat uses for its haptic: an $effect that drives an imperative API, NOT a
	// derived-as-state (it stores no reactive value). The <dialog> itself is conditionally rendered
	// only while confirming (so it is absent from the DOM otherwise — empty-state-collapse contract);
	// when it mounts in the confirming state this effect promotes it to the top layer so ::backdrop
	// (the ONE allowed scrim) and Esc-to-cancel work. On desktop (≥1024px) the dialog is display:none
	// (the DiceConfirmPanel 3rd grid column owns the confirm beat there) — UX-08.
	let dlg = $state<HTMLDialogElement | null>(null);
	$effect(() => {
		if (!dlg) return;
		if (game.machine === 'confirming' && !dlg.open) dlg.showModal();
		else if (game.machine !== 'confirming' && dlg.open) dlg.close();
	});
</script>

<!-- Esc closes whichever non-modal sheet is open (UI-SPEC Accessibility Basics — the keyboard
     dismiss path; the handle-drag and the ✕ Close are the pointer/explicit paths). -->
<svelte:window onkeydown={onKeydown} />

<!-- `data-open-sheet` reflects which on-demand non-modal sheet is open. The State sheet (the
     StatusStrip tap → 'state') re-hosts the unchanged StatePanel; the Orders sheet ('orders',
     opened by the bottom CTA) re-hosts the order-composition controls. ONE enum → at most one
     sheet open at a time (UX-04). -->
<div class="app" data-open-sheet={openSheet}>
	<!-- ScenarioPicker (SCEN-08 + SCEN-01/02): the "New game from scenario" surface. An ADDITIONAL
	     surface gated by game.pickerOpen (toggled by the "New game" control below) — NOT the boot
	     entry point, so it never replaces the game shell or alters boot auto-resume. The "Create
	     new via AI" card hosts the full brief → copy-prompt → paste → import round-trip inline
	     (Plan 03); no page-level placeholder is needed. -->
	{#if game.pickerOpen}
		<section class="picker-overlay" aria-label="New game">
			<ScenarioPicker />
		</section>
	{/if}

	<!-- CampaignsScreen (CAMP-01/05/08): the lifecycle "shelf" mounted as an overlay gated by the
	     render-only `game.campaignsOpen` flag (mirrors the pickerOpen block above). An EMPTY store
	     boots straight here (D-05 — boot opens it on the no-campaign branch); a live game opens it
	     via the persistent `← Campaigns` affordance below WITHOUT losing the in-flight campaign (the
	     live campaign keeps autosaving; opening the shelf is non-destructive — tap a row or Back to
	     return). A close button returns to the preserved game view. -->
	{#if game.campaignsOpen}
		<section class="campaigns-overlay" aria-label="Campaigns">
			<!-- `← Back to game` only when the shelf was opened OVER a live game (D-05). On the empty-
			     store boot landing there is no started game to return to, so the landing offers only
			     New game / Import — never a button that would reveal the hidden bootstrap starter. -->
			{#if game.campaignsDismissible}
				<div class="campaigns-overlay-head">
					<button class="secondary" onclick={() => game.closeCampaigns()}>← Back to game</button>
				</div>
			{/if}
			<CampaignsScreen />
		</section>
	{/if}

	<!-- The polite duplicate toast (CAMP-06) — set by game.duplicate() from the store-written row
	     so it shows the non-colliding "(copy)" suffix the store actually applied. aria-live polite
	     (informational), muted, escaped text only (the name is user-supplied). -->
	{#if game.duplicateToast}
		<p class="dup-toast" role="status" aria-live="polite">{game.duplicateToast}</p>
	{/if}

	<!-- StatusStrip (UX-01/UX-02 / D-03) — the slim, always-visible per-side glance summary,
	     PINNED at the top of the mobile shell (sticky). The whole strip is one tap-to-drill
	     button; its onopenstate opens the State sheet (set here; the sheet that consumes it lands
	     in Plan 02). On desktop (≥1024px) the full StatePanel is the first grid column, so the
	     strip is hidden there (the desktop no-regression: today's 3-column layout is unchanged). -->
	<div class="status-strip-host">
		<StatusStrip onopenstate={() => (openSheet = 'state')} />
	</div>

	<!-- The single structural shell tree (RESEARCH A4 — each panel mounts ONCE and REFLOWS):
	     a flex-column mobile BASE where the narrative is the dominant, always-visible scroller
	     and the State/Dice columns are hidden until they are re-hosted into sheets (Plans 02/03);
	     a 3-column CSS grid on desktop (≥1024px). No double-mount — the same panel instances are
	     laid out by the responsive `.shell-grid` rules. -->
	<main class="shell-grid">
		<div class="col state"><StatePanel /></div>
		<div class="col narrative"><NarrativePanel /></div>
		<div class="col dice"><DiceConfirmPanel /></div>
	</main>

	{#if logOpen}
		<section class="after-action" aria-label="After-action log view">
			<CampaignLog />
		</section>
	{/if}

	<footer class="controls" aria-label="Turn controls" bind:this={footerEl}>
		<!-- UX-06 / D-04: the ONE shared, queued banner zone — ContactBeat (FOG-03) + ResolutionBanner
		     (UI-05) staged just ABOVE the CTA, never buried in the NarrativePanel paragraph (UI-SPEC
		     132/139). CONDITIONALLY rendered — it reserves ZERO height when nothing is staged (an
		     absent element, NOT a height-0 box — Pitfall 3 / Pattern 7), so turn-0 has no reserved
		     banner. Each component keeps its OWN self-gating (staging/dismiss), so the zone shows the
		     contact then the resolution without overlapping. NON-GATING (UI-05): neither touches the
		     turn machine, so the CTA + composition stay enabled while a beat is staged. aria-live
		     polite — informational. Only the flex-1 narrative reflows when it appears/disappears; the
		     sticky strip (top) + CTA (bottom) do not jump. -->
		{#if game.lastResolution || game.contactBeat.count > 0}
			<div class="banner-zone" aria-live="polite">
				<ContactBeat />
				<ResolutionBanner />
			</div>
		{/if}

		<!-- T-r7j-01: the quiet IN-MEMORY-ONLY notice. When IndexedDB is blocked/unavailable
		     (Firefox private / strict tracking / tunneled origin) boot seeds an in-memory
		     campaign and play continues — this tells the player saves are off and offers
		     Export as the escape hatch. NON-BLOCKING: aria-live polite (not assertive like
		     flushError's possible-data-loss alert), escaped text only (no {@html}). -->
		{#if game.saveUnavailable}
			<div class="save-unavailable flush-failed" role="status" aria-live="polite">
				<span>Storage is blocked — your campaign won't be saved. Use Export to keep progress.</span>
				<button class="export" onclick={() => game.exportCampaign()}>Export</button>
			</div>
		{/if}

		<!-- UI-08 / D-05: the recoverable autosave-flush-failed notice. Warning-amber,
		     aria-live assertive (possible data loss), pairs the problem with the Export
		     escape hatch (UI-SPEC lines 147, 243). Set by game.flushSave on a not-ok
		     SaveResult when the tab backgrounded; cleared by a successful export. -->
		{#if game.flushError}
			<div class="flush-failed" role="alert" aria-live="assertive">
				<span>{game.flushError}</span>
				<button class="export" onclick={() => game.exportCampaign()}>Export</button>
			</div>
		{/if}

		{#if game.rejections.length > 0 && !rejectionsDismissed}
			<div class="rejections" role="alert" aria-live="assertive">
				<ul>
					{#each game.rejections as rej, i (i)}
						<li>{rej.actor}: {rej.reason}</li>
					{/each}
				</ul>
				<button class="dismiss" onclick={() => (rejectionsDismissed = true)}>Dismiss</button>
			</div>
		{/if}

		{#if game.pendingActions.length > 0}
			<p class="pending-summary muted" aria-live="polite">
				{game.pendingActions.length} action(s) queued · {[
					...new Set(game.pendingActions.map((a) => a.actor))
				].join(', ')}
			</p>
		{/if}

		<!-- D-05 / UX-05: the ONE bottom-anchored, safe-area-aware morphing CTA. Its label + disabled
		     are a $derived PROJECTION of game.machine (the `cta` derived) — NEVER a stored label.
		     idle → "Start turn", composing → "Orders", awaitingPaste → "Paste response", resolving →
		     "Resolving…" (disabled), confirming → "Confirm…" (disabled — the modal owns the beat). It
		     OPENS the Orders sheet (openOrders) where order composition + the paste box live (D-02 —
		     one Orders sheet, no nested stacking). It is the ONLY accent-filled control; the secondary
		     controls below NEVER use accent. The .cta-bar carries the safe-area floor
		     (env(safe-area-inset-bottom), Plan-01's viewport-fit=cover — UX-05 / Pitfall 4). -->
		<div class="cta-bar">
			<button class="cta" onclick={openOrders} disabled={cta.disabled}>
				{cta.label}
			</button>
		</div>

		<!-- Secondary controls — NEVER accent (the morphing CTA above is the single primary action).
		     The after-action log toggle, the always-reachable Campaigns affordance (CAMP-08 — opens
		     the shelf without losing the in-flight campaign), and the single always-visible undo
		     (UI-07, disabled until ≥1 turn resolved). All reachable without scrolling. -->
		<div class="row secondary-controls">
			<button class="secondary" onclick={() => (logOpen = !logOpen)}>
				{logOpen ? 'Hide log' : 'After-action log'}
			</button>
			<!-- Phase 13 (OBJ-03 / D-03): the "?" recall affordance — re-opens the SAME BriefingCard
			     on demand (one card, two entry points). A real <button> with an accessible name
			     (never a bare glyph), a SECONDARY control (NEVER accent — the morphing CTA is the
			     single primary action). Shown ONLY when a briefing exists (briefing-less seeds get
			     no "?"); no separate hints-"?" beyond recall (CONTEXT D-03). -->
			{#if game.state?.briefing}
				<button
					class="secondary briefing-recall"
					aria-label="Mission briefing & hints"
					onclick={() => (briefingOpen = true)}>?</button
				>
			{/if}
			{#if game.state}
				<button class="secondary campaigns-btn" onclick={() => game.openCampaigns()}
					>← Campaigns</button
				>
			{/if}
			<UndoControl />
		</div>
	</footer>

	<!-- ===== Non-modal sheets (D-02 / UX-03 / UX-04) — at most ONE open via the openSheet enum.
	     Both re-host UNCHANGED panels/controls; opening one closes the other (the {:else if}
	     makes that structural). The narrative prose stays readable AND interactive behind them
	     (no scrim — BottomSheet is a plain <aside>). ===== -->
	{#if openSheet === 'state'}
		<!-- UX-03: tapping the strip opens the full StatePanel in the non-modal State sheet. -->
		<BottomSheet title="Unit state" onclose={closeSheet}>
			<StatePanel />
		</BottomSheet>
	{:else if openSheet === 'orders'}
		<!-- UX-04: ONE Orders sheet hosting ALL order composition INLINE — the tap-to-order
		     picker + ActionMenu, the prose override valve, and the (capped) clipboard boxes.
		     NEVER a nested sheet: the ActionMenu renders inside this sheet, not over it. -->
		<BottomSheet title="Orders" onclose={closeSheet}>
			{#if (game.machine === 'idle' || game.machine === 'composing') && playerSide}
				<div class="tap-to-order" aria-label="Tap a unit to give orders">
					<p class="tap-hint muted">Tap a unit to give orders</p>
					<div class="unit-picker">
						{#each playerSide.units as unit (unit.id)}
							<button
								type="button"
								class="unit-pick"
								class:active={openUnitId === unit.id}
								aria-pressed={openUnitId === unit.id}
								onclick={() => toggleUnit(unit.id)}>{unit.id}</button
							>
						{/each}
					</div>
					{#if tappedUnit}
						<ActionMenu side={playerSide} unit={tappedUnit} />
					{/if}
				</div>
			{/if}

			<!-- ORDER-06 / D-02: the prose textarea is the OVERRIDE VALVE. When tapped actions are
			     queued it relabels to "Or type a free order"; the typed text merges WITH the tapped
			     actions (mergeOrder) and still flows through narrator → dice → rules. -->
			<div class="row order-row">
				<label class="vh" for="order-box">
					{game.pendingActions.length > 0 ? 'Or type a free order' : 'Issue an order in prose'}
				</label>
				<textarea
					id="order-box"
					class="order"
					placeholder={game.pendingActions.length > 0
						? 'Type a one-off order — it still goes through the dice and rules.'
						: 'Issue an order in prose…'}
					bind:value={orderRaw}
					readonly={game.machine !== 'idle' && game.machine !== 'composing'}
				></textarea>
				<button class="cta" onclick={start} disabled={game.machine !== 'idle'}>Start turn</button>
			</div>

			{#if game.machine === 'composing' || game.machine === 'awaitingPaste'}
				<div class="row">
					<button class="secondary" onclick={copyPrompt}>Copy prompt</button>
					<span class="copied" aria-live="polite">{copied ? 'Copied' : ''}</span>
					<button class="destructive" onclick={() => game.cancel()}>Cancel turn</button>
				</div>

				<!-- Manual-copy fallback: shown only when BOTH copy paths failed (no Clipboard
				     API + no execCommand). Surfaces the prompt in a readonly, user-selectable
				     textarea so the player can select-and-copy by hand. Escaped text via the
				     value attribute — NO {@html}, NO raw-HTML directive. The box is CAPPED with an
				     internal scroll (D-04 — replaces the prior uncapped min-height:8rem overflow). -->
				{#if copyFailed}
					<div class="row copy-fallback-row">
						<p class="copy-fallback-notice" role="status" aria-live="polite">
							Automatic copy isn't available here — select and copy the prompt text below
							manually, then paste it into your AI.
						</p>
						<textarea
							class="copy-fallback"
							readonly
							aria-label="Prompt text — select and copy manually"
							value={game.prompt}
						></textarea>
					</div>
				{/if}
			{/if}

			{#if game.machine === 'awaitingPaste'}
				<!-- The paste box is CAPPED with an internal scroll (D-04 — replaces the prior
				     uncapped .paste min-height:6rem footer overflow). onchange (NOT oninput) is
				     load-bearing: submit-on-commit, so a valid paste does not unmount the box
				     mid-blur (preserved verbatim — the §5.4 e2e paste path). -->
				<div class="row paste-row">
					<label class="paste-label" for="paste-box">Paste the AI's JSON reply</label>
					<textarea
						id="paste-box"
						class="paste"
						aria-label="Paste the AI's JSON reply"
						aria-invalid={game.pasteError !== null}
						aria-describedby={game.pasteError ? 'paste-error' : undefined}
						onchange={onPaste}
					></textarea>
					{#if game.pasteError}
						<p id="paste-error" class="paste-error" role="alert">{game.pasteError}</p>
					{/if}
				</div>
			{/if}
		</BottomSheet>
	{/if}

	<!-- ===== Phase 13 (OBJ-01/OBJ-03 / D-01) — the NON-MODAL briefing card. Auto-opens at turn 0
	     (the $effect above), re-opened by the "?" recall, dismissed by ✕ / Dismiss / Esc. It is
	     NON-BLOCKING and must NEVER co-present with the confirm/dice modal (the Phase-12 "confirm/
	     dice is the ONLY modal" rule) — so the mount is guarded on `game.machine !== 'confirming'`.
	     A plain positioned overlay (no scrim, no top-layer dialog), consistent with the Phase-12
	     non-scrim sheet discipline: the narrative stays readable behind it. The card owns its own
	     Close/Dismiss + focus-in/return-to-trigger; here we pass the ephemeral close. ===== -->
	{#if briefingOpen && game.machine !== 'confirming'}
		<div class="briefing-overlay">
			<BriefingCard onclose={() => (briefingOpen = false)} />
		</div>
	{/if}

	<!-- ===== UX-06: the ONE modal — the confirm/dice beat (D-04). On mobile a native <dialog>
	     hosting the UNCHANGED DiceConfirmPanel; on desktop (≥1024px) it is display:none and the
	     DiceConfirmPanel 3rd grid column owns the confirm beat (UX-08, no modal on desktop).
	     CONDITIONALLY rendered only while confirming so it is ABSENT from the DOM otherwise
	     (empty-state-collapse contract); the sanctioned $effect promotes it to the top layer
	     (showModal) on mount so .confirm-modal::backdrop — the ONE allowed scrim — and Esc-to-cancel
	     work. The Confirm/Adjust/Cancel controls live inside DiceConfirmPanel and drive the FSM;
	     the modal proposes nothing and writes no ledger value (T-12-03-03). ===== -->
	{#if game.machine === 'confirming'}
		<dialog
			class="confirm-modal"
			bind:this={dlg}
			aria-label="Confirm and resolve"
			oncancel={(e: Event) => {
				e.preventDefault();
				game.cancel();
			}}
		>
			<DiceConfirmPanel />
		</dialog>
	{/if}
</div>

<style>
	/*
	  Phase 12 D-01 — MOBILE-FIRST BASE. The shell is a flex column that fills (but is not
	  HARD-LOCKED to) the viewport: `min-height:100dvh` (with the 100vh fallback for engines
	  without dvh — never 100vh alone, CLAUDE.md). The narrative scroller owns the page scroll
	  (flex:1; min-height:0; overflow-y:auto), the StatusStrip is pinned sticky at top, and the
	  controls footer is the thumb-zone region (the bottom-anchored morphing CTA proper lands in
	  Plan 03). The old `height:100dvh` NON-scrolling lock + the two desktop-first `max-width`
	  shrink queries are GONE — their cramping is exactly what this inversion removes; the desktop
	  3-column grid now lives ADDITIVELY in the `@media (min-width:1024px)` block below.
	*/
	.app {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		min-height: 100dvh;
		background: #0d1218;
		color: #cdd6e4;
		font-family: ui-sans-serif, system-ui, sans-serif;
		/* The slim strip scrolls its chips HORIZONTALLY within itself (overflow-x:auto); the shell
		   must never gain a horizontal PAGE scroll from that wide content. Clip at the shell. */
		overflow-x: clip;
	}
	/* The slim StatusStrip host — PINNED at the top of the mobile shell (sticky), always visible
	   above the dominant narrative scroller (UX-02 / D-03). z-index keeps it over the scrolling
	   prose; the strip itself carries its own bottom hairline + dominant background. min-width:0 +
	   the shell-level clip keep the strip's own overflow-x scroll from widening the page. */
	.status-strip-host {
		position: sticky;
		top: 0;
		z-index: 10;
		min-width: 0;
		max-width: 100%;
	}
	/* The single structural shell tree. BASE (mobile): a flex column where the narrative is the
	   dominant, always-visible scroller and the State/Dice columns are hidden until they are
	   re-hosted into sheets (Plans 02/03). It REFLOWS into the 3-column grid on desktop — the same
	   panel instances, mounted once (RESEARCH A4). */
	.shell-grid {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		padding: 1rem;
	}
	.col {
		min-height: 0;
	}
	/* Mobile base: the narrative is the dominant region and owns the page scroll. */
	.col.narrative {
		flex: 1;
		overflow-y: auto;
	}
	/* Mobile base: the full StatePanel + DiceConfirmPanel columns are NOT shown inline — the
	   StatusStrip is the at-rest state glance, and the panels move into sheets/modal in Plans
	   02–03. They stay MOUNTED (single structural tree, no double-mount) but hidden here until
	   re-hosted; the desktop grid below reveals them as columns again (UX-08 no-regression). */
	.col.state,
	.col.dice {
		display: none;
	}
	/* The persistent thumb-zone chrome. PINNED at the bottom (sticky) and z-index ABOVE the
	   non-modal sheets (z-index:40) so the bottom CTA stays reachable while a sheet is open — a
	   sheet EXPANDS ABOVE this anchor, never buries it (the CTA is the always-available action;
	   the non-modal sheet leaves the page interactive, UX-03/D-05). The safe-area floor lands in
	   Plan 03's CTA bar; this plan keeps the controls reachable. */
	/* UX-05: the persistent thumb-zone chrome IS the bottom CTA bar — PINNED at the bottom (sticky)
	   and z-index ABOVE the non-modal sheets (z-index:40) so the CTA stays reachable while a sheet
	   is open (a sheet EXPANDS ABOVE this anchor, never buries it). The safe-area FLOOR lives here:
	   the bottom padding is `max(8px, env(safe-area-inset-bottom))` so the CTA clears the iOS home
	   indicator / Android gesture bar (Plan-01's viewport-fit=cover makes the inset non-zero), while
	   the max() keeps a real floor on zero-inset devices (Pitfall 4). */
	.controls {
		position: sticky;
		bottom: 0;
		z-index: 45;
		border-top: 1px solid #243040; /* border */
		background: #0b0f14; /* dominant — opaque so the scrolling prose doesn't show through */
		padding: 8px 16px max(8px, env(safe-area-inset-bottom)) 16px;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	/* UX-06 / D-04: the ONE shared queued banner zone, pinned just above the CTA. CONDITIONALLY
	   rendered (zero height when empty — NOT a height-0 box). When present it stacks ContactBeat
	   then ResolutionBanner with a small gap; each keeps its own surface + self-gating. */
	.banner-zone {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	/* The single primary action row — full-width morphing CTA. */
	.cta-bar {
		display: flex;
	}
	.cta-bar .cta {
		width: 100%;
		min-height: 44px;
	}
	/* Secondary controls never compete with the primary CTA: they wrap below, share the row, and
	   never use the accent fill (only the morphing CTA is accent). */
	.secondary-controls .secondary {
		flex: 1 1 auto;
	}
	.after-action {
		border-top: 1px solid #243040;
		padding: 1.5rem;
		max-height: 40vh;
		min-height: 0;
		display: flex;
	}
	/* Both surfaces are the app's HOME shelf when open — the UI-SPEC makes the Campaigns screen
	   the shell home + boot landing. They must COVER the game shell, not stack inline above it:
	   a position:static section renders ABOVE the still-present .grid + footer, so the game board
	   and its controls paint underneath and the screen duplicates ("New game" / "← Campaigns"
	   twice). position:fixed + inset:0 + an OPAQUE dominant background fully covers the game,
	   which stays mounted in the DOM (so the live campaign keeps autosaving — opening the shelf is
	   non-destructive); the overlay itself is the scroller. z-index sits above the grid + footer. */
	.picker-overlay,
	.campaigns-overlay {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: #0b0f14; /* opaque — fully hides the game shell behind the shelf */
		display: flex;
		flex-direction: column;
		overflow-y: auto;
	}
	/* The picker is opened FROM the Campaigns shelf (its `New game`), so when both are open the picker
	   must layer ABOVE the shelf — otherwise the same-z, later-in-DOM campaigns overlay would re-cover
	   it and `New game` would appear to do nothing. On a successful start both surfaces close. */
	.picker-overlay {
		z-index: 60;
	}
	.campaigns-overlay-head {
		display: flex;
		padding: 1rem 1rem 0;
	}
	/* The Campaigns affordance + Back button get the ACCENT focus ring (never the page's blue). */
	.campaigns-btn:focus-visible,
	.campaigns-overlay-head .secondary:focus-visible {
		outline: 2px solid #3fb68b; /* accent */
		outline-offset: 2px;
	}
	.dup-toast {
		margin: 0;
		padding: 0.5rem 0.75rem;
		color: #7e8a99; /* muted — informational */
		font-size: 0.9rem;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.paste-row {
		flex-direction: column;
		align-items: stretch;
	}
	textarea {
		font: inherit;
		background: #131b24;
		color: #cdd6e4;
		border: 1px solid #243040;
		border-radius: 0.375rem;
		padding: 0.5rem;
		resize: vertical;
	}
	.order {
		flex: 1;
		min-height: 2.5rem;
	}
	/* D-04: capped with an internal scroll inside the Orders sheet (replaces the prior uncapped
	   footer min-height:6rem that overflowed the cramped footer). The sheet body owns the page
	   scroll; the box itself never grows unbounded. */
	.paste {
		min-height: 6rem;
		max-height: 30dvh;
		overflow-y: auto;
	}
	.paste-label {
		font-size: 0.85rem;
		color: #9aa7ba;
	}
	.paste[aria-invalid='true'] {
		border-color: #e0524d;
	}
	.paste-error {
		margin: 0.25rem 0 0;
		color: #e0524d;
		font-size: 0.85rem;
	}
	.copied {
		font-size: 0.85rem;
		color: #3fae6b;
		min-width: 3rem;
	}
	.copy-fallback-row {
		flex-direction: column;
		align-items: stretch;
	}
	.copy-fallback-notice {
		margin: 0 0 0.25rem;
		font-size: 0.85rem;
		color: #d9a441; /* warning amber — copy degraded, manual action needed */
	}
	/* D-04: capped with an internal scroll inside the Orders sheet (replaces the prior uncapped
	   footer min-height:8rem that overflowed the cramped footer). */
	.copy-fallback {
		width: 100%;
		min-height: 8rem;
		max-height: 30dvh;
		overflow-y: auto;
		font-family: ui-monospace, 'SF Mono', monospace;
		font-size: 0.85rem;
	}
	.muted {
		color: #6b7686;
	}
	.pending-summary {
		margin: 0;
		font-size: 0.85rem;
	}
	.tap-to-order {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.tap-hint {
		margin: 0;
		font-size: 0.8rem;
	}
	.unit-picker {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.unit-pick {
		min-height: 44px;
		padding: 0 0.9rem;
		border-radius: 0.375rem;
		border: 1px solid #243040;
		background: #151b23;
		color: #d7dee6;
		font: inherit;
		cursor: pointer;
	}
	.unit-pick.active {
		border-color: #3fb68b;
		color: #d7dee6;
	}
	.unit-pick:focus-visible {
		outline: 2px solid #3fb68b;
		outline-offset: 2px;
	}
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
	.rejections {
		border: 1px solid #6b2422;
		border-radius: 0.375rem;
		padding: 0.5rem 0.75rem;
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
		color: #e0524d;
	}
	.flush-failed {
		border: 1px solid #d9a441; /* warning */
		border-radius: 0.375rem;
		padding: 0.5rem 0.75rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		color: #d9a441; /* warning amber — possible data loss, recoverable */
		font-size: 0.9rem;
	}
	.export {
		min-height: auto;
		padding: 0.35rem 0.75rem;
		border-color: #d9a441;
		color: #d9a441;
	}
	.rejections ul {
		margin: 0;
		padding-left: 1rem;
		font-size: 0.9rem;
	}
	button {
		min-height: 44px;
		padding: 0 0.9rem;
		border-radius: 0.375rem;
		border: 1px solid #243040;
		background: #1a232f;
		color: #cdd6e4;
		cursor: pointer;
		font: inherit;
	}
	button:focus-visible {
		outline: 2px solid #3f7ae0;
		outline-offset: 2px;
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.cta {
		background: #2a5db0;
		border-color: #3f7ae0;
		color: #fff;
	}
	/* UX-05: the bottom-anchored morphing CTA is the ONE accent-filled action — accent green
	   (#3fb68b) when enabled, with an accent focus ring. Disabled (resolving/confirming) falls back
	   to the global button:disabled muting. Scoped to .cta-bar so the in-sheet Start-turn button and
	   the DiceConfirmPanel confirm button keep their own styling. */
	.cta-bar .cta {
		background: #3fb68b; /* accent */
		border-color: #3fb68b; /* accent */
		color: #0b0f14; /* dominant — high-contrast label on accent */
		font-weight: 600;
	}
	.cta-bar .cta:focus-visible {
		outline: 2px solid #3fb68b; /* accent */
		outline-offset: 2px;
	}
	.cta-bar .cta:disabled {
		background: #1a232f;
		border-color: #243040;
		color: #6b7686; /* muted — resolving/confirming */
	}
	.destructive {
		color: #e0524d;
		border-color: #6b2422;
	}
	.dismiss {
		min-height: auto;
		padding: 0.25rem 0.6rem;
	}

	/* Phone fix (now part of the mobile BASE, not a max-width shrink): the order textarea takes a
	   full line so the two order-row buttons wrap below it (otherwise textarea + Start + log cram
	   one wrapping line, crushing the textarea to ~70px). Keep the global 44px tap target. */
	.order {
		flex-basis: 100%;
		min-height: 3.25rem;
	}
	.controls .row .secondary {
		flex: 1 1 auto;
	}

	/* Phase 13 (OBJ-01 / D-01): the NON-MODAL briefing-card overlay. A plain positioned layer —
	   NOT a native top-layer <dialog>, NO scrim element (consistent with the Phase-12 non-scrim
	   sheet discipline; the narrative stays readable behind it). It sits above the shell + sheets
	   but the confirm/dice <dialog> (top layer via showModal) always paints above it AND the card
	   is gated off while confirming, so the two never co-present. The overlay scrolls if the card
	   is taller than the viewport; the card itself centers within the readable column. */
	.briefing-overlay {
		position: fixed;
		inset: 0;
		z-index: 48; /* above sheets (40) + footer (45); below the confirm <dialog> top layer */
		display: flex;
		align-items: flex-start;
		justify-content: center;
		overflow-y: auto;
		padding: 16px; /* md */
		/* Clear the iOS home indicator / Android gesture bar at the bottom of a long card. */
		padding-bottom: max(16px, env(safe-area-inset-bottom));
		box-sizing: border-box;
	}
	/* The "?" recall is a compact square secondary control — accessible name on the button, the
	   glyph is the visible label. Never accent (the morphing CTA is the single primary action). */
	.briefing-recall {
		flex: 0 0 auto;
		min-width: 44px;
		font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
		font-weight: 600;
	}
	.briefing-recall:focus-visible {
		outline: 2px solid #3fb68b; /* accent — focus ring only, never a fill */
		outline-offset: 2px;
	}
	/* Reduced motion: the card appears/disappears instantly — there is no transition here, so this
	   is satisfied by construction (declared for intent / UI-SPEC a11y). */
	@media (prefers-reduced-motion: reduce) {
		.briefing-overlay {
			transition: none;
		}
	}

	/* UX-06 / D-04: the ONE modal — the confirm/dice <dialog>. A native <dialog> shown via
	   showModal() (the sanctioned $effect) so it sits on the browser top layer ABOVE every other
	   surface (no surface can mask it — T-12-03-01) and gets ::backdrop. Mobile presentation: a
	   bottom-anchored sheet-like card on the secondary surface, clearing the safe-area floor; the
	   body scrolls if the confirm rows overflow. */
	.confirm-modal {
		margin: 0 auto auto;
		position: fixed;
		inset: auto 0 0 0;
		width: 100%;
		max-width: 100%;
		max-height: 85dvh;
		overflow-y: auto;
		border: 1px solid #243040; /* border */
		border-radius: 0.5rem 0.5rem 0 0;
		background: #0b0f14; /* dominant */
		color: #cdd6e4; /* text */
		padding: 1rem 1.5rem max(1rem, env(safe-area-inset-bottom)) 1.5rem;
	}
	/* The ONE allowed scrim — the confirm modal's backdrop. No non-modal sheet has a scrim. */
	.confirm-modal::backdrop {
		background: rgb(0 0 0 / 0.6);
	}

	/*
	  Phase 12 D-01 — DESKTOP ADDITIVE OVERRIDE (UX-08 no-regression). At ≥1024px the shell
	  reflows to the EXISTING 3-column grid, moved VERBATIM from today's base (RESEARCH Pitfall 6
	  — `grid-template-columns: 28% 1fr 30%; gap: 32px` are the unchanged values, diffable against
	  the prior layout). The StatusStrip is the mobile-only at-rest glance, so it is hidden on
	  desktop where the full StatePanel is the first column. Each `.col` becomes its OWN scroller
	  within the grid row (min-height:0 + overflow-y:auto) — the prior `.col` behavior, restored.
	*/
	@media (min-width: 1024px) {
		.shell-grid {
			display: grid;
			grid-template-columns: 28% 1fr 30%;
			gap: 32px;
			padding: 1.5rem;
		}
		.col {
			min-height: 0;
			overflow-y: auto;
		}
		/* Restore all three columns as the desktop layout (mobile hides state/dice). */
		.col.state,
		.col.dice {
			display: block;
		}
		.col.narrative {
			flex: none;
		}
		.col + .col {
			padding-left: 32px;
			border-left: 1px solid #243040;
		}
		/* The strip is the mobile at-rest glance only; desktop shows the full StatePanel column. */
		.status-strip-host {
			display: none;
		}
		/* UX-08: NO modal on desktop. The confirm beat is the DiceConfirmPanel 3rd grid column here,
		   so the mobile confirm <dialog> is hidden (even when showModal() runs, display:none keeps it
		   off-screen — the column owns the confirm rows on wide viewports). */
		.confirm-modal {
			display: none;
		}
	}
</style>
