/* global console, process, document, innerHeight, localStorage */
// UI の自動点検（7-C の手順を 7-D でスクリプトにした）: 3 サイズでメニューの画面を撮り、機械チェックをする。
// 使い方: 開発サーバーを立ててから `node scripts/ui-audit.js <出力先> [URL]`（既定 http://localhost:5173/）。
// Playwright はクラウドセッションに入っているもの（依存には足さない）。結果は <出力先>/audit.json と各 PNG
//
// 機械チェック（画面に出ている要素だけ）:
//   wrap     ボタン（.ui-button・button.ui-toggle・.ui-seg-item）の文字が 2 行以上に折り返している
//   clip     ボタンの文字が枠からはみ出している（scrollWidth > clientWidth）
//   ellipsis カードの各行が「…」で切れている（警告）
//   small    ボタンの高さが 36px 未満（タップしにくい）
//   overlap  ボタンどうしが重なっている
//   hscroll  横スクロールが出ている（画面の幅を超える）
//   offscreen ボタンが画面の外（左右）にある
//   vscroll  画面が縦にスクロールする（情報。7-C で背の低い画面は可とした）
//   band     固定部分（見出し・戻る・タブ。.menu-top）の高さが画面の 30% を超える（7-4c）
//   tabsMoved タブの位置がタブの切り替え・内容のスクロールで動いた（7-4c）
//   hscrollEl 横にスクロールできる要素がある（8-6d。画面の外のダイアログ・お知らせも。意図した一覧は audit-inspect.js の除外リスト）
//   hclip    縦にスクロールする入れ物で中身が横に切れている（8-6d）
//   serif    文字の計算後のフォントがブラウザ既定（serif）（8-6d。アプリのフォントを受け継いでいない）
// 8-6d: 画面はタイトル・名前の入力・設定 5 タブ・モード選択・情報 4 タブ・お知らせ・ポーズ・ポーズの設定 5 タブに加え、
//      キャンペーン・ブリーフィング・レース・各ダイアログ・ハンガー・リプレイ・ロビー・設定のデータ（オンライン連携の見本）・
//      記録カード（scripts/ui-audit-screens.js）。ページの中の点検は scripts/audit-inspect.js
// 画面遷移のチェック: 設定画面の「戻る」で開いた元（タイトル / モード選択 / ポーズ）に戻るか
// 8-1: `--release` を付けると公開前の点検（scripts/ui-audit-release.js。本番ビルド dist を _headers 付きで配信して全モード）
// 8-3: `--browser chromium|firefox|webkit|all`（既定 chromium）で Playwright のエンジンを選ぶ。all は 3 つを <出力先>/<エンジン>/ に。
//      取得していないエンジンは飛ばして「取得できない」と出す（`npx playwright install firefox webkit` で取得）
// 8-4: `--lang en` で英語の画面を点検する（ブラウザの言語を en-US に。既定は ja-JP。scripts/audit-lang.js）
import { CONTEXT_LOCALE, L } from './audit-lang.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pickBrowsers } from './audit-browsers.js';
import { showSampleToasts } from './audit-helpers.js';
import { inspect } from './audit-inspect.js';
import { auditMoreScreens, setScreensOut } from './ui-audit-screens.js';

const argv = process.argv.slice(2);
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const VALUED = ['--browser', '--lang'];
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUED.includes(argv[i - 1]));
const out = positional[0] ?? 'ui-audit';
const base = positional[1] ?? 'http://localhost:5173/';
const engines = pickBrowsers(valueOf('--browser') ?? 'chromium');
const SIZES = [
  { name: 'phone-se', width: 568, height: 320, touch: true },
  { name: 'phone', width: 844, height: 390, touch: true },
  { name: 'pc', width: 1920, height: 1080, touch: false },
];
mkdirSync(out, { recursive: true });
setScreensOut(out);
if (argv.includes('--release')) {
  const { runReleaseAudit } = await import('./ui-audit-release.js');
  const summary = [];
  for (const engine of engines) {
    const dir = engines.length > 1 ? `${out}/${engine.name}` : out;
    mkdirSync(dir, { recursive: true });
    if (!engine.available) {
      console.log(`\n== ${engine.name}: 取得できない（${engine.reason}）`);
      summary.push({ browser: engine.name, available: false, reason: engine.reason });
      continue;
    }
    console.log(`\n== ${engine.name}`);
    const report = await runReleaseAudit(engine, dir);
    summary.push({
      browser: engine.name,
      available: true,
      version: report.browser.version,
      ok: report.ok,
    });
  }
  if (engines.length > 1) writeFileSync(`${out}/browsers.json`, JSON.stringify(summary, null, 2));
  process.exit(0);
}
if (engines.length !== 1 || !engines[0].available)
  throw new Error(
    `開発サーバーの点検はエンジン 1 つ（取得済み）だけ: ${engines.map((e) => e.name).join(', ')}`,
  );

