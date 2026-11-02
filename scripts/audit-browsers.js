/* global process */
// 点検に使う Playwright のエンジン（8-3）: chromium / firefox / webkit。取得していない（実行ファイルが無い）ものは available: false。
// クラウドセッションの Playwright は全体に入っている（require で見つかる。ESM の import では見つからない）
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const playwright = createRequire(import.meta.url)('playwright');
export const ENGINES = ['chromium', 'firefox', 'webkit'];

/** エンジンごとの起動の設定。Chromium はソフトウェア描画（SwiftShader）で WebGL を使う。ほかは既定のまま */
const LAUNCH = {
  chromium: { args: ['--use-gl=angle', '--use-angle=swiftshader'] },
  firefox: { firefoxUserPrefs: { 'webgl.force-enabled': true } },
  webkit: {},
};

/** `--browser` の値（chromium / firefox / webkit / all。カンマ区切りも可）からエンジンの一覧 */
export function pickBrowsers(value) {
  const names = value === 'all' ? ENGINES : value.split(',').map((v) => v.trim());
  return names.map((name) => {
    if (!ENGINES.includes(name))
      throw new Error(`--browser は ${ENGINES.join(' / ')} / all: ${name}`);
    const type = playwright[name];
    let path;
    try {
      path = type.executablePath();
    } catch {
      path = '';
    }
    const available = path !== '' && existsSync(path);
    return {
      name,
      available,
      reason: available
        ? ''
        : `実行ファイルが無い（${process.env.PLAYWRIGHT_BROWSERS_PATH ?? '既定の場所'}）。npx playwright install ${name}`,
      launch: () => type.launch(LAUNCH[name]),
    };
  });
}
