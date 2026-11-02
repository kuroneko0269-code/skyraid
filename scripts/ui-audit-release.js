/* global console, document, localStorage, indexedDB, navigator, fetch, URL, location, createImageBitmap */
// 公開前の点検（8-1。scripts/ui-audit.js の拡張）: `npm run build` の後に `node scripts/ui-audit.js <出力先> --release`。
// dist を dist/_headers のヘッダー（CSP など）付きで配信し（Cloudflare Pages と同じ形）、844×390 のタッチ端末で次を確かめる:
//   modes    全モードを通しで起動（チュートリアル・キャンペーン M1・フリーフライト・レース・レイド / 防衛戦のソロは飛行まで、
//            PvP・協力はロビー画面まで。?net=local で部屋を作ってロビーの部屋まで）。飛行ではポーズが開くこと
//   console  console のエラー・ページの例外が 0
//   csp      CSP 違反（securitypolicyviolation）が 0
//   firstRun localStorage / IndexedDB が空の状態からの初回起動（タイトル → パイロット名 → チュートリアルの案内）
//   pwa      manifest・アイコン・Service Worker の登録・オフラインでの起動
//   offline  環境変数なしのビルドでオンライン機能が隠れる（設定の「オンライン連携」・「ランキング」が無く、Supabase に通信しない）
// Google Fonts はクラウドの環境から外へ出られないので、空の CSS を返す（CSP の判定はブラウザが先に行うので影響しない）。
// 結果は <出力先>/release.json と各 PNG
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  VIEWPORT,
  collectCsp,
  dialogButton,
  screenIs,
  seed,
  shown,
  toModeSelect,
  watch,
} from './audit-helpers.js';
import { auditModes } from './ui-audit-modes.js';
import { serveDist } from './serve-dist.js';

/** 初回起動（ストレージが空）: タイトル → パイロット名 → モード選択にチュートリアルの案内 */
async function auditFirstRun(browser, base, out) {
  const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true });
  const log = await watch(context);
  const page = await context.newPage();
  const r = { ok: false, steps: [] };
  // アプリを読み込む前に、同じオリジンのアプリ以外のページで空なことを確かめる
  await page.goto(`${base}manifest.webmanifest`);
  const storage = () =>
    page.evaluate(async () => ({
      local: Object.keys(localStorage),
      idb: (await indexedDB.databases()).map((d) => d.name),
    }));
  const empty = await storage();
  r.steps.push(`起動前 localStorage ${empty.local.length} 件・IndexedDB ${empty.idb.length} 個`);
  await page.goto(base);
  await shown(page, '.title-screen');
  await page.locator('.title-screen').click({ position: { x: 40, y: VIEWPORT.height / 2 } });
  await shown(page, '.pilot-name-screen');
  r.steps.push('パイロット名の入力');
  await page.fill('.pilot-name-input', 'ROOKIE');
  await page.keyboard.press('Enter');
  await shown(page, '.mode-select-screen');
  const prompt = await page
    .locator('.mode-prompt:not([hidden])')
    .filter({ hasText: 'チュートリアル' })
    .first()
    .isVisible();
  r.steps.push(prompt ? 'チュートリアルの案内が出る' : 'チュートリアルの案内が出ない');
  await page.screenshot({ path: `${out}/release-first-run.png` });
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('skyraid.save') ?? 'null'),
  );
  r.steps.push(`セーブ: 版 ${saved?.version}・名前 ${saved?.pilotName}`);
  const after = await storage();
  r.steps.push(
    `初回起動後 localStorage: ${after.local.join(', ')} / IndexedDB: ${after.idb.join(', ')}`,
  );
  r.ok =
    empty.local.length === 0 && empty.idb.length === 0 && prompt && saved?.pilotName === 'ROOKIE';
  await collectCsp(page, log);
  Object.assign(r, { errors: log.errors, csp: log.csp });
  await context.close();
  return r;
}

