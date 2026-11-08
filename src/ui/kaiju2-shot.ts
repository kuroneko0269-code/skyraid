// 10-7a: ネフィルガの見た目の試作の前後を撮る（?dev=kshot のときだけ読む遅延チャンク。遊ぶ人は読まない）。
// scripts/kaiju-visual-pilot.js がソロのレイドに出てから window.__kshot.shoot(<場面>, <天候>) を呼ぶ: 止めて、怪獣の状態を
// 場面の形に置き（撮るためだけ。この飛行の結果は使わない）、決まった構図のカメラで描く。
// 10-7b: 撮る・測る仕組みは共通の kaiju-shot.ts。ここはネフィルガを場面の形に置くことだけ
import { forcePerch } from '../ai/kaiju2-perch';
import {
  KAIJU2_SHOTS,
  KAIJU2_SHOT_BASE,
  KAIJU2_SHOT_IMAGE,
  KAIJU2_SHOT_WEATHERS,
  type Kaiju2ShotDef,
} from '../data/kaiju2-shots';
import { updateKaiju2Pose } from '../entities/kaiju2/kaiju2-pose';
import type { Kaiju2Raid } from '../missions/kaiju2-raid';
import { linkKaijuShot, type KaijuShotParts } from './kaiju-shot';

export type Kaiju2ShotParts = Pick<
  KaijuShotParts<Kaiju2ShotDef>,
  'camera' | 'pipeline' | 'weather' | 'game' | 'setFxClock' | 'setKaijuShown' | 'updateMs' | 'cue'
> & {
  readonly raid: () => Kaiju2Raid;
};

interface Base {
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
}

/** 怪獣を場面の形に置く（状態・姿勢・壊れた部位・倒した後） */
function arrange(raid: Kaiju2Raid, base: Base, s: Kaiju2ShotDef): void {
  const k = raid.body;
  k.position.x = base.x;
  k.position.y = base.y;
  k.position.z = base.z;
  k.forward.x = base.fx;
  k.forward.y = 0;
  k.forward.z = base.fz;
  for (const key of ['wingL', 'wingR', 'head', 'tail'] as const) k.broken[key] = false;
  k.flinch = 0;
  raid.dead = false;
  raid.deadTime = 0;
  raid.flash = 0;
  for (const o of k.orbs) o.active = false;
  k.setHpRatio(s.id === 'defeat' ? 0 : s.id === 'break' ? 0.55 : 1);
  if (s.id === 'orbs') {
    k.setState('windup', 'orbs');
  } else if (s.id === 'perch') {
    // 降りる場所の乱数を決まった種に（判定の乱数の状態によらず同じ場所）
    k.random.reseed(KAIJU2_SHOT_BASE.perchSeed);
    if (forcePerch(k)) {
      k.position.x = k.perch.x;
      k.position.y = k.perch.y;
      k.position.z = k.perch.z;
    }
    k.setState('perched', null);
  } else {
    k.setState('cruise', null);
  }
  // 姿勢の値を 3 秒ぶん寄せる（判定は進めない）
  for (let i = 0; i < 180; i++) updateKaiju2Pose(k, 1 / 60);
  if (s.id === 'orbs') k.stateTime = 1.4;
  if (s.id === 'defeat') {
    raid.dead = true;
    raid.deadTime = 1.6;
    Object.assign(k.pose, { wingFold: 0.75, flapAmount: 0, neckPitch: -0.7, throatGlow: 0 });
    const down = 0.6;
    k.forward.x = base.fx * Math.cos(down);
    k.forward.z = base.fz * Math.cos(down);
    k.forward.y = -Math.sin(down);
  }
  if (s.id === 'break') Object.assign(k.pose, { flapAmount: 0.3, neckPitch: -0.4 });
  k.pose.flapPhase = s.flapPhase;
  k.bank = k.prevBank = s.bank;
  k.beginStep();
}

export function linkKaiju2Shot(p: Kaiju2ShotParts): void {
  const b = KAIJU2_SHOT_BASE;
  // 決まった位置と向き（撮るたびに同じ背景）
  const base: Base = { x: b.x, y: b.y, z: b.z, fx: Math.sin(b.heading), fz: -Math.cos(b.heading) };
  linkKaijuShot<Kaiju2ShotDef>({
    ...p,
    shots: KAIJU2_SHOTS,
    weathers: KAIJU2_SHOT_WEATHERS,
    image: KAIJU2_SHOT_IMAGE,
    subject: () => p.raid().body,
    elapsed: () => p.raid().elapsed,
    where: () => {
      const k = p.raid().body;
      return { ...k.position, heading: Math.atan2(k.forward.x, -k.forward.z) };
    },
    arrange: (s) => {
      arrange(p.raid(), base, s);
    },
    // 壊れる前の形を一度描いてから壊す（破片の演出は壊れた瞬間に出る）
    preRoll: (s) => (s.id === 'break' ? { ...s, id: 'orbit' } : null),
    // 天候・影・粒が落ち着くまで描く（破片は 0.5 秒ぶん飛ぶ）
    settle: (s) => (s.id === 'break' ? 15 : 24),
  });
}
