import { defineConfig, devices } from '@playwright/test';

// Playwright E2E config — the §5.4 round-trip + reload-persistence acceptance
// (tests/e2e/turn-cycle.spec.ts). Kept ENTIRELY separate from the two Vitest
// projects (RESEARCH Pitfall 7): Playwright owns `tests/e2e/**`, Vitest owns
// `tests/engine|turn|components`.
//
// The webServer builds + previews the static PWA (adapter-static) so the spec
// drives the REAL page. `reuseExistingServer` keeps local re-runs fast; CI gets a
// clean boot. The spec is RED until the UI (Wave 1–3) exists — it fails on a
// missing selector / navigation, never on a config error.
export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: 'list',
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'on-first-retry'
	},
	// Two projects (VALIDATION Wave 0):
	//   • chromium — Desktop Chrome; runs the §5.4 round-trip + the UX-08 desktop
	//                no-regression spec (≥1024px grid). UNCHANGED Desktop device.
	//   • phone    — the portrait-phone viewport the mobile-shell screenshots run at
	//                (CLAUDE.md "Verify the PWA/frontend with headless Playwright"
	//                convention: 393×851, isMobile, hasTouch). Mobile-shell screenshot
	//                harness runs here.
	//
	// Spec→project routing is by `test.use({ ... })` inside each new spec (testIgnore
	// keeps the wrong project from also collecting it), so `--list` shows each spec
	// under exactly one project. The desktop spec stays on `chromium`; the mobile
	// spec self-selects the `phone` viewport.
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
			// The mobile-shell harness is phone-only; keep it off the desktop project.
			testIgnore: /mobile-shell\.spec\.ts/
		},
		{
			name: 'phone',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 393, height: 851 },
				isMobile: true,
				hasTouch: true
			},
			// The phone project runs ONLY the mobile-shell harness; the §5.4 round-trip
			// and the desktop-grid spec belong to `chromium`.
			testMatch: /mobile-shell\.spec\.ts/
		}
	],
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