/** PWA: manifest・アイコン・SW の登録・オフラインでの起動 */
async function auditPwa(browser, base, out) {
  const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true });
  const log = await watch(context);
  const page = await context.newPage();
  const r = { ok: false, steps: [] };
  await page.goto(base);
  await seed(page);
  await page.reload();
  await shown(page, '.title-screen');
  const info = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? null;
    if (!href) return { href };
    const res = await fetch(href);
    const manifest = await res.json();
    const icons = [];
    for (const i of manifest.icons ?? []) {
      const img = await fetch(new URL(i.src, new URL(href, location.href)).href);
      const blob = await img.blob();
      const bmp = await createImageBitmap(blob).catch(() => null);
      icons.push({
        src: i.src,
        sizes: i.sizes,
        purpose: i.purpose ?? 'any',
        status: img.status,
        actual: bmp ? `${bmp.width}x${bmp.height}` : 'decode NG',
      });
    }
    const apple = document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href');
    const appleOk = apple ? (await fetch(apple)).ok : false;
    return {
      href,
      name: manifest.name,
      display: manifest.display,
      orientation: manifest.orientation,
      icons,
      apple,
      appleOk,
    };
  });
  r.manifest = info;
  const iconsOk =
    (info.icons ?? []).length > 0 &&
    info.icons.every((i) => i.status === 200 && i.actual === i.sizes);
  r.steps.push(
    `manifest ${info.href ? 'あり' : 'なし'}（${info.name} / ${info.display} / ${info.orientation}）`,
  );
  r.steps.push(
    `アイコン ${(info.icons ?? []).map((i) => `${i.src} ${i.actual}`).join('・')}${iconsOk ? '' : ' ⚠'}`,
  );
  r.steps.push(`apple-touch-icon ${info.appleOk ? 'OK' : 'NG'}`);
  // SW が制御するまで待ってから、オフラインで読み直す
  const sw = await page
    .waitForFunction(() => navigator.serviceWorker?.controller !== null || false, null, {
      timeout: 5000,
    })
    .then(
      () => true,
      () => false,
    );
  if (!sw) {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await shown(page, '.title-screen');
  }
  const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
  r.steps.push(`Service Worker ${controlled ? 'がページを制御' : 'が制御していない'}`);
  await context.setOffline(true);
  let offline = false;
  try {
    await page.reload();
    await shown(page, '.title-screen');
    await page.locator('.title-screen').click({ position: { x: 40, y: VIEWPORT.height / 2 } });
    await shown(page, '.mode-select-screen');
    await page.click('.mode-card[data-mode="free"]');
    await dialogButton(page, '出撃').click();
    offline = await screenIs(page, 'flight');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${out}/release-offline.png` });
  } catch (e) {
    r.steps.push(`オフライン: 例外 ${String(e).slice(0, 120)}`);
  }
  r.steps.push(offline ? 'オフラインで起動 → フリーフライトまで' : 'オフラインで起動できない');
  r.ok = Boolean(info.href) && iconsOk && info.appleOk && controlled && offline;
  await collectCsp(page, log);
  // オフラインにしたあとの通信の失敗（Google Fonts などの外部）は数えない
  Object.assign(r, {
    errors: log.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e)),
    csp: log.csp,
  });
  await context.close();
  return r;
}

/** 情報画面（本番ビルド）: 版・更新履歴・ライセンス一覧（ビルド時に生成）・データの扱い */
async function auditInfo(browser, base, out) {
  const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true });
  const log = await watch(context);
  const page = await context.newPage();
  await page.goto(base);
  await seed(page);
  await toModeSelect(page, base);
  await page.click('.mode-tile[data-mode="info"]');
  await shown(page, '.info-screen');
  const info = await page.evaluate(() => {
    const text = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent ?? '');
    return {
      version: text('.info-version')[0] ?? '',
      changes: text('.info-tab:nth-child(2) .info-subheading'),
      licenses: text('.info-license summary'),
      withText: document.querySelectorAll('.info-license-text').length,
      data: text('.info-tab:nth-child(4) .info-subheading, .info-tab:nth-child(4) .info-text').join(
        '\n',
      ),
    };
  });
  await page.click('.info-tabs .ui-seg-item:text-is("ライセンス")');
  await page.screenshot({ path: `${out}/release-info-licenses.png` });
  await page.click('.info-tabs .ui-seg-item:text-is("データの扱い")');
  await page.screenshot({ path: `${out}/release-info-data.png` });
  const need = ['three', 'peerjs', '@supabase/supabase-js', 'workbox-precaching', 'Rajdhani'];
  const missing = need.filter((n) => !info.licenses.some((l) => l.startsWith(n)));
  const dataOk =
    info.data.includes('localStorage') &&
    /メールアドレス[^。]*と表示名[^。]*だけ/.test(info.data) &&
    /IP アドレス/.test(info.data);
  const r = {
    ok: info.version.includes('0.8.0') && missing.length === 0 && info.withText > 0 && dataOk,
    steps: [
      `版: ${info.version}`,
      `更新履歴: ${info.changes.length} 版（${info.changes[0] ?? ''} 〜 ${info.changes.at(-1) ?? ''}）`,
      `ライセンス: ${info.licenses.length} 件・本文あり ${info.withText} 件${missing.length ? `・不足 ${missing.join(', ')}` : ''}`,
      `データの扱い: ${dataOk ? 'セーブはブラウザ内・メールと表示名だけ・P2P の IP の記載あり' : '記載が不足 ⚠'}`,
    ],
  };
  await collectCsp(page, log);
  Object.assign(r, { errors: log.errors, csp: log.csp });
  await context.close();
  return r;
}

/** 環境変数なしのビルド: オンライン連携の UI が無く、Supabase に通信しない */
async function auditOnlineHidden(browser, base, dir) {
  const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true });
  const log = await watch(context);
  const page = await context.newPage();
  await page.goto(base);
  await seed(page);
  await toModeSelect(page, base);
  const ranking = await page.locator('.mode-tile[data-mode="ranking"]').isVisible();
  await page.click('.mode-tile[data-mode="settings"]');
  await shown(page, '.settings-screen');
  await page.click('.settings-tabs .ui-seg-item:text-is("データ")');
  const online = await page.locator('.online-settings').count();
  const headers = readFileSync(join(dir, '_headers'), 'utf8');
  const supabaseCsp = /supabase/.test(headers);
  const supabaseReq = log.requests.filter((u) => /supabase/i.test(u) || /online-app/.test(u));
  const r = {
    ok: !ranking && online === 0 && !supabaseCsp && supabaseReq.length === 0,
    steps: [
      `ランキングのタイル ${ranking ? '表示 ⚠' : 'なし'}`,
      `設定の「オンライン連携」 ${online ? 'あり ⚠' : 'なし'}`,
      `_headers の connect-src に Supabase ${supabaseCsp ? 'あり ⚠' : 'なし'}`,
      `Supabase・online-app への通信 ${supabaseReq.length} 件`,
    ],
  };
  await collectCsp(page, log);
  Object.assign(r, { errors: log.errors, csp: log.csp });
  await context.close();
  return r;
}

export async function runReleaseAudit(chromium, out, dir = 'dist', port = 4174) {
  if (!existsSync(join(dir, 'index.html')))
    throw new Error(`${dir} がありません。先に npm run build`);
  const server = await serveDist(dir, port);
  const base = `http://localhost:${port}/`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const report = {
    modes: await auditModes(browser, base, out),
    firstRun: await auditFirstRun(browser, base, out),
    pwa: await auditPwa(browser, base, out),
    onlineHidden: await auditOnlineHidden(browser, base, dir),
    info: await auditInfo(browser, base, out),
  };
  await browser.close();
  server.close();
  writeFileSync(`${out}/release.json`, JSON.stringify(report, null, 2));
  const all = [...report.modes, report.firstRun, report.pwa, report.onlineHidden, report.info];
  const errors = all.flatMap((r) => r.errors);
  const csp = all.flatMap((r) => r.csp);
  for (const m of report.modes)
    console.log(
      `mode\t${m.mode}\t${m.ok ? 'OK' : 'NG'}\t${m.detail}\terrors ${m.errors.length}\tcsp ${m.csp.length}`,
    );
  for (const [name, r] of [
    ['firstRun', report.firstRun],
    ['pwa', report.pwa],
    ['onlineHidden', report.onlineHidden],
    ['info', report.info],
  ]) {
    console.log(`${name}\t${r.ok ? 'OK' : 'NG'}`);
    for (const s of r.steps) console.log(`    ${s}`);
  }
  console.log(`console errors\t${errors.length}`);
  for (const e of [...new Set(errors)]) console.log(`    ${e}`);
  console.log(`CSP violations\t${csp.length}`);
  for (const v of [...new Set(csp)]) console.log(`    ${v}`);
  return report;
}
