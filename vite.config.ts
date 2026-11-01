import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { APP_MANIFEST, BRAND_ASSETS } from './src/data/app.ts';
import { addConnectSrc } from './src/online/csp.ts';

/**
 * 7-4: 書き出しの後に dist/_headers（public/_headers の写し）の CSP の connect-src へ VITE_SUPABASE_URL のオリジンだけを足す。
 * 環境変数（Cloudflare Pages の環境変数・.env）が無ければ何もしない（public/_headers のまま）
 */
function supabaseCsp(): Plugin {
  let headersFile = '';
  let url: string | undefined;
  return {
    name: 'skyraid-supabase-csp',
    apply: 'build',
    configResolved(config) {
      const outDir = config.build.outDir;
      headersFile = `${outDir.startsWith('/') ? outDir : `${config.root}/${outDir}`}/_headers`;
      const v: unknown = config.env.VITE_SUPABASE_URL;
      url = typeof v === 'string' ? v : undefined;
    },
    async writeBundle() {
      if (!url) return;
      const before = await this.fs.readFile(headersFile, { encoding: 'utf8' });
      const after = addConnectSrc(before, url);
      if (after !== before) await this.fs.writeFile(headersFile, after);
    },
  };
}

export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  plugins: [
    supabaseCsp(),
    // PWA（4-10）: manifest とビルド成果物をプリキャッシュする Service Worker。
    // prompt 型（skipWaiting しない）なので、更新は全部のタブを閉じた次の起動で入る。登録は src/ui/app-shell.ts
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      filename: 'sw.js',
      manifestFilename: 'manifest.webmanifest',
      manifest: {
        name: APP_MANIFEST.name,
        short_name: APP_MANIFEST.shortName,
        description: APP_MANIFEST.description,
        lang: 'ja',
        display: 'standalone',
        orientation: 'landscape',
        theme_color: APP_MANIFEST.themeColor,
        background_color: APP_MANIFEST.backgroundColor,
        start_url: '.',
        scope: '.',
        icons: [
          { src: BRAND_ASSETS.icon192, sizes: '192x192', type: 'image/png' },
          { src: BRAND_ASSETS.icon512, sizes: '512x512', type: 'image/png' },
          {
            src: BRAND_ASSETS.iconMaskable,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // アイコンの元画像（1254px・約 1.3MB）は配信には使わないのでプリキャッシュしない
        globIgnores: ['**/brand/icon-source.png'],
        // three を含む本体の JS が既定の上限（2MiB）を超えても入れる
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // テーマのテスト（tests/theme.test.ts）が UI の CSS を ?raw で読むため、CSS を空にしない
    css: { include: [/src\/ui\/.+\.css/] },
  },
});
