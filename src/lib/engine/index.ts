// Engine entry point — the engine barrel (Phase-3 public surface).
//
// The engine is pure, framework-free TypeScript (CLAUDE.md architecture rule):
// it imports nothing from Svelte, SvelteKit ($app/*), or app components — the
// no-restricted-imports gate in eslint.config.js enforces that invariant
// structurally (CORE-02).
//
// Phase 3 is the first phase to POPULATE this barrel: it exposes the narrator
// transport seam, the prompt builder, the envelope shape gate, and the confirm-step
// projection — the surface the Phase-5 Svelte glue imports. Earlier-phase modules
// (fold, ledger, dice, resolve, validate) are still imported directly by their
// module paths; back-filling them into the barrel is out of scope here.

// Transport seam (spec §7.1) — Narrator interface + TurnPayload + ClipboardNarrator.
export { ClipboardNarrator } from './narrator';
export type { Narrator, TurnPayload } from './narrator';

// The untrusted-paste shape gate (NARR-02/03) — valibot allow-list + extraction.
export { MoveEnvelopeSchema, extractAndValidate, extractFencedJson } from './envelope-schema';
export type { Result } from './envelope-schema';

// The copy-into-any-AI prompt builder (ORDER-01).
export { buildPrompt } from './prompt';

// The copy-into-any-AI scenario-GENERATION prompt builder (Phase 9 — SCEN-01/SCEN-05):
// authors a fresh turn-0 PersistedGame seed from a free-form brief, the sibling of buildPrompt.
export { buildScenarioPrompt } from './scenario-prompt';

// The confirm-before-commit diff projection (ORDER-02/03).
export { confirmDiff, CONFIRM_DEFAULT_ON } from './confirm';
export type { ConfirmRow } from './confirm';

// The persistence seam (SAVE-01) — SaveStore interface + result/row types. The
// idb-backed implementation is NON-engine (src/lib/idb-save-store.ts, Plan 02) and
// is NOT exported here; Phase 5 imports it directly.
export type { SaveStore, SaveResult, CampaignRow } from './save-store';

// The untrusted-import shape gate (SAVE-04 / V5 / D-05) — valibot allow-list +
// the current on-disk schema version the migrate gate compares against.
export { SaveEnvelopeSchema, validateSaveEnvelope, CURRENT_SCHEMA_VERSION } from './save-schema';

// The unified validated load path (Phase 8 — LOAD-01..03, LOAD-05): the ONE entry point
// every source crosses (validate → migrate → fold → LoadResult), the migrate seam, and the
// GameSource read shape + PersistedGame alias.
export { loadGameState } from './load';
export type { LoadResult } from './load';
export { migrateForward } from './migrate';
export type { GameSource, PersistedGame, CatalogEntry, ScenarioSideSummary } from './source';

// The seed well-formedness gate (Phase 9 — SCEN-03/SCEN-04): the DOMAIN (legality +
// coherence) check every seed crosses at load, composed inside loadGameState.
export { validateSeed } from './validate-seed';
export type { SeedResult } from './validate-seed';
