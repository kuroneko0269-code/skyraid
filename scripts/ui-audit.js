/* global console, process, document, getComputedStyle, innerWidth, innerHeight, localStorage */
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
// 画面遷移のチェック: 設定画面の「戻る」で開いた元（タイトル / モード選択 / ポーズ）に戻るか
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// クラウドセッションの Playwright は全体に入っている（require で見つかる。ESM の import では見つからない）
const { chromium } = createRequire(import.meta.url)('playwright');

const out = process.argv[2] ?? 'ui-audit';
const base = process.argv[3] ?? 'http://localhost:5173/';
const SIZES = [
  { name: 'phone-se', width: 568, height: 320, touch: true },
  { name: 'phone', width: 844, height: 390, touch: true },
  { name: 'pc', width: 1920, height: 1080, touch: false },
];
mkdirSync(out, { recursive: true });

/** ページの中で動かす点検（visible な screen の中の要素） */
function inspect(rootSelector) {
  const root = document.querySelector(rootSelector);
  const issues = [];
  if (!root) return { issues: [{ kind: 'missing', target: rootSelector }], vscroll: false };
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return (
      r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && e.closest('[hidden]') === null
    );
  };
  const label = (e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24);
  const buttons = [...root.querySelectorAll('.ui-button, button.ui-toggle, .ui-seg-item')].filter(
    vis,
  );
  const rects = buttons.map((b) => b.getBoundingClientRect());
  buttons.forEach((b, i) => {
    const r = rects[i];
    const card = b.classList.contains('ui-item');
    if (!card) {
      const range = document.createRange();
      range.selectNodeContents(b);
      const tops = new Set(
        [...range.getClientRects()].filter((x) => x.width > 1).map((x) => Math.round(x.top)),
      );
      if (tops.size > 1) issues.push({ kind: 'wrap', target: label(b) });
      if (b.scrollWidth > b.clientWidth + 1) issues.push({ kind: 'clip', target: label(b) });
    } else {
      for (const c of b.children)
        if (c.tagName !== 'svg' && vis(c) && c.scrollWidth > c.clientWidth + 1)
          issues.push({
            kind: 'ellipsis',
            target: `${label(b).slice(0, 10)} / ${c.textContent.slice(0, 16)}`,
          });
    }
    if (r.height < 36)
      issues.push({ kind: 'small', target: `${label(b)} (${Math.round(r.height)}px)` });
    if (r.left < -1 || r.right > innerWidth + 1)
      issues.push({ kind: 'offscreen', target: label(b) });
    for (let j = i + 1; j < buttons.length; j++) {
      const o = rects[j];
      const ix = Math.min(r.right, o.right) - Math.max(r.left, o.left);
      const iy = Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top);
      if (ix > 2 && iy > 2 && !b.contains(buttons[j]) && !buttons[j].contains(b))
        issues.push({ kind: 'overlap', target: `${label(b)} × ${label(buttons[j])}` });
    }
  });
  if (
    document.documentElement.scrollWidth > innerWidth + 1 ||
    root.scrollWidth > root.clientWidth + 1
  )
    issues.push({ kind: 'hscroll', target: rootSelector });
  return { issues, vscroll: root.scrollHeight > root.clientHeight + 1, buttons: buttons.length };
}

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
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });

for (const size of SIZES) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    hasTouch: size.touch,
    isMobile: false,
    deviceScaleFactor: 1,
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
    await page.click(`.settings-tabs .ui-seg-item:text-is("${tab}")`);
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
    await page.click(`.info-tabs .ui-seg-item:text-is("${tab}")`);
    await shot(`info-${name}`, '.info-screen');
  }
  await page.click('.info-screen .menu-back');
  await flow('情報 → 戻る', await shownOnly('.mode-select-screen', '.info-screen'));

  // トースト（更新の知らせと同じ部品・ボタン 2 つ）
  await page.evaluate(async () => {
    const m = await import('/src/ui/toast.ts');
    m.showToast('新しいバージョンがあります（次回の起動で更新）', {
      seconds: 0,
      actions: [{ label: '今すぐ更新', kind: 'primary' }, { label: '閉じる' }],
    });
    m.showToast('共有ボタン →「ホーム画面に追加」で全画面で遊べます', {
      seconds: 0,
      actions: [{ label: '閉じる' }],
    });
  });
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
  await page.click('.pause-actions .ui-button:text-is("すべての設定")');
  await shown('.settings-screen');
  for (const [tab, name] of [
    ['表示', 'display'],
    ['音', 'sound'],
    ['操作', 'controls'],
    ['ゲーム', 'game'],
    ['データ', 'data'],
  ]) {
    await page.click(`.settings-tabs .ui-seg-item:text-is("${tab}")`);
    await shot(`pause-settings-${name}`, '.settings-screen');
  }
  await page.click('.settings-tabs .ui-seg-item:text-is("表示")');
  const paused = await page.evaluate(() => document.documentElement.dataset.screen);
  await page.click('.settings-screen .menu-back');
  const back = await shownOnly('.pause-screen', '.settings-screen');
  const quick = await page.locator('.pause-quick .settings-item').count();
  const still = await page.evaluate(() => document.documentElement.dataset.screen);
  await flow(
    'ポーズ → すべての設定 → 戻る（飛行は止まったまま）',
    paused === 'pause' && still === 'pause' && back && quick > 0,
  );
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
