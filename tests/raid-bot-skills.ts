// レイドのボット（tests/kaiju-raid-bots.ts）の入出力と腕前（8-6 で分けた）。average = 6-1 からの平均的なボット、skilled = 慣れた人の遊び方
// （減速して長く撃ち、脚から順に壊してダウンを取る。8-6 の調整の前は 1 人で約 1.1 分で、実機の「1〜2 分」と合う）
import type { KaijuPartId } from '../src/data/kaiju';
import { GUN_CONFIG } from '../src/data/weapons';

export interface RaidBotOptions {
  readonly players: number;
  readonly seed: number;
  /** 機銃の命中率（平均的 0.3） */
  readonly hitRate?: number;
  /** 打ち切り（秒） */
  readonly maxSeconds?: number;
  /**
   * 腕前（8-6）。average = 6-1 からの平均的なボット（上の説明のまま）。skilled = 慣れた人の遊び方: 機銃 60%・ミサイル 90%・
   * 武装 Lv3（機銃のダメージ +30%・ミサイル +3）・ダウンを狙って脚から順に撃ち（脚 → 結晶 → 頭 → 尾）、進入は 150 m/s・
   * 旋回 40°/秒で 120〜1500m で撃ち、180m で離脱して 600〜900m 先からすぐ入り直す・予兆への反応は 0.2 秒
   */
  readonly skill?: RaidBotSkill;
  /** 高難度（8-6 の計測用） */
  readonly hard?: boolean;
  /** 9-6d: 残機（1 人ずつ。撃墜がこの数になった機は戻らない。全員が使い切ったら失敗）。省略は無制限（9-6d の前） */
  readonly lives?: number;
  /**
   * 10-6: 体への衝突（最大 HP の約 8 割・1.5 秒は続けて当たらない。src/missions/vorgas-ram.ts と同じ形）。on（既定）= 今の判定、
   * count = 衝突を入れる前の判定（当たらず、通り抜けた回数だけ数える。変更前の表）
   */
  readonly ram?: 'on' | 'count';
}

export interface RaidBotResult {
  readonly seconds: number;
  readonly killed: boolean;
  readonly cityReached: boolean;
  readonly downs: number;
  readonly breaks: number;
  readonly partsBroken: number;
  readonly playerDowns: number;
  /** 9-6d: 全員が残機を使い切って失敗した */
  readonly livesOut: boolean;
  /** 最終フェーズに入った時刻（入らなければ null） */
  readonly finalAt: number | null;
  readonly attacks: Readonly<Record<string, number>>;
  /** 10-6: 体への衝突の回数（全員。count なら通り抜けた回数）と、衝突で撃墜された回数 */
  readonly ramHits: number;
  readonly ramDowns: number;
}

export type RaidBotSkill = 'average' | 'skilled';

export interface SkillSpec {
  readonly hitRate: number;
  readonly missileHitRate: number;
  readonly weaponsLevel: number;
  readonly focus: boolean;
  readonly outRange: readonly [number, number];
  readonly react: number;
  /** 攻撃の進入の速さ（m/s）・旋回（°/秒）・撃つ距離（m）・離脱する水平距離（m） */
  readonly attackSpeed: number;
  readonly turnDeg: number;
  readonly fireRange: readonly [number, number];
  readonly breakOff: number;
}

export const SKILLS: Readonly<Record<RaidBotSkill, SkillSpec>> = {
  average: {
    hitRate: 0.3,
    missileHitRate: 0.75,
    weaponsLevel: 0,
    focus: false,
    outRange: [1200, 1800],
    react: 0.3,
    attackSpeed: 230,
    turnDeg: 30,
    fireRange: [200, GUN_CONFIG.range * 0.75],
    breakOff: 350,
  },
  skilled: {
    hitRate: 0.6,
    missileHitRate: 0.9,
    weaponsLevel: 3,
    focus: true,
    outRange: [600, 900],
    react: 0.2,
    attackSpeed: 150,
    turnDeg: 40,
    fireRange: [120, GUN_CONFIG.range],
    breakOff: 180,
  },
};

/** 慣れた人が狙う順（壊れていない最初の部位） */
export const FOCUS_ORDER: readonly KaijuPartId[] = [
  'leftLeg',
  'rightLeg',
  'crystal',
  'head',
  'tail',
];
