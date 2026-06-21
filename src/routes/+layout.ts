// +layout.ts — the static, client-only PWA shape (M1 has no server).
//
// prerender=true: adapter-static emits a host-anywhere prerendered shell (the page
// is identical at build time — all dynamism is client-side reactive `game` state).
// ssr=false: the app boots in the browser ONLY — `game.boot()` reads IndexedDB
// (a browser API) on mount, so server-rendering it would crash; the engine + bridge
// are client-side. Swap to a server adapter only when the M4 relay route lands.

export const prerender = true;
export const ssr = false;
