<!--
  +layout.svelte (UI-08 / D-05) — the NON-engine PWA lifecycle shell.

  This is the correct home for every browser-lifecycle + service-worker surface (CORE-02:
  PWA / `pagehide` / `beforeinstallprompt` code lives in src/routes, NEVER in src/lib/engine).
  It wraps every page and owns three responsibilities:

    1. AUTOSAVE FLUSH ON BACKGROUNDING — on `pagehide` and `visibilitychange:hidden` (the
       Android-Chrome-reliable pair) start `game.flushSave()` synchronously so the in-flight
       turn is durably persisted before the tab is frozen/discarded. We deliberately do NOT
       use the legacy unload-time event (RESEARCH Pitfall 3 — it is skipped on Android
       tab-kill and blocks bfcache); pagehide + visibilitychange:hidden are the reliable pair. A flush
       whose save returns not-ok sets `game.flushError`, surfaced by +page.svelte.

    2. PWA OFFLINE-READY / UPDATE TOASTS — `useRegisterSW()` from the plugin's
       `virtual:pwa-register/svelte` virtual module exposes `offlineReady` / `needRefresh`
       Svelte stores + `updateServiceWorker`. `registerType: 'prompt'` means a new SW NEVER
       auto-reloads mid-turn — the user gets a non-blocking "New version ready" toast with a
       Reload action they trigger on their own terms (T-07-05-01).

    3. INSTALL AFFORDANCE — capture `beforeinstallprompt`, surface a quiet, non-nagging
       "Install Frosty" card (Install + Not now). Shown once per captured prompt event;
       re-surfaceable (the captured event is re-usable until consumed).

  REACTIVITY (CLAUDE.md #1 hazard): the PWA register stores are consumed via Svelte's `$store`
  auto-subscription (they satisfy the store contract); the only local runes state is the
  install-prompt event + a dismissed flag. No derived-as-state, no legacy unload-time hook.

  SECURITY: every toast/card is STATIC copy (no AI prose) — no `{@html}` anywhere (T-07-05-04).
-->
<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { useRegisterSW } from 'virtual:pwa-register/svelte';
	import { pwaInfo } from 'virtual:pwa-info';
	import { game } from '$lib/game.svelte';

	let { children } = $props();

	// ── PWA manifest-link injection (ISSUE-A) ────────────────────────────────────────
	// Chrome's install criteria require a discoverable <link rel="manifest">. The build tool
	// (vite-plugin-pwa) emits the base-prefixed, content-hashed link via `virtual:pwa-info`;
	// injecting it single-sources the manifest path off BASE_PATH (D-02) — never a hardcoded
	// <link> in app.html.
	//
	// $derived, NOT `$:` — `runes: true` (svelte.config.js) makes the Svelte-4 idiom a compile
	// error (CLAUDE.md #1 hazard). `pwaInfo` is `undefined` on the SSR/prerender pass, so the
	// guard yields '' and the {@html} renders nothing harmful (the tag injects client-side on
	// hydration — RESEARCH Pitfall 5 / OQ#1).
	const webManifestLink = $derived(pwaInfo ? pwaInfo.webManifest.linkTag : '');

	// ── PWA service-worker registration (offline-ready + update toasts) ──────────────
	// The plugin's Svelte hook returns Writable stores; consume via $store auto-subscribe.
	const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW();

	// One-time muted "Ready to play offline." toast — dismissible, never re-nags.
	const dismissOfflineReady = (): void => {
		offlineReady.set(false);
	};

	// Non-blocking "New version ready — reload" toast. The Reload calls updateServiceWorker(true)
	// which activates the waiting SW then reloads — only on the user's tap, never mid-turn.
	const reloadForUpdate = (): void => {
		void updateServiceWorker(true);
	};
	const dismissUpdate = (): void => {
		needRefresh.set(false);
	};

	// ── Install affordance (beforeinstallprompt) ─────────────────────────────────────
	// The captured event is a browser BeforeInstallPromptEvent; type it locally (no DOM lib
	// global for it). Holding the event lets us trigger the native prompt from our own CTA.
	interface BeforeInstallPromptEvent extends Event {
		prompt: () => Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
	}
	let installPrompt = $state<BeforeInstallPromptEvent | null>(null);
	let installDismissed = $state(false);

	const install = async (): Promise<void> => {
		const evt = installPrompt;
		if (!evt) return;
		// Consume the captured prompt: show the native install dialog, then drop the event
		// (a BeforeInstallPromptEvent can be prompted once). A future event re-surfaces the card.
		installPrompt = null;
		await evt.prompt();
	};
	const dismissInstall = (): void => {
		installDismissed = true;
	};

	// ── Lifecycle wiring (browser APIs — legitimate in the non-engine route layer) ───
	onMount(() => {
		// Start the idb write synchronously inside the handler so it is allowed to complete
		// before the tab freezes (RESEARCH Pattern 7). Frosty has no network round-trip, so
		// this is durable on Android. `void` — fire-and-forget; the result lands in flushError.
		const flush = (): void => {
			void game.flushSave();
		};
		const onVisibility = (): void => {
			if (document.visibilityState === 'hidden') flush();
		};
		const onBeforeInstall = (e: Event): void => {
			// Prevent Chrome's mini-infobar so we can surface our own quiet card instead.
			e.preventDefault();
			installPrompt = e as BeforeInstallPromptEvent;
			installDismissed = false;
		};

		addEventListener('pagehide', flush);
		addEventListener('visibilitychange', onVisibility);
		addEventListener('beforeinstallprompt', onBeforeInstall);

		return () => {
			removeEventListener('pagehide', flush);
			removeEventListener('visibilitychange', onVisibility);
			removeEventListener('beforeinstallprompt', onBeforeInstall);
		};
	});
</script>

<!--
  ISSUE-A manifest link. This `{@html}` is the ONE sanctioned exception to this file's
  no-`{@html}` contract (line 29: "every toast/card is STATIC copy … no `{@html}` anywhere").
  It is SAFE because `webManifestLink` is `pwaInfo.webManifest.linkTag` — a BUILD-TIME constant
  emitted by the build tool (vite-plugin-pwa via `virtual:pwa-info`), never AI prose, never
  user/runtime input, so it carries no injection surface. This is the framework-sanctioned idiom
  for manifest-link injection (RESEARCH Pitfall 3). Do NOT generalize it to any runtime string.
-->
<svelte:head>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html webManifestLink}
</svelte:head>

