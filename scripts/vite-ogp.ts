// 8-5: index.html の OGP（og:title・og:description・og:image）。リンクのプレビュー（X・Discord・LINE・Slack など）は言語を
// 選べず世界中で同じものが出るので、文は英語（en.json の app.ogDescription）、画像は英語の固定の画像（public/brand/og-image.jpg。
// 記録カードと同じ描画で作る: scripts/og-image.js）。
// og:image は多くのクローラーが絶対 URL を求めるので、公開の URL（VITE_SITE_URL、無ければ Cloudflare Pages が渡す CF_PAGES_URL）
// があれば絶対 URL にし、無ければルートからのパス
import type { Plugin } from 'vite';
import { message, readTable } from './vite-legacy-check.ts';

export const OG_IMAGE_PATH = '/brand/og-image.jpg';

/** og:image の URL（site は https://… の公開の URL。空ならパスだけ） */
export function ogImageUrl(site: string | undefined): string {
  const base = (site ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(base) ? `${base}${OG_IMAGE_PATH}` : OG_IMAGE_PATH;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function ogp(root: string, site: string | undefined): Plugin {
  return {
    name: 'skyraid-ogp',
    transformIndexHtml(html) {
      const description = escapeAttr(message(readTable(root, 'en'), 'app.ogDescription'));
      return html
        .replace('__OG_DESCRIPTION__', description)
        .replace('__OG_IMAGE__', escapeAttr(ogImageUrl(site)));
    },
  };
}
