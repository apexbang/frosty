import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';

/**
 * ESLint 10 flat config.
 *
 * The load-bearing rule for this phase is the engine-purity gate (CORE-02):
 * a files-scoped override on src/lib/engine/** that bans every framework
 * import via no-restricted-imports. The engine is pure, framework-free TS
 * (CLAUDE.md architecture rule) — it must import nothing from Svelte, SvelteKit
 * ($app/*), or app components. This rule is the structural CI enforcement of
 * that invariant; it is demonstrably fired by a probe import (see SUMMARY).
 *
 * The eslint-plugin-svelte recommended preset is included for .svelte files
 * generally (the Svelte 4/5 reactivity guardrail, CLAUDE.md #1 hazard).
 *
 * SCAFFOLD-GAP FIX (plan 01-02): the engine modules are real TypeScript, which
 * ESLint's default espree parser cannot read ("Unexpected token"). We register
 * the typescript-eslint parser for *.ts so `npx eslint src/lib/engine/` parses
 * and the CORE-02 no-restricted-imports gate can actually run against engine
 * source. We deliberately do NOT enable type-aware (typed-linting) rules here —
 * only the parser is needed so the purity gate evaluates; svelte-check owns
 * type-checking. The CORE-02 override below is preserved verbatim.
 */
export default [
	{
		ignores: ['.svelte-kit/', 'build/', 'node_modules/']
	},

	js.configs.recommended,

	// Node CI/build scripts (OFFL-01: scripts/check-sw-precache.mjs is the ISSUE-B
	// build-artifact gate). These run under Node, not the browser, so `process`,
	// `console`, and the Node module URL globals are legitimately defined. @types/node
	// is intentionally not a dependency (Phase 11 ships no new packages — T-11-SC), so
	// declare the handful of Node globals these scripts use rather than pulling the full
	// Node globals package. Scoped to scripts/** only — never relaxes app/engine code.
	{
		files: ['scripts/**/*.{js,mjs,cjs}'],
		languageOptions: {
			globals: {
				process: 'readonly',
				console: 'readonly'
			}
		}
	},

	// Svelte 4/5 reactivity guardrail for components (no .svelte files yet, but
	// the guardrail is wired now so it can never be forgotten).
	...svelte.configs.recommended,

	// Wire the typescript-eslint parser INTO the svelte parser for `<script lang="ts">`
	// blocks (Phase 5: the first phase with real .svelte components). svelte-eslint-parser
	// delegates the script body to `parserOptions.parser`; without this it falls back to
	// espree and chokes on TS type annotations ("Unexpected token :"). Parser-only — no
	// type-aware rules — so the Svelte 4/5 reactivity guardrail (recommended preset above)
	// runs against TypeScript component source. Mirrors the *.ts parser wiring below.
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: tseslint.parser
			}
		},
		rules: {
			// Same rationale as the *.ts block: no-undef is redundant/wrong under TS
			// (svelte-check owns unknown-identifier reporting and platform globals).
			'no-undef': 'off'
		}
	},

	// SCAFFOLD-GAP FIX (plan 01-02): use the typescript-eslint parser for all
	// .ts files so ESLint can parse TypeScript syntax (type aliases, `as const`,
	// interfaces). Parser-only — no type-aware rules — so the CORE-02 gate below
	// can run on real engine source.
	{
		files: ['**/*.ts'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				ecmaVersion: 'latest',
				sourceType: 'module'
			}
		},
		rules: {
			// `no-undef` is redundant (and wrong) in TypeScript: the compiler /
			// svelte-check already reports unknown identifiers, and the core rule
			// has no awareness of platform globals like `structuredClone`. This is
			// exactly why typescript-eslint disables it for *.ts. Turn it off so the
			// CORE-02 purity gate (no-restricted-imports) is the only engine error
			// surface, with type-checking left to svelte-check.
			'no-undef': 'off',
			// Honor the `_`-prefix convention and the destructure-to-omit idiom.
			// `ignoreRestSiblings` is the canonical exemption for
			// `const { reason: _reason, ...rest } = e` (destructuring a field only
			// to exclude it from `...rest`); `^_` args/vars patterns let a name like
			// `_s` in a function-type annotation document intent without tripping the
			// rule. Both options only RELAX no-unused-vars — they cannot add errors.
			'no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }
			]
		}
	},

	// Ambient declaration files (*.d.ts) declare types for external consumers and
	// legitimately contain "unused" top-level names (e.g. SvelteKit's `App`
	// namespace in src/app.d.ts). The core no-unused-vars rule has no concept of
	// ambient declarations and false-positives on them once the TS parser is
	// active — disable it there. (Surfaced by the plan 01-02 TS-parser wiring.)
	// MUST stay after the `**/*.ts` block above: flat config is order-based
	// (last match wins), so this re-asserts the exemption for declaration files.
	{
		files: ['**/*.d.ts'],
		rules: {
			'no-unused-vars': 'off'
		}
	},

	// CORE-02: engine purity. Scoped ONLY to src/lib/engine/** — an import of
	// svelte outside engine/ is intentionally NOT flagged by this rule.
	{
		files: ['src/lib/engine/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['svelte', 'svelte/*', '$app/*', '$lib/components/*', '*.svelte'],
							message:
								'Engine is pure, framework-free TS (CORE-02): it must import nothing from Svelte, SvelteKit, or app components.'
						},
						{
							// Phase-4 hardening (RESEARCH Open Question 2): the engine declares the
							// SaveStore INTERFACE + valibot save-schema (pure), but the idb-backed
							// IMPLEMENTATION lives OUTSIDE engine/ at src/lib/idb-save-store.ts. Ban
							// `idb` inside engine/ so the engine/non-engine persistence split is
							// structurally enforced, not merely conventional — an idb import in an
							// engine module is now a lint error, not a silently-passing leak.
							group: ['idb', 'idb/*'],
							message:
								'The idb implementation is NON-engine (src/lib/idb-save-store.ts): the engine defines only the SaveStore interface + valibot schema (CORE-02 / RESEARCH Pitfall 1).'
						}
					]
				}
			]
		}
	}
];
