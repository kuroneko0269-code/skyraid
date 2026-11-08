// 10-7e: ヴォルガスの見た目の前後を撮る（?dev=kshot のときだけ読む遅延チャンク。遊ぶ人は読まない）。
// 撮る・測る仕組みは共通の kaiju-shot.ts。ここはヴォルガスを場面の形に置くことだけ（撮るためだけ。この飛行の結果は使わない）
import type { KaijuAi } from '../ai/kaiju-ai';
import { KAIJU_ATTACK_CONFIG, KAIJU_PARTS } from '../data/kaiju';
import {
  VORGAS_SHOTS,
  VORGAS_SHOT_BASE,
  VORGAS_SHOT_IMAGE,
  VORGAS_SHOT_SEA,
  VORGAS_SHOT_WEATHERS,
  type VorgasShotDef,
} from '../data/vorgas-shots';
import { KAIJU_CONFIG } from '../data/kaiju';
import type { Kaiju } from '../entities/kaiju';
import { derivePose, partCenter } from '../entities/kaiju-pose';
import { linkKaijuShot, type KaijuShotParts } from './kaiju-shot';

export type VorgasShotParts = Pick<
  KaijuShotParts<VorgasShotDef>,
  'camera' | 'pipeline' | 'weather' | 'game' | 'setFxClock' | 'setKaijuShown' | 'updateMs' | 'cue'
> & {
  readonly kaiju: () => Kaiju;
  readonly ai: () => KaijuAi;
};

/** 怪獣を場面の形に置く（位置・状態・攻撃・壊れた部位・倒した後） */
function arrange(k: Kaiju, ai: KaijuAi, s: VorgasShotDef): void {
  const sea = s.at === 'sea';
  const B = sea ? VORGAS_SHOT_SEA : VORGAS_SHOT_BASE;
  k.feet.x = B.x;
  k.feet.z = B.z;
  const floor = k.floorAt(B.x, B.z);
  k.feet.y = sea ? floor - KAIJU_CONFIG.height * (1 - VORGAS_SHOT_SEA.rise) : floor;
  k.heading = B.heading;
  k.stage = sea ? 'rising' : 'active';
  k.stageTime = sea ? KAIJU_CONFIG.riseSeconds * VORGAS_SHOT_SEA.rise : 30;
  k.velocity.x = k.velocity.y = k.velocity.z = 0;
  if (sea) k.velocity.y = KAIJU_CONFIG.height / KAIJU_CONFIG.riseSeconds;
  k.clearAttack();
  k.downTimer = 0;
  k.walkPhase = 0;
  k.phase = 1;
  k.flashTimer = 0;
  for (const p of k.parts) {
    p.partHp = p.maxHp;
    p.breakTimer = 0;
  }
  ai.beam.on = false;
  for (const r of ai.rocks) r.active = false;
  const walking = (pace: number) => {
    k.velocity.x = -Math.sin(k.heading) * pace;
    k.velocity.z = -Math.cos(k.heading) * pace;
  };
  if (s.attack) {
    const spec = KAIJU_ATTACK_CONFIG[s.attack.kind];
    k.attack = s.attack.kind;
    k.attackStep = s.attack.step;
    k.attackDuration = s.attack.step === 'windup' ? spec.windup : spec.active;
    k.attackTime = k.attackDuration * s.attack.k;
  }
  if (s.id === 'walk' || s.id === 'prestep') {
    // 1 歩 = 位相 1。左足は 0.5、右足は 1.5 で着く（prestep は着く直前）
    walking(6);
    k.walkPhase = s.id === 'walk' ? 1.52 : 1.3;
  } else if (s.id === 'break') {
    const crystal = k.parts[KAIJU_PARTS.indexOf('crystal')];
    if (crystal) crystal.partHp = 0;
  } else if (s.id === 'down') {
    const leg = k.parts[KAIJU_PARTS.indexOf('leftLeg')];
    if (leg) leg.partHp = 0;
    k.downTimer = KAIJU_CONFIG.down.seconds - 4;
  } else if (s.id === 'defeat') {
    k.stage = 'dead';
    k.stageTime = 4;
  }
  derivePose(k, k.pose);
  if (s.id === 'beam') {
    // 熱線: 口から斜め前の下（街の方）へ
    const h = k.heading;
    const o = partCenter({ x: 0, y: 0, z: 0 }, 'head', k.feet, h, k.pose);
    ai.beam.on = true;
    ai.beam.origin.x = o.x - Math.sin(h) * 18;
    ai.beam.origin.y = o.y - 6;
    ai.beam.origin.z = o.z - Math.cos(h) * 18;
    const dx = -Math.sin(h + 0.15);
    const dz = -Math.cos(h + 0.15);
    const dy = -0.09;
    const len = Math.hypot(dx, dy, dz);
    ai.beam.direction.x = dx / len;
    ai.beam.direction.y = dy / len;
    ai.beam.direction.z = dz / len;
    ai.beam.length = 1500;
  }
  k.finishStep();
  k.prevFeet.x = k.feet.x;
  k.prevFeet.y = k.feet.y;
  k.prevFeet.z = k.feet.z;
  k.prevHeading = k.heading;
}

export function linkVorgasShot(p: VorgasShotParts): void {
  linkKaijuShot<VorgasShotDef>({
    ...p,
    shots: VORGAS_SHOTS,
    weathers: VORGAS_SHOT_WEATHERS,
    image: VORGAS_SHOT_IMAGE,
    subject: () => {
      const k = p.kaiju();
      return {
        position: { x: k.feet.x, y: k.floorAt(k.feet.x, k.feet.z), z: k.feet.z },
        forward: { x: -Math.sin(k.heading), z: -Math.cos(k.heading) },
      };
    },
    elapsed: () => p.kaiju().time,
    where: () => {
      const k = p.kaiju();
      return { ...k.feet, heading: k.heading };
    },
    arrange: (s) => {
      arrange(p.kaiju(), p.ai(), s);
    },
    // 足が着く前・壊れる前・倒す前の形を一度描いておく（土煙・破片・崩れ落ちる演出はその瞬間に出る）
    preRoll: (s) =>
      s.id === 'walk'
        ? { ...s, id: 'prestep' }
        : s.id === 'break' || s.id === 'defeat' || s.id === 'down'
          ? { ...s, id: 'alive' }
          : null,
    settle: (s) => (s.id === 'break' ? 10 : s.id === 'walk' ? 14 : s.id === 'defeat' ? 40 : 30),
  });
}