/** 固定部分の高さと、内容を一番下までスクロールしたときのタブの位置（7-4c） */
async function measureBand(page, rootSelector) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    const top = root?.querySelector('.menu-top');
    const tabs = top?.querySelector('.ui-seg');
    const scroller = root?.querySelector('.menu-scroll');
    if (!top || !tabs || !scroller) return null;
    const tabsTop = tabs.getBoundingClientRect().top;
    scroller.scrollTop = scroller.scrollHeight;
    const tabsTopScrolled = tabs.getBoundingClientRect().top;
    scroller.scrollTop = 0;
    return {
      bandPx: Math.round(top.getBoundingClientRect().bottom),
      bandRatio: top.getBoundingClientRect().bottom / innerHeight,
      tabsTop: Math.round(tabsTop),
      tabsTopScrolled: Math.round(tabsTopScrolled),
      scrolls: scroller.scrollHeight > scroller.clientHeight + 1,
    };
  }, rootSelector);
}

const results = [];
const flows = [];
const browser = await engines[0].launch();

for (const size of SIZES) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    hasTouch: size.touch,
    isMobile: false,
    deviceScaleFactor: 1,
    locale: CONTEXT_LOCALE,
  });
  const page = await context.newPage();
  // PC の大きさは SwiftShader の描画が重いので、待ちを長めに
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  /** 設定・情報の各タブで最初に測ったタブの位置（切り替えで動かないこと） */
  const tabsTopOf = {};
  const shot = async (name, selector) => {
    await page.waitForTimeout(700);
    const r = await page.evaluate(inspect, selector);
    const band = await measureBand(page, selector);
    if (band) {
      r.band = band;
      if (band.bandRatio > 0.3)
        r.issues.push({
          kind: 'band',
          target: `${band.bandPx}px / ${Math.round(band.bandRatio * 100)}%`,
        });
      tabsTopOf[selector] ??= band.tabsTop;
      if (band.tabsTop !== tabsTopOf[selector] || band.tabsTopScrolled !== band.tabsTop)
        r.issues.push({
          kind: 'tabsMoved',
          target: `${tabsTopOf[selector]} → ${band.tabsTop} / スクロール後 ${band.tabsTopScrolled}`,
        });
    }
    results.push({ size: size.name, screen: name, ...r });
    await page.screenshot({ path: `${out}/${size.name}-${name}.png` });
  };
  const shown = (sel) => page.locator(`${sel}.is-shown`).waitFor({ timeout: 20000 });
  const flow = async (name, ok) => flows.push({ size: size.name, flow: name, ok });
  /** 条件が成り立つまで待つ（SwiftShader ではキーの処理が描画のフレームに乗るので遅い）。10 秒で諦めて false */
  const until = (fn, arg) =>
    page.waitForFunction(fn, arg, { timeout: 10000 }).then(
      () => true,
      () => false,
    );
  const shownOnly = (show, hide) =>
    until(
      ([a, b]) =>
        document.querySelector(a)?.classList.contains('is-shown') === true &&
        document.querySelector(b)?.classList.contains('is-shown') === false,
      [show, hide],
    );

  // 初回: タイトル → パイロット名 → モード選択（チュートリアルの案内は閉じる）。進捗が出るよう記録を入れて読み直す
  await page.goto(base);
  await shown('.title-screen');
  await page.locator('.title-screen').click({ position: { x: 40, y: size.height / 2 } });
  await shown('.pilot-name-screen');
  await shot('pilot-name', '.pilot-name-screen');
  await page.fill('.pilot-name-input', 'ACE');
  await page.keyboard.press('Enter');
  await shown('.mode-select-screen');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('skyraid.save'));
    for (const [id, rank] of [
      ['m1', 'A'],
      ['m2', 'S'],
      ['m3', 'B'],
    ])
      s.missions[id] = { unlocked: true, bestRank: rank };
    const race = (bestRank) => ({ bestRank, clears: 1, times: [], ghost: null });
    s.races = { coast: race('S'), canyon: race('A'), harbor: race('S') };
    s.records = { defenseWaves: { 'island:normal': 7 }, raidBestMs: { normal: 754000 } };
    localStorage.setItem('skyraid.save', JSON.stringify(s));
  });
  await page.goto(base);
  await shown('.title-screen');
  await page.waitForTimeout(800);
  await shot('title', '.title-screen');

  // タイトル → 設定 → 戻る
  await page.click('.title-settings');
  await shown('.settings-screen');
  await shot('settings-display', '.settings-screen');
  for (const [tab, name] of [
    ['音', 'sound'],
    ['操作', 'controls'],
    ['ゲーム', 'game'],
    ['データ', 'data'],
  ]) {
    await page.click(`.settings-tabs .ui-seg-item:text-is("${L(tab, 'settings.')}")`);
    await shot(`settings-${name}`, '.settings-screen');
  }
  await page.click('.settings-screen .menu-back');
  await flow('タイトル → 設定 → 戻る', await shownOnly('.title-screen', '.settings-screen'));

  // モード選択
  await page.locator('.title-screen').click({ position: { x: 40, y: size.height / 2 } });
  await shown('.mode-select-screen');
  await shot('mode-select', '.mode-select-screen');
  await page.click('.mode-tile[data-mode="settings"]');
  await shown('.settings-screen');
  await page.keyboard.press('Escape');
  await flow('モード選択 → 設定 → Esc', await shownOnly('.mode-select-screen', '.settings-screen'));
  await page.click('.mode-tile[data-mode="info"]');
  await shown('.info-screen');
  for (const [tab, name] of [
    ['版', 'version'],
    ['更新履歴', 'changes'],
    ['ライセンス', 'licenses'],
    ['データの扱い', 'data'],
  ]) {
    await page.click(`.info-tabs .ui-seg-item:text-is("${L(tab, 'info.')}")`);
    await shot(`info-${name}`, '.info-screen');
  }
  await page.click('.info-screen .menu-back');
  await flow('情報 → 戻る', await shownOnly('.mode-select-screen', '.info-screen'));

  // トースト（更新の知らせと同じ部品・ボタン 2 つ）
  await showSampleToasts(page);
  await shot('toast', '.toast-stack');
  await page.evaluate(() => document.querySelector('.toast-stack')?.replaceChildren());

  // フリーフライト → ポーズ → すべての設定 → 戻る
  await page.click('.mode-card[data-mode="free"]');
  await page.locator('.mode-prompt:not([hidden]) .ui-button.is-primary').first().click();
  await page.waitForFunction(() => document.documentElement.dataset.screen === 'flight', null, {
    timeout: 30000,
  });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await shown('.pause-screen');
  await shot('pause', '.pause-screen');
  await page.click(`.pause-actions .ui-button:text-is("${L('すべての設定')}")`);
  await shown('.settings-screen');
  for (const [tab, name] of [
    ['表示', 'display'],
    ['音', 'sound'],
    ['操作', 'controls'],
    ['ゲーム', 'game'],
    ['データ', 'data'],
  ]) {
    await page.click(`.settings-tabs .ui-seg-item:text-is("${L(tab, 'settings.')}")`);
    await shot(`pause-settings-${name}`, '.settings-screen');
  }
  await page.click(`.settings-tabs .ui-seg-item:text-is("${L('表示', 'settings.')}")`);
  const paused = await page.evaluate(() => document.documentElement.dataset.screen);
  await page.click('.settings-screen .menu-back');
  const back = await shownOnly('.pause-screen', '.settings-screen');
  const quick = await page.locator('.pause-quick .settings-item').count();
  const still = await page.evaluate(() => document.documentElement.dataset.screen);
  await flow(
    'ポーズ → すべての設定 → 戻る（飛行は止まったまま）',
    paused === 'pause' && still === 'pause' && back && quick > 0,
  );
  // 8-6d: 残りの画面・タブ・ダイアログ（横スクロールとフォントも。scripts/ui-audit-screens.js）
  await auditMoreScreens(page, base, size, shot, shown);
  results.push({
    size: size.name,
    screen: 'console',
    issues: errors.map((e) => ({ kind: 'console', target: e.slice(0, 120) })),
  });
  await context.close();
}
await browser.close();
writeFileSync(`${out}/audit.json`, JSON.stringify({ results, flows }, null, 2));
for (const r of results) {
  const kinds = r.issues.map((i) => i.kind);
  const band = r.band
    ? `\tband ${r.band.bandPx}px(${Math.round(r.band.bandRatio * 100)}%) tabs@${r.band.tabsTop}${r.band.scrolls ? ' scrolls' : ''}`
    : '';
  console.log(
    `${r.size}\t${r.screen}\t${r.vscroll ? 'vscroll ' : ''}${kinds.length ? kinds.join(',') : 'OK'}${band}`,
  );
  for (const i of r.issues) console.log(`    ${i.kind}: ${i.target}`);
}
for (const f of flows) console.log(`${f.size}\t${f.flow}\t${f.ok ? 'OK' : 'NG'}`);
