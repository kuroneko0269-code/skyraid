// 勲章・実績（9-10・9-10b・9-10c）: 並び（番号）と中身は src/data/badges-order.ts、型と報酬は src/data/badges-catalog.ts、
// ここは判定のしきい値（宙返り・インメルマン・低空飛行・背面飛行・最高速・エースなど）と、名前・補足・番号の表示。
// 判定は src/missions/badges/（飛行の決まった計算の中の値だけを読む。Three.js・DOM 非依存）、記録からの判定・セーブは
// src/progression/badges.ts、画面は src/ui/badge-*.ts。決定は docs/decisions.md の 9-10・9-10b・9-10c
import { BADGE_LIST } from './badges-order';
import { badgeNoteOf, badgeStepOf, badgeTitleOf } from './badges-text';
import type { BadgeDef } from './badges-catalog';

export { BADGE_GROUPS, type BadgeDef, type BadgeGroup } from './badges-catalog';

/**
 * 勲章の一覧（並びは番号の順）。id はセーブの badges.earned のキーなので変えない（足すのは可・消すと読み捨てる）。
 * 報酬は 1 回だけ（同じ勲章は 2 回取れない）なので稼ぎ場にならない
 */
export const BADGES: readonly BadgeDef[] = BADGE_LIST;

const BY_ID = new Map(BADGES.map((b) => [b.id, b]));

export function findBadge(id: string): BadgeDef | undefined {
  return BY_ID.get(id);
}

/** 同じ段の勲章（番号の順） */
export function badgeChain(def: Pick<BadgeDef, 'chain'>): BadgeDef[] {
  return BADGES.filter((b) => b.chain === def.chain);
}

/** 判定のしきい値（src/missions/badges/・src/progression/badges.ts） */
export const BADGE_CONFIG = {
  /**
   * 宙返り: 機体の上下の向きの回転（機首を上げる向き）を足し合わせて pitchDeg 以上、その間に機首がほぼ真上（前の向きの上の成分
   * noseUp 以上）・背面（上の向きの上の成分 inverted 以下）・機首が下（noseDown 以下）を通る。windowSeconds 以内に。
   * 水平の旋回（バンク 90° の引き）は機首が真上を向かないので数えない
   */
  loop: { pitchDeg: 330, noseUp: 0.8, inverted: -0.5, noseDown: -0.5, windowSeconds: 30 },
  /**
   * インメルマン: 宙返りの前半（機首を上げる回転 pitchDeg 以上・真上と背面を通る）の後、上を向いた水平（上の向きの上の成分
   * upright 以上・前の向きの上下 level 以内）に戻り、向きが始めの逆（水平の向きの内積 reverse 以下）で climbM 以上高い。windowSeconds 以内に
   */
  immelmann: {
    pitchDeg: 140,
    upright: 0.8,
    level: 0.3,
    reverse: -0.7,
    climbM: 150,
    windowSeconds: 20,
  },
  /** 低空飛行: 地表・海面から maxAglM 未満（0 より上）を minSpeed 以上で seconds 続ける */
  lowPass: { maxAglM: 30, minSpeed: 200, seconds: 8 },
  /** 背面飛行: 上の向きの上の成分 upY 以下を seconds 続ける（地表から minAglM 以上） */
  inverted: { upY: -0.8, seconds: 10, minAglM: 100 },
  /** 最高速: 速さ（m/s）。アフターバーナーの 400 では届かず、降下で加速する */
  topSpeed: 430,
  /** 9-10b: 最高速の回数は、この分（m/s）だけ下がってから超え直すと 1 回 */
  topSpeedRearm: 30,
  /** 1 ステップでこれより大きく動いたら（復帰・置き直し）操縦の判定をやり直す（m） */
  teleportM: 60,
  /** エース: 1 回の出撃（キャンペーン・レイド・防衛戦）で落とす敵機の数 */
  aceKills: 5,
  /** 機銃だけ・無傷: 数えないミッション（M1 訓練。撃たれず・ミサイルなしで終えられる） */
  easyMissions: ['training'] as readonly string[],
  /** 名射手: 練習場（日替わりは除く）の 1 回で撃墜 kills 以上・命中率 accuracy 以上 */
  sharpshooter: { kills: 10, accuracy: 0.5 },
  /** 日替わりの連続日数（3 つの勲章） */
  dailyStreak: [3, 7, 30] as readonly number[],
  /** PvP の撃墜の累計 */
  pvpKills: 25,
  /** 4 人で: 協力の人数 */
  coopPlayers: 4,
  /** 取ったお知らせに名前を並べる数（ほかは「ほか N 個」） */
  toastNames: 3,
  /** お知らせを出す秒数 */
  toastSeconds: 6,
} as const;

/** 名前（「〜した」の条件の文） */
export function badgeName(id: string): string {
  const def = findBadge(id);
  return def ? badgeTitleOf(def) : id;
}

/** 補足（数え方・対象のモードなど。無ければ空） */
export function badgeNote(id: string): string {
  const def = findBadge(id);
  return def ? badgeNoteOf(def) : '';
}

/** 同じ段の中の段の短い名前（「100」「高難度」「A 以上」） */
export function badgeStep(id: string): string {
  const def = findBadge(id);
  return def ? badgeStepOf(def) : '';
}

/** 番号の表示（No.001） */
export function badgeNumber(def: Pick<BadgeDef, 'no'>): string {
  return `No.${String(def.no).padStart(3, '0')}`;
}
