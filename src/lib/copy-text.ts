// copy-text.ts — a layered, framework-free clipboard-copy helper.
//
// WHY THIS EXISTS: `navigator.clipboard` is a SECURE-CONTEXT-only API. Over plain
// http:// (the phone reaching the dev server at http://100.110.53.94:5173, or any
// non-localhost insecure origin) `navigator.clipboard` is `undefined`, so awaiting
// `navigator.clipboard.writeText(...)` throws and the old empty catch turned Copy
// prompt into a silent no-op. This helper layers the copy so the ClipboardNarrator
// transport — the only transport v1 has — keeps working on the real device, and any
// total failure becomes a boolean the caller can surface instead of swallowing.
//
// PLACEMENT: this is NON-ENGINE code. It touches `navigator`/`document` (the DOM),
// so it lives in `src/lib/` and NOT `src/lib/engine/` — the engine purity gate
// (CORE-02) forbids DOM/Svelte/browser-API imports under engine/. It mirrors the
// idb-save-store.ts placement: a thin browser-API adapter outside the pure core.
//
// No Svelte import, no `{@html}`, no innerHTML — just the two-layer copy + cleanup.

/**
 * Copy `text` to the clipboard, trying the modern Clipboard API first and falling
 * back to a legacy off-screen `<textarea>` + `document.execCommand('copy')` (which
 * still works in insecure contexts on Firefox Android). Resolves `true` on success,
 * `false` if both paths fail. NEVER throws.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
	// 1. Modern Clipboard API — present and a function only in a secure context.
	if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Secure-context API present but rejected (permission, transient) — fall
			// through to the legacy path rather than failing outright.
		}
	}

	// Non-browser / no document (SSR, headless without a DOM): nothing more to try.
	if (typeof document === 'undefined') return false;

	// 2. Legacy fallback: an off-screen readonly textarea + execCommand('copy').
	const el = document.createElement('textarea');
	el.value = text;
	el.readOnly = true;
	// Keep it IN layout (so select() works) but invisible and non-interactive.
	// display:none would make the selection a no-op, so we position it off-canvas.
	el.style.position = 'fixed';
	el.style.top = '-9999px';
	el.style.left = '-9999px';
	el.style.opacity = '0';
	el.style.pointerEvents = 'none';
	document.body.appendChild(el);

	let ok = false;
	try {
		el.focus();
		el.select();
		ok = document.execCommand('copy');
	} catch {
		// execCommand can throw in some sandboxed contexts — treat as failure.
		ok = false;
	} finally {
		el.remove();
	}

	return ok;
}
