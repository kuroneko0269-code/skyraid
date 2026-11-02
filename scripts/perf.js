/* global console, process, performance, navigator, URL */
// 性能と容量の計測（8-2）: `npm run perf`（本番ビルドの後に `node scripts/perf.js [出力先] [--runs N] [--no-lighthouse]`）。
//   chunks   dist のファイルの一覧（名前・サイズ・gzip 後）
//   startup  起動時間（読み込みの始まりからタイトルの表示まで）。初回（キャッシュ・SW なし）と 2 回目（SW が制御）を
//            N 回ずつ測って中央値。タイトルまでに読んだ JS・CSS（gzip 後の合計）と、2 回目にネットワークから取ったもの
//   modes    各モードに入ったときに追加で読み込むチャンク（遅延読み込みの確認）
//   lighthouse Lighthouse（既定のモバイル設定・シミュレートした低速回線と CPU）を有効な 3 回（最大 9 回）の中央値。LCP が取れ
//            なかった回（NO_LCP。ソフトウェア描画でよく起きる。スコアが 0 になる）は除く。--dir で別の dist（変更前のビルドなど）を測れる
// クラウドはソフトウェア描画（SwiftShader）なので時間・スコアは参考値（同じ環境での前後比較に使う）。
// Google Fonts は外へ出られないので空の CSS を返す（audit-helpers の watch と同じ）。結果は <出力先>/perf.json
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { serveDist } from './serve-dist.js';
import { VIEWPORT, dialogButton, seed, shown, screenIs, watch } from './audit-helpers.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const args = process.argv.slice(2);
const VALUED = ['--runs', '--dir'];
const out =
  args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1])) ?? 'perf-report';
const runs = Number(args[args.indexOf('--runs') + 1]) || 5;
const DIR = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'dist';
const PORT = 4175;
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/** dist の全ファイル（_headers と sw の地図を除く）: 名前・バイト・gzip 後 */
function listChunks(dir) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dir);
  return files
    .map((p) => {
      const buf = readFileSync(p);
      const text = /\.(js|css|html|webmanifest|json|svg)$/.test(p);
      return {
        file: relative(dir, p),
        bytes: buf.length,
        gzip: text ? gzipSync(buf).length : null,
      };
    })
    .filter((f) => f.file !== '_headers')
    .sort((a, b) => b.bytes - a.bytes);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};

/** タイトルが出るまでの時間（ナビゲーションの始まりから。ms）と、それまでに読んだ JS・CSS */
async function loadTitle(page, base, reload) {
  const loaded = [];
  const network = [];
  const onResponse = (res) => {
    const path = new URL(res.url()).pathname;
    if (!/\.(js|css)$/.test(path)) return;
    loaded.push(path.slice(1));
    if (!res.fromServiceWorker()) network.push(path.slice(1));
  };
  page.on('response', onResponse);
  // 2 回目は前のページ（描画で忙しい）の後始末を含めないよう、空のページを挟んでから開く
  if (reload) await page.goto('about:blank');
  await page.goto(base);
  await shown(page, '.title-screen');
  const ms = await page.evaluate(() => performance.now());
  page.off('response', onResponse);
  return { ms, loaded: [...new Set(loaded)], network: [...new Set(network)] };
}

async function measureStartup(browser, base, sizes) {
  const first = [];
  const second = [];
  let detail = null;
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true });
    await watch(context);
    const page = await context.newPage();
    const a = await loadTitle(page, base, false);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page
      .waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 5000 })
      .catch(() => undefined);
    // SW のプリキャッシュが済むのを待ってから 2 回目
    await page.waitForTimeout(500);
    const b = await loadTitle(page, base, true);
    first.push(a.ms);
    second.push(b.ms);
    detail ??= { first: a, second: b };
    await context.close();
  }
  const gz = (list) => list.reduce((s, f) => s + (sizes.get(f)?.gzip ?? 0), 0);
  const raw = (list) => list.reduce((s, f) => s + (sizes.get(f)?.bytes ?? 0), 0);
  return {
    runs,
    firstMs: Math.round(median(first)),
    secondMs: Math.round(median(second)),
    firstAll: first.map(Math.round),
    secondAll: second.map(Math.round),
    titleFiles: detail.first.loaded,
    titleBytes: raw(detail.first.loaded),
    titleGzip: gz(detail.first.loaded),
    secondNetworkFiles: detail.second.network,
  };
}

/** 各モードに入ったときに追加で読むチャンク（タイトルまでに読んだもの以外） */
async function measureModes(browser, base) {
  const card = (mode) => (p) => p.click(`.mode-card[data-mode="${mode}"]`);
  const MODES = [
    {
      mode: 'free',
      open: card('free'),
      go: (p) => dialogButton(p, '出撃').click(),
      until: 'flight',
    },
    {
      mode: 'race',
      open: card('race'),
      go: async (p) => {
        await p.locator('.race-course').first().click();
        await p.locator('.ui-button.is-primary:text-is("スタート")').click();
      },
      until: 'flight',
    },
    {
      mode: 'raid',
      open: card('raid'),
      go: (p) => dialogButton(p, 'ソロで出撃').click(),
      until: 'flight',
    },
    {
      mode: 'defense',
      open: card('defense'),
      go: (p) => dialogButton(p, 'ソロで出撃').click(),
      until: 'flight',
    },
    { mode: 'pvp', open: card('pvp'), go: async () => undefined, until: 'lobby' },
    {
      mode: 'replay',
      open: (p) => p.click('.mode-tile[data-mode="replay"]'),
      go: async () => undefined,
      until: 'replay_select',
    },
  ];
  const result = [];
  let prefetch = null;
  for (const m of MODES) {
    const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true });
    const log = await watch(context);
    const page = await context.newPage();
    await page.goto(base);
    await seed(page);
    await page.reload();
    await shown(page, '.title-screen');
    const atTitle = log.requests.length;
    await page.locator('.title-screen').click({ position: { x: 40, y: VIEWPORT.height / 2 } });
    await shown(page, '.mode-select-screen');
    // モード選択で先読みするもの（8-2）が済むのを待つ
    await page.waitForTimeout(1500);
    prefetch ??= chunkFiles(log.requests.slice(atTitle));
    const before = log.requests.length;
    await m.open(page);
    await m.go(page);
    const ok = await screenIs(page, m.until, 30000);
    await page.waitForTimeout(1000);
    result.push({ mode: m.mode, ok, files: chunkFiles(log.requests.slice(before)) });
    await context.close();
  }
  return { prefetch: prefetch ?? [], modes: result };
}

