/* global console, process */
// 10-1: タイトルまでに読むファイルの中身の内訳（どの機能がどれだけ占めているか）。
//   node scripts/startup-breakdown.js [出力先]   （本番と同じ設定でビルドし直して数える。出力先に breakdown.json）
// 起動時のチャンク（index.html が読むもの）と言語の表の各モジュールを gzip して機能ごとに足し、チャンクごとの実際の gzip 後の大きさに
// 合わせて按分する（モジュールを 1 つずつ圧縮すると、まとめて圧縮したときより大きくなるため）。CSS はファイルごと
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const out = process.argv[2] ?? 'perf-report';

/** 機能の分け方（上から順に最初に当たったもの） */
const FEATURES = [
  ['three.js（本体）', /node_modules\/three\/build\/three\.core/],
  ['three.js（WebGL の描画・ポストエフェクト）', /node_modules\/three\//],
  ['文言の表（今の言語の 1 つ）', /src\/data\/i18n\//],
  ['勲章の表と判定', /src\/(data\/badges|progression\/badges|missions\/badges|ui\/badge)/],
  [
    'チュートリアル・練習場・日替わり',
    /src\/(data|ui|missions|progression)\/(tutorial|practice|daily)/,
  ],
  ['ロビー・PvP・協力（通信）', /src\/(net|ui\/(pvp|lobby|coop))/],
  ['レイドの怪獣', /src\/(entities|ai|render|ui|audio|data)\/kaiju/],
  ['リングレース・防衛戦', /src\/(missions|ui|render|data)\/(race|defense)/],
  ['HUD', /src\/(ui\/(hud|mission-hud|damage-overlay|touch|drag|tilt)|render\/(hud|target-proj))/],
  ['飛行・戦闘・敵機（判定）', /src\/(flight|combat|entities|ai)\//],
  ['各モードの進行（ミッション・リプレイ）', /src\/(missions|replay)\//],
  ['機体のモデル・塗装', /src\/render\/(aircraft-model|skin)\/|src\/render\/(player|hangar)/],
  [
    '演出（弾・爆発・煙）',
    /src\/render\/(fx\/|particles|smoke|tracers|missile|ordnance|combat-view)/,
  ],
  ['街（港湾都市）の描画', /src\/render\/city\//],
  [
    '空・海・島・雲・天候（タイトルの背景）',
    /src\/render\/(atmosphere|ocean|terrain|cloud|vegetation|weather\/|sky|lighting|coast|noise|gerstner|scene|materials|shadow|demo-camera)/,
  ],
  ['描画のその他（ポストエフェクト・画質・カメラ）', /src\/render\//],
  ['音（効果音の合成・BGM）', /src\/audio\//],
  ['セーブ・成長・記録', /src\/progression\//],
  ['画面（タイトル・メニュー・設定など）', /src\/ui\//],
  ['数値の表（src/data）', /src\/data\//],
  ['土台（ループ・入力・設定・起動）', /src\/(core|main|app|game-app)/],
  ['その他（Vite の補助など）', /./],
];

const feature = (id) => FEATURES.find(([, re]) => re.test(id.replace(/\\/g, '/')))[0];

/** 起動時に読むチャンク（エントリとその静的な import）と、言語の表（大きい方） */
function startupChunks(bundle) {
  const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
  const entry = chunks.find((c) => c.isEntry);
  const names = new Set();
  const stack = [entry.fileName];
  while (stack.length > 0) {
    const f = stack.pop();
    if (names.has(f)) continue;
    names.add(f);
    stack.push(...(bundle[f]?.imports ?? []));
  }
  const tables = chunks
    .filter((c) => /^assets\/(ja|en)-/.test(c.fileName))
    .sort((a, b) => gzipSync(b.code).length - gzipSync(a.code).length);
  if (tables[0]) names.add(tables[0].fileName);
  const css = new Set();
  for (const f of names) for (const c of bundle[f]?.viteMetadata?.importedCss ?? []) css.add(c);
  return { js: [...names].map((f) => bundle[f]), css: [...css].map((f) => bundle[f]) };
}

const rows = new Map();
const add = (name, raw, gz) => {
  const r = rows.get(name) ?? { raw: 0, gzip: 0 };
  r.raw += raw;
  r.gzip += gz;
  rows.set(name, r);
};
let files = [];

const breakdown = {
  name: 'skyraid-startup-breakdown',
  apply: 'build',
  generateBundle(_options, bundle) {
    const { js, css } = startupChunks(bundle);
    files = [
      ...js.map((c) => ({ file: c.fileName, gzip: gzipSync(c.code).length })),
      ...css.map((c) => ({ file: c.fileName, gzip: gzipSync(c.source).length })),
    ];
    for (const chunk of js) {
      const mods = Object.entries(chunk.modules).filter(([, m]) => m.code);
      const each = mods.map(([id, m]) => [id, m.renderedLength, gzipSync(m.code).length]);
      const sum = each.reduce((s, [, , g]) => s + g, 0);
      // チャンクの実際の gzip 後の大きさに按分（チャンク分けの補助のコードは「その他」）
      const real = gzipSync(chunk.code).length;
      for (const [id, raw, g] of each) add(feature(id), raw, sum ? (g / sum) * real : 0);
    }
    for (const c of css) add('CSS（画面の見た目）', c.source.length, gzipSync(c.source).length);
  },
};

const dir = mkdtempSync(join(tmpdir(), 'skyraid-breakdown-'));
try {
  await build({
    logLevel: 'warn',
    build: { outDir: dir, emptyOutDir: true },
    plugins: [breakdown],
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
// legacy-check.js は Vite のバンドルの外（scripts/vite-legacy-check.ts）。約 2KB
const total = [...rows.values()].reduce((s, r) => s + r.gzip, 0);
const list = [...rows.entries()].sort((a, b) => b[1].gzip - a[1].gzip);
const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
console.log('| 機能 | gzip | 割合 | 元の大きさ |');
console.log('| --- | --- | --- | --- |');
for (const [name, r] of list)
  console.log(
    `| ${name} | ${kb(r.gzip)} | ${((r.gzip / total) * 100).toFixed(1)}% | ${kb(r.raw)} |`,
  );
console.log(`| 合計（legacy-check.js を除く） | ${kb(total)} | 100% | |`);
console.log(`\nファイル: ${files.map((f) => `${f.file} ${kb(f.gzip)}`).join(' / ')}`);
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'breakdown.json'),
  JSON.stringify({ files, features: Object.fromEntries(list) }, null, 2),
);
