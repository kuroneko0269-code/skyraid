/* global console, process */
// 9-1 操作の診断: `npm run analyze-replay -- <ファイルかフォルダ> ...`。リプレイ（.skyreplay）を本番と同じ判定で再生し、
// スティックの倒し具合・向きの反転・機首と敵のずれ・画面の外・射撃の照準・ミサイルの使い方を表にする（docs/control-analysis.md）。
// フォルダは中の .skyreplay を 1 つのグループとして足し合わせる。TypeScript は Vite のモジュールランナーで読み込む（追加のパッケージなし）
//   --aspect 2.16        画面の横 / 縦（画面の外の判定。iPhone の横画面）
//   --each               1 本ずつの表も出す
//   --timeline           1 本ずつ、10 秒ごとの推移を出す
//   --make-bots <出力先>  ボット（平均的・初心者役・模擬の人）のリプレイを作る（--missions training,first-sortie --seeds 4 --roles ...）
//   --experiment         模擬の人で 9-2・9-3 の案を比べる（--missions・--seeds・--only base,curve2）
//   --decompose          難しさの原因の分解（初心者役のボットに人の条件を 1 つずつ足す。--missions・--seeds）
//   --compare            9-2 のスティックの変更前後（今の操作 / 方向へ倒す・カーブ 1.5 など。--missions・--seeds）
//   --tilt               9-4 の傾き・ドラッグ（同じ組み立てに傾き・ドラッグ相当の入力を渡す模擬の人。--missions・--seeds）
//   --assist             9-3 の狙いの補助の強さ（弱・標準・強）× 自動射撃（OFF / ON）。方向へ倒す・カーブ 1.5 の模擬の人（--missions・--seeds）
//   --device-fix         9-5b 速度合わせの有無（練習場の動く的・M1・M2。--seeds・--only before,after）
//   --advice             9-5c 練習場の助言の当たり方（実機の記録・変更前・変更後。--seeds・--drills moving,static,bandit）
//   --tutorial           9-5c チュートリアルの通し（模擬の人・初心者役 × 6 方式 × 8 章。--seeds・--roles human,beginner）
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { runnerImport } from 'vite';

const args = process.argv.slice(2);
const flags = new Map();
const inputs = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) inputs.push(a);
  else if (
    [
      '--each',
      '--timeline',
      '--experiment',
      '--decompose',
      '--compare',
      '--assist',
      '--tilt',
      '--device-fix',
      '--presets',
      '--advice',
      '--tutorial',
    ].includes(a)
  )
    flags.set(a, true);
  else flags.set(a, args[++i]);
}
const list = (key, fallback) => (flags.get(key) ? String(flags.get(key)).split(',') : fallback);
const missions = list('--missions', ['training', 'first-sortie']);
const seeds = Number(flags.get('--seeds') ?? 4);

const { module: m } = await runnerImport('/scripts/replay-analysis/main.ts', {
  configFile: false,
  logLevel: 'error',
});

if (flags.get('--advice')) {
  // 9-5c: 練習場の助言（docs/control-analysis.md）
  console.log(m.runAdvice(seeds, (l) => console.error(l), list('--drills', ['moving'])));
} else if (flags.get('--tutorial')) {
  // 9-5c: チュートリアルの通し
  console.log(
    m.runTutorialMatrix(seeds, (l) => console.error(l), list('--roles', ['human', 'beginner'])),
  );
} else if (flags.get('--presets')) {
  // 9-5d: 補助の組ごとの練習場の動く的・M1・M2（docs/control-analysis.md）
  console.log(
    m.runPresets(
      seeds,
      (l) => console.error(l),
      list('--roles', ['human', 'beginner']),
      list('--courses', ['practice:moving', 'training', 'first-sortie']),
    ),
  );
} else if (flags.get('--device-fix')) {
  // 9-5b: 練習場の動く的・M1・M2 で速度合わせの有無（docs/control-analysis.md）
  console.log(m.runDeviceFix(seeds, (l) => console.error(l), list('--only', [])));
} else if (flags.get('--make-bots')) {
  const outDir = String(flags.get('--make-bots'));
  const files = m.makeBotReplays(missions, seeds, list('--roles', m.ROLE_IDS), (l) =>
    console.error(l),
  );
  for (const f of files) {
    const p = join(outDir, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.bytes);
  }
  console.log(`${files.length} 本を ${outDir} に書いた`);
} else if (
  flags.get('--experiment') ||
  flags.get('--decompose') ||
  flags.get('--compare') ||
  flags.get('--assist') ||
  flags.get('--tilt')
) {
  const set = flags.get('--decompose')
    ? 'decompose'
    : flags.get('--compare')
      ? 'compare'
      : flags.get('--assist')
        ? 'assist'
        : flags.get('--tilt')
          ? 'tilt'
          : 'tune';
  console.log(m.runExperiments(missions, seeds, (l) => console.error(l), list('--only', []), set));
} else {
  if (inputs.length === 0) {
    console.error(
      '使い方: npm run analyze-replay -- <.skyreplay かフォルダ> ...（docs/control-analysis.md）',
    );
    process.exit(1);
  }
  const groups = inputs.map((p) => {
    const files = statSync(p).isDirectory()
      ? readdirSync(p)
          .filter((n) => n.endsWith('.skyreplay'))
          .sort()
          .map((n) => join(p, n))
      : [p];
    return {
      label: basename(p).replace(/\.skyreplay$/, ''),
      files: files.map((f) => ({ name: basename(f), bytes: new Uint8Array(readFileSync(f)) })),
    };
  });
  const aspect = Number(flags.get('--aspect') ?? 2.16);
  console.log(
    m.analyzeGroups(groups, {
      aspect,
      each: flags.get('--each') === true,
      timeline: flags.get('--timeline') === true,
    }),
  );
}
