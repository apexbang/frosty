<!-- GSD:project-start source:PROJECT.md -->
## Project

**Frosty — Tactical Wargame Engine**

A single-player, turn-based tactical wargame for the browser (installable PWA) where **code owns the simulation and the AI owns judgment and prose**. Code holds state, dice, arithmetic, and all categorical invariants; the AI interprets orders, authors the enemy's move, adjudicates contested actions, and narrates. It is a deliberate rebuild of a prior chat-based version, designed to eliminate the long-campaign LLM degradation that plagued the original.

**Core Value:** **Every turn starts clean.** Because code maintains state and hands the model only what *this* turn needs, turn 50 is as sharp as turn 1 — the long-campaign drift that motivated the rebuild stops existing rather than being mitigated, and the model's prose can be as rich as you like without ever risking the ledger.

### Constraints

- **Tech stack**: SvelteKit + **Svelte 5 with runes (pinned)** — the one real codegen hazard is mixing Svelte 4/5 reactivity idioms. — Pin to avoid silent reactivity bugs.
- **Tech stack**: **TypeScript, non-negotiable** — the move envelope and state are precisely the typed contracts that catch errors before runtime, and generated code is materially better against them.
- **Architecture**: the **engine is pure, framework-free TS** in `/lib/engine/` (imports nothing from Svelte); Svelte only renders state and captures input. — Keeps the framework choice low-stakes and the engine unit-testable.
- **Tech stack**: Tailwind for styling (least consequential; swappable for plain CSS), Browser **PWA** (installable on Android), Capacitor/native deferred to M4.
- **Authority rule**: the AI's output has **zero authority over the ledger** — consumables only ever decrease via an explicit `expend` entry; modifiers clamp to net ±3 pre-roll; dice use neutral Web Crypto entropy; strength clamps to bands `{0,25,50,75,100}` and never increases except via a logged resupply.
- **v1 narration transport**: ClipboardNarrator (copy prompt → paste into any AI → paste JSON back) — model-agnostic, no key, no hosting. The optional API relay is M4 and is the only component that ever wants hosting.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Svelte** | `5.56.3` (pin `^5.56`) | UI reactivity via runes (`$state`, `$derived`) | Runes are the v5 model the spec mandates; fine-grained reactivity maps perfectly onto "render folded state, never store derived values." `remaining = $derived(loadout − Σexpended)` is a one-liner. **Pin it** — see the Svelte 4/5 hazard section. |
| **SvelteKit** | `2.66.0` (pin `^2.66`) | App framework + routing + build | Spec §7.2 wants a server route later for the optional M4 relay. SvelteKit gives that for free without restructuring. For v1 the app is fully static (adapter-static). |
| **TypeScript** | `6.0.3` (pin `^6.0`) | Typed contracts | Non-negotiable per spec §2. The `MoveEnvelope`, `GameState`, and `GameEvent` discriminated unions are the whole point of the design — types catch envelope-shape errors before runtime. TS 6 is the current major; SvelteKit 2.66 peer accepts `^5.3.3 || ^6.0.0`. |
| **Vite** | `8.0.16` (pin `^8.0`) | Build + dev server + test runtime | Current major. Required by `@sveltejs/vite-plugin-svelte@7` (peer: `^8.0.0`). Vitest 4 and `@tailwindcss/vite@4` both run on Vite 8. |
| **@sveltejs/vite-plugin-svelte** | `7.1.2` (pin `^7.1`) | Compiles `.svelte` files | v7 is the line that pairs with Vite 8 + Svelte 5.46+. Pulled in by the SvelteKit scaffold; listed explicitly here so the version is intentional. |
| **@sveltejs/adapter-static** | `3.0.10` | Builds a static, host-anywhere PWA | v1 has no server. A static build is installable, CDN-deployable, and is the correct adapter for a clipboard-only PWA. Swap to `adapter-node`/`adapter-auto` only when the M4 relay route lands. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **valibot** | `1.4.1` (pin `^1.4`) | Runtime shape-validation of the pasted `MoveEnvelope` | **Recommended validator** (rationale below). Validates untrusted JSON pasted from any AI at the ClipboardNarrator boundary; infers static types so the contract is single-sourced. |
| **idb** | `8.0.3` (pin `^8.0`) | Thin Promise wrapper over raw IndexedDB for `SaveStore` | **Recommended store primitive** (rationale below). You hand-author the object stores normalized for a clean future SQLite swap; `idb` just removes the IndexedDB event-callback ceremony. |
| **@tailwindcss/vite** | `4.3.1` (pin `^4.3`) | Tailwind v4 as a first-class Vite plugin | Tailwind v4's setup is a Vite plugin + a single `@import "tailwindcss";` — no `tailwind.config.js`, no PostCSS chain. Peer accepts Vite `^8`. |
| **tailwindcss** | `4.3.1` (pin `^4.3`) | Utility CSS | Least-consequential choice per spec §2 (swappable for plain CSS). v4 is config-light and fast. |
### Development Tools
| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| **Vitest** | `4.1.9` (pin `^4.1`) | Unit-test the pure engine with a mocked `Narrator` | Native Vite/TS/ESM. Test `validate`, `resolve`, `dice`, the `fold`, and the §5.4 worked example as pure functions with zero DOM. The narrator is an interface — inject a stub returning a canned `MoveEnvelope`. |
| **@playwright/test** | `1.61.0` (pin `^1.61`) | End-to-end round-trip test | Drive the full M1 spine in a real browser: seed → render → paste a `MoveEnvelope` string → resolve → assert State Panel → reload → assert autosave persisted. Playwright can seed IndexedDB and assert on it. |
| **svelte-check** | `4.6.0` (pin `^4.6`) | Type-checks `.svelte` + `.ts` | Run in CI. Catches runes misuse the TS compiler alone won't. |
| **eslint** | `10.5.0` (pin `^10.5`) | Lint (flat config) | ESLint 10 uses flat config (`eslint.config.js`). |
| **eslint-plugin-svelte** | `3.19.0` (pin `^3.19`) | **The Svelte 4/5 reactivity guardrail** | This plugin is the concrete defense against the spec's #1 hazard. Rules listed in the hazard section below. |
| **prettier-plugin-svelte** | `4.1.1` | Formatting | Standard. |
## Installation
# Scaffold (interactive) — choose: SvelteKit minimal, TypeScript, ESLint, Prettier, Vitest, Playwright
# Core (already added by scaffold; pin intentionally)
# Runtime libraries
# Styling (Tailwind v4 — Vite plugin, no PostCSS config)
# PWA (installable to Android) — add when M3 PWA work begins
# Dev tooling (scaffold adds most; pin intentionally)
## The #1 Hazard: mixing Svelte 4 and Svelte 5 reactivity idioms
- `svelte/prefer-svelte-reactivity` — flags mutable built-in `Map`/`Set`/`Date` where `svelte/reactivity` versions are required (a classic v4-habit reactivity leak).
- `svelte/no-reactive-reassign` — catches reassigning a reactive value the wrong way.
- `svelte/prefer-writable-derived` — pushes `$state + $effect` mirroring toward `$derived` (directly relevant: `remaining` must be `$derived`, never a `$state` you keep in sync).
- `svelte/prefer-derived-over-derived-by` — keeps derived queries clean.
- `svelte/no-immutable-reactive-statements`, `svelte/require-each-key`, `svelte/valid-each-key`.
- **Destructuring snapshots.** `const { strength } = unit` freezes the value; mutating `unit.strength` later won't update it. Read through the proxy (`unit.strength`) in templates/`$derived`.
- **Cross-module reassignment.** A `$state` variable exported and *reassigned* in another module loses reactivity. Export a **state object and mutate its properties**, or export **accessor functions**. This matters because your UI imports game state from a store module — never `export let state = $state(...)` and reassign; wrap it.
- **Classes get getter/setter `$state` fields, not proxies.** Fine, but watch `this` binding in handlers (use arrow functions).
## Architecture-shaping recommendations (the prescriptive calls)
### Validator: **valibot** (not zod, not arktype)
- **Bundle size matters for a PWA installed on a phone.** Valibot is modular/tree-shakeable; importing only the validators you use yields a footprint an order of magnitude smaller than zod's monolithic bundle. The `MoveEnvelope` schema touches a handful of validators, so you ship only those.
- **It does exactly one job here:** shape-validate one untrusted string (the pasted AI JSON) at one boundary. You don't need zod's vast ecosystem of integrations — that's weight you'd pay for and not use.
- **Type inference is first-class** (`v.InferOutput<typeof MoveEnvelopeSchema>`), so the schema *is* the `MoveEnvelope` type — single source of truth for the spec's central contract.
### IndexedDB: **idb** (not Dexie, not raw)
- **`idb` (8.0.3)** is a ~1KB Promise wrapper over the native IndexedDB API. You define object stores yourself, so you control the **normalized schema** the spec demands for a clean future SQLite swap (§7.2). It removes the callback/transaction ceremony without imposing an ORM-shaped data model.
- **Dexie (4.4.4)** is more ergonomic for rich querying — but its table/query abstraction is the thing you'd have to *unwind* when swapping to SQLite, and v1 querying is trivial (`save`/`load`/`list`/`export`/`import` over an event stream + snapshots). Dexie's strengths (live queries, complex indexes) aren't needed yet and would couple you to its model.
- **Raw IndexedDB** is viable but the callback API invites bugs in transaction/version-upgrade handling — exactly where a save store must be correct. `idb` is the sweet spot.
### Event sourcing: **roll your own** (no library)
### Dice RNG: **Web Crypto, no package**
### Structured-output prompting for the manual-paste model (v1, no API)
- **Render an explicit JSON skeleton** of `MoveEnvelope` in the copied prompt, with field-by-field instructions and the §5.4 worked example as a one-shot exemplar. Models match a concrete shape far more reliably than a prose description.
- **Ask for raw JSON only, fenced in a single ```json block, no commentary.** Then on paste, *extract* the first fenced block (regex/substring) before `JSON.parse` — models frequently wrap JSON in prose despite instructions. This forgiving extraction step is what makes the round-trip robust across unknown models.
- **`safeParse` with valibot, then surface a re-try affordance** on shape failure (re-copy / re-paste). Treat a bad paste as recoverable UX, never a crash.
- **Keep the prompt small and self-contained** (spec §8 sizing is M2; M1 ships an inline ruleset). Smaller, sharper prompts get better JSON from weaker models — which you must assume the user might use.
### PWA: **@vite-pwa/sveltekit** (`1.1.0`)
## Project structure (engine purity — imports nothing from Svelte)
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| valibot | zod `4.4.3` | When you add many schemas and want the largest ecosystem; or for the M4 relay where bundle size is irrelevant. |
| valibot | arktype `2.2.1` | When validation throughput is critical and you want TS-syntax-native schema definitions; not worth the curve for one boundary schema. |
| idb | Dexie `4.4.4` | When you need rich client-side querying / live queries and are *not* planning a SQLite swap. |
| roll-your-own event sourcing | Emmett / event-sourcing framework | Server-side / multi-aggregate / distributed systems — never for a single-player browser game. |
| adapter-static | adapter-auto `7.0.1` / adapter-node | When the M4 relay server route ships and you need server rendering of that endpoint. |
| Tailwind v4 | Plain CSS | Spec explicitly allows this; choose if you dislike utility classes. Least-consequential decision. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Svelte 4 idioms (`$:`, `export let`, writable stores from `svelte/store`) | The spec's #1 hazard — they compile in Svelte 5 legacy mode and *look right*. | `$state`, `$derived`, `$props`; set `runes: true` to make legacy a compile error. |
| `Math.random()` for dice | Not neutral, not auditable; defeats the "code owns the dice" principle. | `crypto.getRandomValues` with rejection sampling. |
| Storing `remaining` as a field | Violates §4.1 (derived, never stored); invites the exact drift the design eliminates. | `$derived` in UI / pure query over events in engine. |
| An ORM or event-sourcing framework | Couples persistence to a model you must unwind for the SQLite swap; over-weight for a PWA. | `idb` with a hand-authored normalized schema. |
| `tailwind.config.js` + PostCSS chain (Tailwind v3 style) | Obsolete in v4; adds config files you don't need. | `@tailwindcss/vite` plugin + `@import "tailwindcss";`. |
| Floating Svelte/SvelteKit to `latest` | Re-introduces the v4/v5 idiom-drift risk and surprise breakage. | Pin `^5.56` / `^2.66`; commit the lockfile. |
## Stack Patterns by Variant
- Swap `adapter-static` → `adapter-auto` (or `adapter-node`), add a `+server.ts` route holding the key, implement `ApiNarrator` behind the existing `Narrator` interface.
- Because the engine is pure and the narrator is an interface, no engine code changes.
- Implement a `SQLiteSaveStore` behind the existing `SaveStore` interface. The normalized `campaigns/snapshots/events` IndexedDB layout maps 1:1 to three tables. No engine or UI changes.
- Strengthen the prompt skeleton + extraction (forgiving fenced-block extraction already recommended). The valibot `safeParse` + re-paste UX absorbs the rest. No architectural change.
## Version Compatibility
| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@sveltejs/vite-plugin-svelte@7.1.2` | `vite@^8.0`, `svelte@^5.46.4` | **Hard constraint:** plugin v7 requires Vite 8 and Svelte ≥5.46. This is why Vite 8 + Svelte 5.56 are the floor. |
| `@sveltejs/kit@2.66.0` | `vite@^5\|^6\|^7\|^8`, `vite-plugin-svelte@^3..^7`, `svelte@^4\|^5`, `typescript@^5.3.3\|^6` | Wide peer range; the binding constraint is the vite-plugin-svelte→Vite-8 requirement above. |
| `@tailwindcss/vite@4.3.1` | `vite@^5.2\|^6\|^7\|^8` | Compatible with Vite 8. |
| `@vite-pwa/sveltekit@1.1.0` | `@sveltejs/kit@^2.0.1`, `@vite-pwa/assets-generator@^1.0` | Satisfied by SvelteKit 2.66; add assets-generator for icons. |
| `vitest@4.1.9` | `vite@^8` | Same Vite version as the app — one runtime. |
| `typescript@6.0.3` | `svelte-check@4.6`, `@sveltejs/kit@2.66` | TS 6 accepted by SvelteKit peer (`^6.0.0`). |
## Sources
- **npm registry (live `npm view`, 2026-06-19)** — exact latest versions + peerDependency ranges for every package above. HIGH confidence (authoritative, queried on research date).
- **svelte.dev/docs/svelte/$state** — runes deep-reactivity, destructuring/cross-module/class gotchas. HIGH confidence (official docs).
- **sveltejs.github.io/eslint-plugin-svelte/rules** — confirmed the v4→v5 guardrail rules (`prefer-svelte-reactivity`, `no-reactive-reassign`, `prefer-writable-derived`, `require-each-key`, etc.) and the recommended preset. HIGH confidence (official plugin docs).
- **spec.md §2/§4/§5/§6/§7/§10** + **PROJECT.md** — domain constraints driving every prescriptive call (engine purity, event sourcing model, ClipboardNarrator, normalized-for-SQLite store, banded strength, neutral dice). HIGH confidence (authoritative project documents).
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

