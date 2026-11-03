/* global console, process */
// 時間の計測（8-1 の事前修正）: `npm run bench`。テスト（vitest）からは時間の判定を外し、ここで単独に測る。
// TypeScript の計測（scripts/bench-*.ts）は Vite のモジュールランナーで読み込む（追加のパッケージなし）。
// 上限を超えたものがあれば終了コード 1
import { runnerImport } from 'vite';

const { module } = await runnerImport('/scripts/bench-skins.ts', {
  configFile: false,
  logLevel: 'error',
});
// v1.0.1: 地形の浸食（tests/terrain-gen.test.ts から移した）
const { module: terrain } = await runnerImport('/scripts/bench-terrain.ts', {
  configFile: false,
  logLevel: 'error',
});
const results = [module.benchSkins(), terrain.benchTerrain()];
let failed = false;
for (const r of results) {
  const ok = r.worstMs < r.limitMs;
  if (!ok) failed = true;
  console.log(
    `${ok ? 'OK ' : 'NG '} ${r.name}: ${r.worstMs.toFixed(1)}ms（上限 ${r.limitMs}ms）${r.detail}`,
  );
}
process.exit(failed ? 1 : 0);
