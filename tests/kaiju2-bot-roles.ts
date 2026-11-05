// 9-6c: ネフィルガのボットの役（kaiju2-raid-bots.ts から分けた。ソロのボットと協力のボット kaiju2-coop-bots.ts が使う）
import type { DifficultySpec } from '../src/data/ai';
import { BEGINNER_SKILL, HUMAN_SKILL } from '../scripts/replay-analysis/flight';
import { AVERAGE, VETERAN } from './ai-sim';
import { KAIJU2_CONFIG } from '../src/data/kaiju2';
import type { Vec3 } from '../src/flight/math';
import type { Kaiju2Dev } from '../src/missions/kaiju2-dev';
import { isPerching } from '../src/missions/kaiju2-raid';

export const HUMAN_GUN = { gunBurstSeconds: 2, gunPauseSeconds: 0.5 } as const;

export type Kaiju2Role = 'skilled' | 'average' | 'beginner' | 'human';

export interface RoleSpec {
  readonly skill: DifficultySpec;
  readonly weapons: number;
  /** 部位を順に壊す（false はロックした部位 = 胴を撃ち続ける） */
  readonly focus: boolean;
  /** 予兆への反応の遅れ（秒）と避ける確率 */
  readonly react: number;
  readonly dodgeChance: number;
  /** 人の手と「方向へ倒す」・狙いの補助 標準・自動射撃（タッチの初期値） */
  readonly touch: boolean;
}

export const KAIJU2_ROLES: Readonly<Record<Kaiju2Role, RoleSpec>> = {
  skilled: { skill: VETERAN, weapons: 3, focus: true, react: 0.25, dodgeChance: 1, touch: false },
  average: {
    skill: { ...AVERAGE, ...HUMAN_GUN },
    weapons: 0,
    focus: false,
    react: 0.4,
    dodgeChance: 0.5,
    touch: false,
  },
  beginner: {
    skill: BEGINNER_SKILL,
    weapons: 0,
    focus: false,
    react: 0.6,
    dodgeChance: 0.34,
    touch: false,
  },
  human: {
    skill: HUMAN_SKILL,
    weapons: 0,
    focus: false,
    react: 0.6,
    dodgeChance: 0.34,
    touch: true,
  },
};

/** 熟練が狙う順（壊れていない最初の部位。胴は最後） */
export const FOCUS = ['wingL', 'wingR', 'head', 'tail', 'body'] as const;

/** 予兆・攻撃が自分に向いているか（避ける判断）。止まり木の間は無し */
export function threatOf(dev: Kaiju2Dev, me: Readonly<Vec3>): boolean {
  const k = dev.body;
  if (isPerching(k) || k.attack === null) return false;
  const d = Math.hypot(me.x - k.position.x, me.y - k.position.y, me.z - k.position.z);
  const A = KAIJU2_CONFIG.attacks;
  switch (k.attack) {
    case 'orbs':
      return (
        k.state === 'windup' ||
        k.orbs.some(
          (o) =>
            o.active &&
            Math.hypot(o.position.x - me.x, o.position.y - me.y, o.position.z - me.z) < 900,
        )
      );
    case 'gust':
      return k.state === 'windup' && d < A.gust.pickRange + 200;
    case 'dive':
      return k.state === 'attack' && d < 1200;
    case 'tail':
      return k.state === 'windup' && d < A.tail.pickRange + 150;
  }
}
