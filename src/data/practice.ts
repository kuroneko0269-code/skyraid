// 練習場（9-5）の数値: 課題 3 つ（止まった的・動く的・模擬の敵）の時間・開始位置・出し方、スコアの式、結果の助言の閾値、記録の数。
// 進行は src/missions/practice/（Three.js 非依存）、画面は src/ui/practice-*.ts。決定は docs/decisions.md の 9-5
import { t } from '../core/i18n';
import type { Pose } from '../missions/types';
import { ISLAND_PATROL } from './missions';

export const PRACTICE_DRILLS = ['static', 'moving', 'bandit'] as const;
export type PracticeDrill = (typeof PRACTICE_DRILLS)[number];

/** 動く的（ドローン）の経路: from から heading の向きへ length m を一定の速さで進み、端で from へ戻る（撃墜でなく抜けた扱い） */
export interface DronePathDef {
  readonly from: { readonly x: number; readonly y: number; readonly z: number };
  /** 進む向き（-Z から右回り、度） */
  readonly headingDeg: number;
  readonly length: number;
  /** 進む速さ（m/s） */
  readonly speed: number;
  /** 左右の蛇行（振幅 m・周期 秒）。省略は直進 */
  readonly weave?: { readonly amplitude: number; readonly period: number };
  /** 上下の揺れ（振幅 m・周期 秒）。省略は水平 */
  readonly bob?: { readonly amplitude: number; readonly period: number };
  /** 撃墜から経路の始めへ出直すまでの秒数 */
  readonly respawnSeconds: number;
}

export const PRACTICE_CONFIG = {
  /** 始める前の数え（秒）。この間は開始位置に止め、機銃は撃てない（レースと同じ） */
  countdownSeconds: 3,
  /** 時間切れから結果の画面までの秒数（大きな文字を見せる） */
  resultDelaySeconds: 1.5,
  /** 1 回の長さ（秒）。的が多い順に短く、追いかける模擬の敵は長め */
  durations: { static: 60, moving: 75, bandit: 90 } satisfies Record<PracticeDrill, number>,
  /**
   * 開始位置（島の南の沖から北向き）。止まった的は data/targets.ts の的（島の上空 10 個・撃墜から 10 秒で別の地点へ）、
   * 動く的は下の 3 本の経路の前、模擬の敵は前方に 1 機
   */
  starts: {
    static: { x: 0, y: 600, z: 4200, headingDeg: 0 },
    moving: { x: 0, y: 850, z: 5200, headingDeg: 0 },
    bandit: { x: 0, y: 900, z: 4400, headingDeg: 0 },
  } satisfies Record<PracticeDrill, Pose>,
  /**
   * 動く的の経路（ドローン 3 機。直進・蛇行・上下）。島の山（最高 約 600m）より上。どれも 110 m/s（周回ドローンは 120）で、
   * 開始位置から北へ 2.7〜4.7km の所を東西に横切る
   */
  dronePaths: [
    {
      from: { x: -2500, y: 850, z: 2500 },
      headingDeg: 90,
      length: 5000,
      speed: 110,
      respawnSeconds: 3,
    },
    {
      from: { x: 2500, y: 850, z: 1500 },
      headingDeg: 270,
      length: 5000,
      speed: 110,
      weave: { amplitude: 180, period: 8 },
      respawnSeconds: 3,
    },
    {
      from: { x: -2500, y: 950, z: 500 },
      headingDeg: 90,
      length: 5000,
      speed: 110,
      bob: { amplitude: 150, period: 6 },
      respawnSeconds: 3,
    },
  ] satisfies readonly DronePathDef[],
  /**
   * 模擬の敵: rookie（M1 と同じ HP ×0.6）で撃ち返さない（機銃・ミサイルなし。飛び方は rookie のまま）。いつも 1 機で、
   * 落とすと respawnSeconds 後に自機の前方 ahead m・左右 sides の順・高さは自機（minAltitude〜maxAltitude）に出る
   */
  bandit: {
    difficulty: 'rookie',
    hpScale: 0.6,
    respawnSeconds: 3,
    ahead: 1800,
    sides: [0, -500, 500],
    /** 出たときの向き（自機の機首方位からの差、度） */
    headings: [0, 40, -40],
    minAltitude: 700,
    maxAltitude: 1600,
    patrol: ISLAND_PATROL,
  },
  /** スコア = 撃墜 × (perKill + 命中率（%）)。当てて落とすほど高い（撃ちまくっても命中率が下がる） */
  score: { perKill: 100 },
  /**
   * 結果の一言の助言（上から順に最初に当てはまったもの）。照準の外で撃った割合・画面の外の割合・行き過ぎ（1 分あたり）。
   * 9-1 の実機（照準の外 99.9%・画面の外 36.5%・行き過ぎ 73 回 / 分）とボット（27% が照準の中・31%・44 回）の間に置いた
   */
  advice: {
    minShotsForAccuracy: 30,
    offAim: 0.6,
    offScreen: 0.45,
    overshootPerMinute: 40,
  },
  /** 失敗したら結果の画面に練習場への案内を出すミッション（M1・M2。チュートリアルの完了でも出す） */
  guideMissions: ['training', 'first-sortie'],
  /** 記録: 課題ごとに設定の組み合わせ（入力系統・方式・補助・自動射撃・カーブ）ごとの最高を最大 maxEntries 個 */
  maxEntries: 12,
  /** 練習場の画面に出す、設定ごとの記録の行数 */
  listRows: 5,
  /** 指標の画面の外の判定に使う縦横比の範囲（ヘッダに入れる。おかしな値はこの範囲に丸める） */
  aspectRange: { min: 1, max: 3, fallback: 16 / 9 },
} as const;

/** 課題の名前と説明（表の practice.drills.<id>） */
export const PRACTICE_DRILL_LABELS: Readonly<
  Record<PracticeDrill, { name: string; note: string }>
> = {
  get static() {
    return { name: t('practice.drills.static.name'), note: t('practice.drills.static.note') };
  },
  get moving() {
    return { name: t('practice.drills.moving.name'), note: t('practice.drills.moving.note') };
  },
  get bandit() {
    return { name: t('practice.drills.bandit.name'), note: t('practice.drills.bandit.note') };
  },
};

export function isPracticeDrill(v: unknown): v is PracticeDrill {
  return typeof v === 'string' && (PRACTICE_DRILLS as readonly string[]).includes(v);
}
