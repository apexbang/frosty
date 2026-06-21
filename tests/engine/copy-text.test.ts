// copy-text.test.ts — the layered copy helper (src/lib/copy-text.ts) branch coverage.
//
// copyTextToClipboard(text) is the fix for the silent Copy-prompt no-op over plain
// http:// (navigator.clipboard is secure-context-only → undefined on the phone). It
// layers: modern Clipboard API → legacy off-screen textarea + document.execCommand('copy')
// → returns false (never throws) when both fail.
//
// The engine Vitest project runs in NODE (no DOM), so we stub globalThis.navigator and
// globalThis.document per case and restore in afterEach. This is NON-engine code (it
// touches DOM), but the helper's branching is pure-enough to unit-test by stubbing globals.
//
// Branches covered (the four <behavior> cases):
//   1. Secure success      — navigator.clipboard.writeText resolves → true, execCommand NOT called.
//   2. Insecure + exec true — navigator.clipboard undefined, document.execCommand → true → true.
//   3. Throw then fallback — writeText rejects, document.execCommand → true → true.
//   4. Both fail           — clipboard undefined + execCommand false → false, no throw.

import { describe, test, expect, vi, afterEach } from 'vitest';
import { copyTextToClipboard } from '../../src/lib/copy-text';

// A minimal fake textarea the legacy path drives (createElement → focus/select → remove).
function makeFakeTextarea(): Record<string, unknown> {
	return {
		value: '',
		readOnly: false,
		style: {} as Record<string, string>,
		focus: vi.fn(),
		select: vi.fn(),
		remove: vi.fn()
	};
}

// Install a fake document whose createElement returns our fake textarea and whose
// execCommand returns `execResult` (or throws if it's an Error). Returns the spies.
function stubDocument(execResult: boolean | Error) {
	const textarea = makeFakeTextarea();
	const execCommand = vi.fn(() => {
		if (execResult instanceof Error) throw execResult;
		return execResult;
	});
	vi.stubGlobal('document', {
		createElement: vi.fn(() => textarea),
		body: { appendChild: vi.fn() },
		execCommand
	});
	return { textarea, execCommand };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('copyTextToClipboard', () => {
	test('secure context: Clipboard API resolves → true, execCommand NOT called', async () => {
		const writeText = vi.fn(() => Promise.resolve());
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const { execCommand } = stubDocument(true);

		const ok = await copyTextToClipboard('hello');

		expect(ok).toBe(true);
		expect(writeText).toHaveBeenCalledWith('hello');
		expect(execCommand).not.toHaveBeenCalled();
	});

	test('insecure context (no clipboard) + execCommand true → true via legacy textarea', async () => {
		vi.stubGlobal('navigator', {}); // clipboard undefined
		const { textarea, execCommand } = stubDocument(true);

		const ok = await copyTextToClipboard('paste me');

		expect(ok).toBe(true);
		expect(execCommand).toHaveBeenCalledWith('copy');
		expect(textarea.value).toBe('paste me');
		expect(textarea.readOnly).toBe(true);
		// cleanup always runs
		expect((textarea.remove as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
	});

	test('Clipboard API rejects → falls back to execCommand → true', async () => {
		const writeText = vi.fn(() => Promise.reject(new Error('insecure')));
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const { execCommand } = stubDocument(true);

		const ok = await copyTextToClipboard('after throw');

		expect(ok).toBe(true);
		expect(writeText).toHaveBeenCalled();
		expect(execCommand).toHaveBeenCalledWith('copy');
	});

	test('both paths fail: no clipboard + execCommand false → false, never throws', async () => {
		vi.stubGlobal('navigator', {});
		const { textarea } = stubDocument(false);

		const ok = await copyTextToClipboard('nope');

		expect(ok).toBe(false);
		// cleanup still ran on failure
		expect((textarea.remove as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
	});

	test('execCommand throws → treated as false, helper still does not throw', async () => {
		vi.stubGlobal('navigator', {});
		const { textarea } = stubDocument(new Error('execCommand blew up'));

		const ok = await copyTextToClipboard('boom');

		expect(ok).toBe(false);
		expect((textarea.remove as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
	});

	test('no document (non-browser): clipboard absent → false, no throw', async () => {
		vi.stubGlobal('navigator', {});
		vi.stubGlobal('document', undefined);

		const ok = await copyTextToClipboard('headless');

		expect(ok).toBe(false);
	});
});
