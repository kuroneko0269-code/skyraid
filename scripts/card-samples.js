/* global console, process, Buffer */
// 8-5: 記録カードの見本（ミッション・レイド・レース・防衛戦 × 日本語・英語。背景は固定のデザイン）を PNG で書き出す。
// 開発サーバーのページでアプリと同じ描画（src/ui/card/）を動かす（フォントは Google Fonts を待つ。読めなければ代わりのフォント）。
// 使い方: `node scripts/card-samples.js <出力先>`。結果画面からの生成（場面の背景）は `ui-audit.js --release` の card で確かめる
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] ?? 'card-samples';
mkdirSync(out, { recursive: true });

const common = { aircraftId: 'kestrel', pilotName: 'ACE', date: Date.UTC(2026, 10, 2, 4, 5) };
const SOURCES = {
  mission: { mode: 'mission', missionId: 'first-sortie', success: true, rank: 'S', seconds: 192 },
  raid: {
    mode: 'raid',
    difficulty: 'hard',
    success: true,
    rank: 'A',
    seconds: 754,
    protectedBuildings: 87,
  },
  race: {
    mode: 'race',
    courseId: 'harbor-speed',
    finished: true,
    rank: 'B',
    time: 83.456,
    newBest: true,
  },
  defense: {
    mode: 'defense',
    mapId: 'harbor',
    difficulty: 'normal',
    cleared: false,
    waves: 7,
    kills: 42,
  },
};

const server = await createServer({ server: { port: 5198, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5198/';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // アプリは起動させない（モジュールだけ読む）
  await page.route('**/src/main.ts', (r) =>
    r.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await page.goto(url);
  for (const lang of ['ja', 'en']) {
    for (const [name, s] of Object.entries(SOURCES)) {
      const data = await page.evaluate(
        async ([lang, source]) => {
          const i18n = await import('/src/core/i18n.ts');
          const table = await import(`/src/data/i18n/${lang}.json`);
          i18n.setMessages(lang, table.default);
          const paint = await import('/src/progression/paint.ts');
          const shapes = await import('/src/data/aircraft.ts');
          const p = paint.defaultPaint(shapes.AIRCRAFT_MODELS[0].shape, null, () => 0.27);
          p.pattern = 'splitter';
          p.base = 1;
          const canvas = await import('/src/ui/card/card-canvas.ts');
          const model = await import('/src/ui/card/card-model.ts');
          const card = await import('/src/data/card.ts');
          await canvas.waitForCardFonts();
          const m = model.buildCardModel(
            { ...source, paint: p },
            { includePilot: true, url: 'https://skyraid.example.com/' },
          );
          const { canvas: c } = canvas.drawCard(m, card.CARD_SIZES[card.CARD_SIZE], null);
          return {
            png: c.toDataURL('image/png'),
            text: model.cardShareText(m, 'https://skyraid.example.com/'),
          };
        },
        [lang, { ...common, ...s }],
      );
      const file = `${out}/card-${name}-${lang}.png`;
      writeFileSync(file, Buffer.from(data.png.split(',')[1], 'base64'));
      console.log(`${file}\n    ${data.text.replace('\n', '\n    ')}`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
