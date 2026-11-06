// 8-2: 本番ビルドのチャンクの分け方（docs/perf.md・docs/decisions.md）。
// 起動時に読むモジュール（エントリから静的な import でたどれるもの）だけを次の組に分ける。遅延読み込み（import()）でしか
// 使わないモジュールは組に入れず、それぞれの遅延チャンクに残す（組に入れると起動時に読まれてしまう）。
//   three-core  three の本体（数学・シーン・ジオメトリ・マテリアル）。three を上げない限り中身が変わらず、デプロイをまたいでキャッシュが効く
//   three-webgl three の WebGLRenderer と examples/jsm（ポストエフェクトなど）。同上
//   game        ゲームの判定（飛行・機体・戦闘・AI・ミッション・リプレイの記録）。Three.js に依存しない層（CLAUDE.md）
//   render      描画（シーン・空・地形・海・機体のモデル・エフェクト）
//   app         画面（UI）・入力・設定・セーブ・音・データ
// 10-1: ゲーム本体（src/game-app.ts。タイトルの後に import() で読む）から静的にたどれるモジュール（起動時のものを除く）も同じ考えで
// play-logic（判定）・play-render（描画）・play-ui（画面・音・データと本体の CSS 全部）に分ける。1 つにすると 500KB を超え、
// 分けないと PvP などの遅延チャンクと共有するモジュールが細かく切り出される
// 組に分けないと、Rolldown は起動時のモジュールと遅延チャンクが共有するモジュールを小さな共通チャンク（CSS も）に
// 細かく切り出す（要求が増え、CSS の並びも変わる）。組に入れると起動時の CSS は app の 1 つにまとまる
import type { Plugin } from 'vite';

type GroupTest = (id: string) => boolean;

export interface ChunkPlan {
  /** エントリから静的にたどれるモジュールを集めるプラグイン（buildEnd で集める。チャンク分けより前） */
  readonly plugin: Plugin;
  /** output.codeSplitting.groups に渡す組（優先度の高い順） */
  readonly groups: { name: string; test: GroupTest; priority: number }[];
}

const norm = (id: string): string => id.replace(/\\/g, '/');

/** ゲーム本体の入口（10-1。app.ts が import() で読む） */
export const PLAY_ENTRY = /\/src\/game-app\.ts$/;

/** ゲーム本体の組（10-1。起動時の組と同じ並び。本体の CSS は play-ui の 1 つに） */
export const PLAY_RULES: readonly { name: string; test: RegExp }[] = [
  { name: 'play-ui', test: /\.css$/ },
  { name: 'play-logic', test: /\/src\/(entities|flight|combat|ai|missions|replay)\// },
  { name: 'play-render', test: /\/src\/render\/|\/node_modules\/three\// },
  { name: 'play-ui', test: /./ },
];

/** 組の判定（静的にたどれるモジュールだけ。起動時に読まないものは組に入れない）。上から順に優先 */
export const CHUNK_RULES: readonly { name: string; test: RegExp }[] = [
  // 起動時の CSS は並びを変えないよう全部 app に（1 ファイル）
  { name: 'app', test: /\.css$/ },
  { name: 'three-core', test: /\/node_modules\/three\/build\/three\.core\.js$/ },
  { name: 'three-webgl', test: /\/node_modules\/three\// },
  { name: 'game', test: /\/src\/(entities|flight|combat|ai|missions|replay)\// },
  { name: 'render', test: /\/src\/render\// },
  { name: 'app', test: /./ },
];

/** roots から静的な import でたどれるモジュール（skip に入っているものは除き、その先もたどらない） */
function staticClosure(
  roots: readonly string[],
  info: (id: string) => { importedIds: readonly string[] } | null,
  skip: ReadonlySet<string>,
): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id) || skip.has(id)) continue;
    seen.add(id);
    for (const next of info(id)?.importedIds ?? []) stack.push(next);
  }
  return seen;
}

export function chunkPlan(): ChunkPlan {
  let startup = new Set<string>();
  let play = new Set<string>();
  let entry = '';
  let playEntry = '';
  const plugin: Plugin = {
    name: 'skyraid-chunk-plan',
    apply: 'build',
    buildEnd() {
      const ids = [...this.getModuleIds()];
      const info = (id: string) => this.getModuleInfo(id);
      const roots = ids.filter((id) => info(id)?.isEntry === true);
      entry = roots[0] ?? '';
      startup = staticClosure(roots, info, new Set());
      playEntry = ids.find((id) => PLAY_ENTRY.test(norm(id))) ?? '';
      play = playEntry ? staticClosure([playEntry], info, startup) : new Set();
    },
  };
  const rule = (
    r: { name: string; test: RegExp },
    i: number,
    all: number,
    set: () => ReadonlySet<string>,
    own: () => string,
  ) => ({
    name: r.name,
    priority: all - i,
    test: (id: string) =>
      (set().has(id) && id !== own() && r.test.test(norm(id))) ||
      // Rolldown の実行時の補助（チャンク分けの後で足される）は app に入れる（小さなチャンクを増やさない）
      (r.name === 'app' && id.includes('rolldown/runtime')),
  });
  const all = CHUNK_RULES.length + PLAY_RULES.length;
  const groups = [
    ...CHUNK_RULES.map((r, i) =>
      rule(
        r,
        i,
        all,
        () => startup,
        () => entry,
      ),
    ),
    ...PLAY_RULES.map((r, i) =>
      rule(
        r,
        CHUNK_RULES.length + i,
        all,
        () => play,
        () => playEntry,
      ),
    ),
  ];
  return { plugin, groups };
}
