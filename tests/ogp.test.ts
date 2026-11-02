// OGP（8-5）: index.html に og:title・og:description・og:image があり、ビルドで英語の文と画像の URL に置き換わる
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OG_IMAGE_PATH, ogImageUrl, ogp } from '../scripts/vite-ogp';
import en from '../src/data/i18n/en.json';

const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');

describe('OGP', () => {
  it('og:image は公開の URL があれば絶対 URL、無ければパス', () => {
    expect(ogImageUrl('https://skyraid.example.com/')).toBe(
      'https://skyraid.example.com/brand/og-image.jpg',
    );
    expect(ogImageUrl('https://abc123.skyraid.pages.dev')).toBe(
      'https://abc123.skyraid.pages.dev/brand/og-image.jpg',
    );
    expect(ogImageUrl(undefined)).toBe(OG_IMAGE_PATH);
    expect(ogImageUrl('')).toBe(OG_IMAGE_PATH);
    expect(ogImageUrl('not a url')).toBe(OG_IMAGE_PATH);
  });

  it('index.html の印を英語の説明と画像の URL に置き換える', () => {
    const html = readFileSync(`${ROOT}/index.html`, 'utf8');
    for (const p of ['og:title', 'og:description', 'og:image', 'og:image:width'])
      expect(html).toContain(`property="${p}"`);
    const plugin = ogp(ROOT, 'https://skyraid.example.com');
    const hook = plugin.transformIndexHtml;
    if (typeof hook !== 'function') throw new Error('transformIndexHtml is not a function');
    const ctx: Parameters<typeof hook>[1] = { path: '/index.html', filename: `${ROOT}/index.html` };
    const out = hook.call(ctx as unknown as ThisParameterType<typeof hook>, html, ctx);
    if (typeof out !== 'string') throw new Error('transformIndexHtml did not return a string');
    const text = out;
    expect(text).toContain(`content="${en.app.ogDescription}"`);
    expect(text).toContain('content="https://skyraid.example.com/brand/og-image.jpg"');
    expect(text).not.toContain('__OG_');
  });

  it('画像は 1200×630 の JPEG（public/brand/og-image.jpg）', () => {
    const b = readFileSync(`${ROOT}/public${OG_IMAGE_PATH}`);
    expect(b[0]).toBe(0xff);
    expect(b[1]).toBe(0xd8);
    // SOF0 / SOF2 の高さと幅
    let i = 2;
    let size: { w: number; h: number } | null = null;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) break;
      const marker = b[i + 1] ?? 0;
      const len = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
      if (marker === 0xc0 || marker === 0xc2) {
        size = {
          h: ((b[i + 5] ?? 0) << 8) | (b[i + 6] ?? 0),
          w: ((b[i + 7] ?? 0) << 8) | (b[i + 8] ?? 0),
        };
        break;
      }
      i += 2 + len;
    }
    expect(size).toEqual({ w: 1200, h: 630 });
    expect(b.length).toBeLessThan(200 * 1024);
  });
});
