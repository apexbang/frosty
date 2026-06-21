// pwa-assets.config.ts — drives @vite-pwa/assets-generator (UI-08).
//
// One source image (static/icon.svg, dark-#0b0f14 ground + accent-#3fb68b mark) is
// expanded into the maskable + standard + apple-touch home-screen icon set the web
// manifest references. The `minimal2023` preset emits the modern minimum set:
//   - pwa-64x64.png, pwa-192x192.png, pwa-512x512.png (standard)
//   - maskable-icon-512x512.png (maskable — safe-zone padded)
//   - apple-touch-icon-180x180.png (iOS A2HS)
// padding:0 keeps the SVG's own internal margin (the mark is already inset).
//
// Run: `npm run generate-pwa-assets` (writes PNGs alongside static/icon.svg).

import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
	headLinkOptions: {
		preset: '2023'
	},
	preset: minimal2023Preset,
	images: ['static/icon.svg']
});
