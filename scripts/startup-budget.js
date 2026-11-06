// 10-1: 起動の量の上限（タイトルまでに読む JS・CSS の gzip 後の合計）。docs/perf.md の「起動の量の上限」。
// `npm run perf`（実際に読んだ量）と `node scripts/ui-audit.js <出力先> --release`（dist から数えた量）で確かめ、超えたら NG。
// 上限は 10-1 の後の量（約 292KB）に 1 割ほどの余裕。新しい怪獣・モードは遅延チャンクに入れ、ここを上げずに済ませる
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/** タイトルまでに読む JS・CSS の上限（gzip 後の KB。1KB = 1024 バイト） */
export const STARTUP_BUDGET_KB = 320;

/** dist から数えた、タイトルまでに読むファイル（index.html が読むもの + 言語の表の大きい方） */
export function startupFiles(dir) {
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const files = new Set();
  // <script src> / <link rel="modulepreload" href> / <link rel="stylesheet" href>（Google Fonts などの外部は除く）
  for (const m of html.matchAll(/<(script|link)\b[^>]*>/g)) {
    const tag = m[0];
    const url = /\b(?:src|href)="([^"]+)"/.exec(tag)?.[1];
    if (!url || /^(https?:)?\/\//.test(url)) continue;
    if (tag.startsWith('<link') && !/rel="(modulepreload|stylesheet)"/.test(tag)) continue;
    const path = url.replace(/^\.?\//, '');
    if (/\.(js|css)$/.test(path)) files.add(path);
  }
  // 文言の表（8-4）は起動時に今の言語の 1 つだけを import() で読む。大きい方を数える
  const tables = readdirSync(join(dir, 'assets'))
    .filter((f) => /^(ja|en)-[\w-]+\.js$/.test(f))
    .map((f) => `assets/${f}`);
  const gz = (f) => gzipSync(readFileSync(join(dir, f))).length;
  const table = tables.sort((a, b) => gz(b) - gz(a))[0];
  if (table) files.add(table);
  return [...files].map((file) => ({ file, gzip: gz(file) }));
}

/** dist の起動の量を上限と比べる（ui-audit の --release の項目の形: ok・steps・errors・csp） */
export function checkStartupBudget(dir) {
  const files = startupFiles(dir);
  const total = files.reduce((s, f) => s + f.gzip, 0);
  const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
  const ok = total <= STARTUP_BUDGET_KB * 1024;
  return {
    ok,
    gzip: total,
    budgetKb: STARTUP_BUDGET_KB,
    steps: [
      `タイトルまでに読む JS・CSS ${files.length} ファイル gzip ${kb(total)}（上限 ${STARTUP_BUDGET_KB}KB）${ok ? '' : ' ⚠ 上限を超えた'}`,
      ...files.sort((a, b) => b.gzip - a.gzip).map((f) => `  ${f.file} ${kb(f.gzip)}`),
    ],
    errors: [],
    csp: [],
  };
}
