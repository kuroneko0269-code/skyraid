// 8-2: 本番ビルドのチャンクの分け方（docs/perf.md・docs/decisions.md）。
// 起動時に読むモジュール（エントリから静的な import でたどれるもの）だけを次の組に分ける。遅延読み込み（import()）でしか
// 使わないモジュールは組に入れず、それぞれの遅延チャンクに残す（組に入れると起動時に読まれてしまう）。
//   three-core  three の本体（数学・シーン・ジオメトリ・マテリアル）。three を上げない限り中身が変わらず、デプロイをまたいでキャッシュが効く
//   three-webgl three の WebGLRenderer と examples/jsm（ポストエフェクトなど）。同上
//   game        ゲームの判定（飛行・機体・戦闘・AI・ミッション・リプレイの記録）。Three.js に依存しない層（CLAUDE.md）
//   render      描画（シーン・空・地形・海・機体のモデル・エフェクト）
//   app         画面（UI）・入力・設定・セーブ・音・データ
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

export function chunkPlan(): ChunkPlan {
  const startup = new Set<string>();
  let entry = '';
  const plugin: Plugin = {
    name: 'skyraid-chunk-plan',
    apply: 'build',
    buildEnd() {
      startup.clear();
      const ids = [...this.getModuleIds()];
      const roots = ids.filter((id) => this.getModuleInfo(id)?.isEntry === true);
      entry = roots[0] ?? '';
      const stack = [...roots];
      while (stack.length > 0) {
        const id = stack.pop();
        if (id === undefined || startup.has(id)) continue;
        startup.add(id);
        for (const next of this.getModuleInfo(id)?.importedIds ?? []) stack.push(next);
      }
    },
  };
  const groups = CHUNK_RULES.map((r, i) => ({
    name: r.name,
    priority: CHUNK_RULES.length - i,
    test: (id: string) =>
      (startup.has(id) && id !== entry && r.test.test(norm(id))) ||
      // Rolldown の実行時の補助（チャンク分けの後で足される）は app に入れる（小さなチャンクを増やさない）
      (r.name === 'app' && id.includes('rolldown/runtime')),
  }));
  return { plugin, groups };
}