### Verify the PWA/frontend with headless Playwright (not a manual browser)

This project is developed in **WSL2**, and the dev/preview server is **not reachable from a Windows host browser** — so "open it in Chrome and check" is a dead end. Verify frontend and PWA behaviour by driving **headless Playwright yourself** against a local build/preview. `@playwright/test` (chromium) is already installed; put any throwaway script **inside the project dir** (not `/tmp`) so Node resolves `@playwright/test`, and delete it after.

**Offline / PWA round-trip (proves the service worker + precache):**
```bash
BASE_PATH=/frosty npm run build && BASE_PATH=/frosty npm run preview   # serves http://localhost:4173/frosty/
```
Then a Playwright script that: asserts the `link[rel=manifest]` is in the live DOM (it's injected at runtime via `pwaInfo`, so it is NOT in the static `index.html`); waits for `navigator.serviceWorker.ready` + `state==='activated'`; polls `caches.keys()` for the `workbox-precache-*` cache and the shell entry; then `context.setOffline(true)` + `page.reload()` to prove the app shell renders offline; and `page.screenshot(...)`. A relative manifest href like `./manifest.webmanifest` resolves correctly under the base — check `link.href` (resolved), not the raw attribute.

**Mobile UI / layout:** launch a phone viewport context (e.g. `{ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true }`) over `npm run dev`, drive the flow (e.g. New game → Play <scenario>), and screenshot. **Screenshot-verify every frontend surface in a real browser before calling a phase done** — component tests + the GSD verifier miss render-only/overlay/cramping bugs.

**Note:** Playwright's bundled Chromium under `vite preview` may not populate Cache Storage from a workbox precache install; the SW grep gate (`npm run check:sw`) + this offline check cover it. The **on-device Android** A2HS / airplane-mode acceptance still needs the physical phone (`adb` at `/usr/sbin/adb`) — that part can't be automated.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
