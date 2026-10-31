// 協力レイドのリザルト（6-6。Three.js・DOM 非依存）: 最後の成績（ホストの score）と終わりの知らせ（over）から、
// 全員の部位別の与ダメージ・ブレイク回数・復帰回数・MVP（与ダメージ最多。同じならブレイクの多い方 → ID の小さい方）・
// クリア時間・守れた建物 %・報酬（全員同じ）を作る。全員が同じ入力から同じ結果になる
import type { RaidDifficulty } from '../data/raid';
import { raidReward } from '../progression/raid-reward';
import type { ScoreEntry } from './protocol';

export interface RaidResultRow {
  readonly id: number;
  /** 部位別の与ダメージ（KAIJU_PARTS の順） */
  readonly partDamage: readonly number[];
  readonly total: number;
  readonly breaks: number;
  /** 復帰回数（= 撃墜された回数） */
  readonly respawns: number;
}

export interface RaidSummary {
  readonly cleared: boolean;
  readonly difficulty: RaidDifficulty;
  /** クリア（終わり）までの秒数（カウントダウンの後から） */
  readonly seconds: number;
  readonly protectedBuildings: number | null;
  readonly rows: readonly RaidResultRow[];
  /** 与ダメージ最多の人（誰も与えていなければ null） */
  readonly mvp: number | null;
  /** 全員に同じ額 */
  readonly credits: number;
}

export function raidSummary(
  players: readonly Readonly<ScoreEntry>[],
  o: {
    readonly cleared: boolean;
    readonly difficulty: RaidDifficulty;
    readonly seconds: number;
    readonly protectedBuildings: number | null;
  },
): RaidSummary {
  const rows = [...players]
    .sort((a, b) => a.id - b.id)
    .map((p) => ({
      id: p.id,
      partDamage: [...p.partDamage],
      total: p.partDamage.reduce((s, v) => s + v, 0),
      breaks: p.breaks,
      respawns: p.deaths,
    }));
  let mvp: RaidResultRow | null = null;
  for (const r of rows) {
    if (r.total <= 0) continue;
    if (!mvp || r.total > mvp.total || (r.total === mvp.total && r.breaks > mvp.breaks)) mvp = r;
  }
  return {
    ...o,
    rows,
    mvp: mvp?.id ?? null,
    credits: raidReward({ coop: true, ...o }),
  };
}
