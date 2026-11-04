import { loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { APP_MANIFEST, BRAND_ASSETS } from './src/data/app.ts';
import { addConnectSrc } from './src/online/csp.ts';
import { readOnlineEnv } from './src/online/env.ts';
import { appInfo } from './scripts/vite-app-info.ts';
import { legacyCheck } from './scripts/vite-legacy-check.ts';
import { ogp } from './scripts/vite-ogp.ts';
import ja from './src/data/i18n/ja.json';
import { chunkPlan } from './scripts/vite-chunks.ts';

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

const root = decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/\/$/, '');
// 8-2: 起動時に読むモジュールを three-core / three-webgl / game / render / app に分ける（scripts/vite-chunks.ts）
const chunks = chunkPlan();

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist',
    target: 'es2022',
    rolldownOptions: { output: { codeSplitting: { groups: chunks.groups } } },
  },
  plugins: [
    chunks.plugin,
    supabaseCsp(),
    // 7-D: 「情報」画面の版とライセンスの一覧（virtual:app-info）
    appInfo(root),
    // 8-3 / 8-4: 古いブラウザの案内（dist/legacy-check.js。文言の表を埋め込む）と index.html の meta description
    legacyCheck(root),
    // 8-5: OGP（英語。og:image は公開の URL があれば絶対 URL）
    ogp(root, loadEnv(mode, root, 'VITE_').VITE_SITE_URL || process.env.CF_PAGES_URL),
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
        // 8-4: manifest の言語は ja のまま。説明文は文言の表（ja.json の app.description）
        description: ja.app.description,
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
        // 8-2 の事前修正: 環境変数なしのビルドではオンライン連携（Supabase）のチャンクは読まないのでプリキャッシュしない
        // （判定はアプリの src/ui/online-link.ts と同じ readOnlineEnv）
        // 9-6a: ?dev=<名前> の開発中の機能のチャンク（kaiju2-dev）も遊ぶ人は読まないのでプリキャッシュしない
        globIgnores: [
          '**/assets/kaiju2-dev-*',
          ...(readOnlineEnv(loadEnv(mode, root, 'VITE_')) ? [] : ['**/assets/online-app-*']),
        ],
        // 8-2: 遅延読み込みのチャンク（PvP・怪獣・フォトモード・リプレイ・情報画面）もすべてプリキャッシュする（オフラインで
        // 全モードが動き、デプロイの直後も古い SW が古いチャンクを返せる）。8-2 のチャンク分けで 2MiB を超えるファイルは
        // 無くなったが、上限は念のため 7-x までと同じにしておく
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/i18n-setup.ts'],
    environment: 'node',
    // v1.0.1: 既定の 5 秒では、ほかの処理と同時に走らせたときに重いテスト（地形の三角形・放置の失敗・日本語の直書き・
    // 塗装の全組み合わせ・マップの描画の作り直し。単独で 1〜3 秒、負荷で 7〜9 秒）が時間切れになった。テストは結果を見るもので、
    // 時間は npm run bench で測る。上限は止まった（無限ループ）ときに止めるためだけのもの
    testTimeout: 60000,
    hookTimeout: 60000,
    // テーマのテスト（tests/theme.test.ts）が UI の CSS を ?raw で読むため、CSS を空にしない
    css: { include: [/src\/ui\/.+\.css/] },
  },
}));