<!-- PWA notices live above the routed page so they are reachable without scrolling. -->
{#if installPrompt && !installDismissed}
	<section class="pwa-card" aria-label="Install Frosty">
		<div class="pwa-copy">
			<div class="pwa-heading">Install Frosty</div>
			<p class="pwa-body">Add to your home screen to launch offline and play full-screen.</p>
		</div>
		<div class="pwa-actions">
			<button class="pwa-cta" onclick={install}>Install</button>
			<button class="pwa-secondary" onclick={dismissInstall}>Not now</button>
		</div>
	</section>
{/if}

{#if $offlineReady}
	<div class="pwa-toast" role="status" aria-live="polite">
		<span>Ready to play offline.</span>
		<button class="pwa-secondary" onclick={dismissOfflineReady}>Dismiss</button>
	</div>
{/if}

{#if $needRefresh}
	<div class="pwa-toast" role="status" aria-live="polite">
		<span>New version ready — reload to update.</span>
		<button class="pwa-cta" onclick={reloadForUpdate}>Reload</button>
		<button class="pwa-secondary" onclick={dismissUpdate}>Later</button>
	</div>
{/if}

{@render children()}

<style>
	/* All surfaces bind the locked Phase-5 tokens (no new color/type) — secondary fill,
	   border hairline, text/muted, mono register. ≥44px tap targets (phone-first floor). */
	.pwa-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px; /* md */
		padding: 12px 16px;
		background: #151b23; /* secondary */
		border-bottom: 1px solid #243040; /* border */
		color: #d7dee6; /* text */
	}
	.pwa-copy {
		display: flex;
		flex-direction: column;
		gap: 4px; /* xs */
		min-width: 0;
	}
	.pwa-heading {
		font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
		font-size: 16px;
		font-weight: 600;
		line-height: 1.2;
	}
	.pwa-body {
		margin: 0;
		font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
		font-size: 14px;
		font-weight: 400;
		line-height: 1.5;
		color: #7e8a99; /* muted */
	}
	.pwa-actions {
		display: flex;
		gap: 8px; /* sm */
		flex-shrink: 0;
	}
	.pwa-toast {
		display: flex;
		align-items: center;
		gap: 8px; /* sm */
		padding: 12px 16px;
		background: #151b23; /* secondary */
		border-bottom: 1px solid #243040; /* border */
		color: #7e8a99; /* muted — the offline/update toasts are informational */
		font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
		font-size: 14px;
	}
	.pwa-toast span {
		flex: 1;
		min-width: 0;
	}
	button {
		min-height: 44px;
		padding: 0 16px; /* md */
		border-radius: 6px;
		border: 1px solid #243040; /* border */
		background: #0b0f14; /* dominant — chrome, never accent-filled by default */
		color: #d7dee6; /* text */
		font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
		font-size: 14px;
		cursor: pointer;
	}
	button:focus-visible {
		outline: 2px solid #3fb68b; /* accent */
		outline-offset: 2px;
	}
	/* The single accent-earning CTA per surface (Install / Reload) — the primary action. */
	.pwa-cta {
		border-color: #3fb68b; /* accent */
		color: #d7dee6;
	}
	.pwa-secondary {
		color: #7e8a99; /* muted dismiss — never nags */
	}
</style>