/** 読み込んだ JS・CSS（重複なし） */
const chunkFiles = (urls) => [
  ...new Set(urls.map((u) => new URL(u).pathname.slice(1)).filter((p) => /\.(js|css)$/.test(p))),
];

async function runLighthouse(base) {
  const { default: lighthouse } = await import('lighthouse');
  const scores = [];
  const failed = [];
  for (let i = 0; i < 9 && scores.length < 3; i++) {
    const port = 9300 + i;
    const browser = await chromium.launch({
      args: [...GL_ARGS, `--remote-debugging-port=${port}`],
    });
    const r = await lighthouse(base, { port, output: 'json', logLevel: 'error' });
    await browser.close();
    const lhr = r?.lhr;
    if (!lhr) continue;
    const lcpAudit = lhr.audits['largest-contentful-paint'];
    if (lhr.categories.performance?.score == null || !lcpAudit?.numericValue) {
      failed.push(lhr.runtimeError?.code ?? lcpAudit?.errorMessage ?? 'performance のスコアなし');
      continue;
    }
    const cat = (k) => Math.round((lhr.categories[k]?.score ?? 0) * 100);
    const metric = (k) => Math.round(lhr.audits[k]?.numericValue ?? 0);
    scores.push({
      performance: cat('performance'),
      accessibility: cat('accessibility'),
      bestPractices: cat('best-practices'),
      seo: cat('seo'),
      fcp: metric('first-contentful-paint'),
      lcp: metric('largest-contentful-paint'),
      tbt: metric('total-blocking-time'),
      si: metric('speed-index'),
      cls: Math.round((lhr.audits['cumulative-layout-shift']?.numericValue ?? 0) * 1000) / 1000,
      formFactor: lhr.configSettings.formFactor,
      throttling: lhr.configSettings.throttlingMethod,
    });
  }
  const pick = (k) => median(scores.map((s) => s[k]));
  return {
    runs: scores,
    failed,
    median: Object.fromEntries(
      [
        'performance',
        'accessibility',
        'bestPractices',
        'seo',
        'fcp',
        'lcp',
        'tbt',
        'si',
        'cls',
      ].map((k) => [k, pick(k)]),
    ),
  };
}

if (!existsSync(join(DIR, 'index.html')))
  throw new Error(`${DIR} がありません。先に npm run build`);
mkdirSync(out, { recursive: true });
const chunks = listChunks(DIR);
const sizes = new Map(chunks.map((c) => [c.file, c]));
const server = await serveDist(DIR, PORT);
const base = `http://localhost:${PORT}/`;
const browser = await chromium.launch({ args: GL_ARGS });
const report = { date: new Date().toISOString(), chunks };
report.startup = await measureStartup(browser, base, sizes);
report.modes = await measureModes(browser, base);
await browser.close();
if (!args.includes('--no-lighthouse')) report.lighthouse = await runLighthouse(base);
server.close();
writeFileSync(join(out, 'perf.json'), JSON.stringify(report, null, 2));

const kb = (n) => (n === null ? '-' : `${(n / 1024).toFixed(1)} KB`);
console.log('file\tbytes\tgzip');
for (const c of chunks) console.log(`${c.file}\t${kb(c.bytes)}\t${kb(c.gzip)}`);
const s = report.startup;
console.log(
  `\nタイトルまで（中央値・${s.runs} 回）: 初回 ${s.firstMs} ms / 2 回目 ${s.secondMs} ms`,
);
console.log(`  初回の各回 ${s.firstAll.join(', ')} / 2 回目の各回 ${s.secondAll.join(', ')}`);
console.log(`  タイトルまでに読む JS・CSS ${kb(s.titleBytes)}（gzip ${kb(s.titleGzip)}）`);
for (const f of s.titleFiles) console.log(`    ${f}`);
console.log(`  2 回目にネットワークから取った JS・CSS ${s.secondNetworkFiles.length} 件`);
console.log(`モード選択で先読み: ${report.modes.prefetch.join(', ') || 'なし'}`);
for (const m of report.modes.modes)
  console.log(`mode ${m.mode}\t${m.ok ? 'OK' : 'NG'}\t追加 ${m.files.join(', ') || 'なし'}`);
if (report.lighthouse) {
  const l = report.lighthouse.median;
  console.log(
    `\nLighthouse（モバイル・中央値）: performance ${l.performance} / accessibility ${l.accessibility} / best-practices ${l.bestPractices} / SEO ${l.seo}`,
  );
  console.log(
    `  FCP ${l.fcp} ms / LCP ${l.lcp} ms / TBT ${l.tbt} ms / SI ${l.si} ms / CLS ${l.cls}`,
  );
  const lh = report.lighthouse;
  const why = [...new Set(lh.failed)].join(' / ');
  console.log(`  有効 ${lh.runs.length} 回・除外 ${lh.failed.length} 回${why ? `（${why}）` : ''}`);
}
process.exit(0);
