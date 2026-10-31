// 防衛戦（7-2）の波の構成（データ駆動）。人数・難易度の倍率を掛ける前の数（ソロ・通常の数）。
// 1〜3 波は easy、4〜7 波は normal、8〜10 波は normal と hard の混在。難易度は戦闘機（護衛を含む）の AI だけに効く。
// delay は波の始まりからその組が出るまでの秒数。escort は爆撃機の組に付く護衛の戦闘機の数（爆撃機の横に出て同じ道を行く）
import type { Difficulty } from './ai';

export const DEFENSE_ENEMY_KINDS = ['fighter', 'bomber', 'cruise'] as const;
export type DefenseEnemyKind = (typeof DEFENSE_ENEMY_KINDS)[number];

export interface DefenseGroupDef {
  readonly kind: DefenseEnemyKind;
  readonly count: number;
  /** 戦闘機・護衛の難易度 */
  readonly difficulty: Difficulty;
  /** 爆撃機の組の護衛の戦闘機の数 */
  readonly escort?: number;
  /** 波の始まりから出るまでの秒数（省略は 0） */
  readonly delay?: number;
}

export interface DefenseWaveDef {
  readonly groups: readonly DefenseGroupDef[];
}

export const DEFENSE_WAVES: readonly DefenseWaveDef[] = [
  // 1〜3: easy
  { groups: [{ kind: 'fighter', count: 2, difficulty: 'easy' }] },
  {
    groups: [
      { kind: 'fighter', count: 2, difficulty: 'easy' },
      { kind: 'cruise', count: 1, difficulty: 'easy', delay: 8 },
    ],
  },
  {
    groups: [
      { kind: 'fighter', count: 1, difficulty: 'easy' },
      { kind: 'bomber', count: 1, difficulty: 'easy', escort: 1, delay: 4 },
      { kind: 'cruise', count: 1, difficulty: 'easy', delay: 14 },
    ],
  },
  // 4〜7: normal
  {
    groups: [
      { kind: 'fighter', count: 3, difficulty: 'normal' },
      { kind: 'cruise', count: 2, difficulty: 'normal', delay: 10 },
    ],
  },
  {
    groups: [
      { kind: 'bomber', count: 2, difficulty: 'normal', escort: 2 },
      { kind: 'cruise', count: 1, difficulty: 'normal', delay: 12 },
    ],
  },
  {
    groups: [
      { kind: 'fighter', count: 2, difficulty: 'normal' },
      { kind: 'bomber', count: 1, difficulty: 'normal', escort: 1, delay: 6 },
      { kind: 'cruise', count: 2, difficulty: 'normal', delay: 16 },
    ],
  },
  {
    groups: [
      { kind: 'fighter', count: 2, difficulty: 'normal' },
      { kind: 'bomber', count: 2, difficulty: 'normal', escort: 2, delay: 6 },
      { kind: 'cruise', count: 2, difficulty: 'normal', delay: 18 },
    ],
  },
  // 8〜10: normal と hard の混在
  {
    groups: [
      { kind: 'fighter', count: 2, difficulty: 'normal' },
      { kind: 'fighter', count: 1, difficulty: 'hard' },
      { kind: 'cruise', count: 3, difficulty: 'normal', delay: 10 },
    ],
  },
  {
    groups: [
      { kind: 'fighter', count: 2, difficulty: 'hard' },
      { kind: 'bomber', count: 2, difficulty: 'normal', escort: 2, delay: 6 },
      { kind: 'cruise', count: 2, difficulty: 'normal', delay: 20 },
    ],
  },
  {
    groups: [
      { kind: 'fighter', count: 2, difficulty: 'normal' },
      { kind: 'fighter', count: 2, difficulty: 'hard' },
      { kind: 'bomber', count: 2, difficulty: 'hard', escort: 2, delay: 8 },
      { kind: 'cruise', count: 2, difficulty: 'normal', delay: 20 },
    ],
  },
];
