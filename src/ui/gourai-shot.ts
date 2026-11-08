// 10-7c: メカ怪獣ゴウライの見た目の前後を撮る（?dev=kshot のときだけ読む遅延チャンク。遊ぶ人は読まない）。
// 撮る・測る仕組みは共通の kaiju-shot.ts。ここはゴウライを場面の形に置くことだけ（撮るためだけ。この飛行の結果は使わない）
import {
  GOURAI_SHOTS,
  GOURAI_SHOT_BASE,
  GOURAI_SHOT_IMAGE,
  GOURAI_SHOT_WEATHERS,
  type GouraiShotDef,
} from '../data/gourai-shots';
import type { GouraiRaid } from '../missions/gourai-raid';
import { linkKaijuShot, type KaijuShotParts } from './kaiju-shot';

export type GouraiShotParts = Pick<
  KaijuShotParts<GouraiShotDef>,
  'camera' | 'pipeline' | 'weather' | 'game' | 'setFxClock' | 'setKaijuShown' | 'updateMs' | 'cue'
> & {
  readonly raid: () => GouraiRaid;
};

/** 怪獣を場面の形に置く（状態・姿勢・壊れた部位・倒した後） */
function arrange(raid: GouraiRaid, s: GouraiShotDef): void {
  const k = raid.kaiju;
  const b = k.body;
  const B = GOURAI_SHOT_BASE;
  const p = k.parts;
  b.visible = true;
  b.position.x = B.x;
  b.position.y = b.floorAt(B.x, B.z) + B.y;
  b.position.z = B.z;
  b.heading = B.heading;
  b.pitch = 0;
  b.roll = 0;
  b.speed = 0;
  b.velocity.x = b.velocity.y = b.velocity.z = 0;
  for (let i = 0; i < p.count; i++) p.partHp[i] = p.partMaxHp[i] ?? 0;
  p.hp = p.maxHp * 0.8;
  k.phase = 1;
  k.heat = 30;
  k.shots.clear();
  raid.dead = false;
  raid.deadTime = 0;
  raid.landedTime = -1;
  raid.flash = 0;
  k.action = 'idle';
  k.attack = null;
  k.actionTime = 0;
  k.sweepPitch = 0;
  k.sweepSide = 1;
  k.sweepRange = 700;
  Object.assign(
    b.pose,
    { armorOpen: 0, hatch: 0, gunGlow: 0, exhaust: 0.3, purge: 0, spin: 0 },
    s.pose,
  );
  if (s.id === 'volley') {
    k.action = 'windup';
    k.attack = 'volley';
    k.actionTime = 1.4;
  } else if (s.id === 'sweep') {
    k.action = 'windup';
    k.attack = 'sweep';
    k.actionTime = 1.2;
    b.pose.spin = 20;
  } else if (s.id === 'vent') {
    k.action = 'vent';
    k.actionTime = 2;
    k.heat = 100;
  } else if (s.id === 'purge') {
    k.phase = 2;
    k.action = 'purge';
    k.actionTime = 1.3;
    p.hp = p.maxHp * 0.38;
  } else if (s.id === 'break') {
    p.partHp[p.indexOf('gunR')] = 0;
  } else if (s.id === 'falling' || s.id === 'defeat') {
    raid.dead = true;
    raid.deadTime = s.id === 'falling' ? 0.4 : 1.6;
    p.hp = 0;
    b.pose.exhaust = 0.2;
    b.roll = s.id === 'falling' ? 0.05 : 0.2;
    b.pitch = s.id === 'falling' ? 0.03 : 0.12;
    b.position.y -= s.id === 'falling' ? 2 : 22;
  }
  b.prevPosition.x = b.position.x;
  b.prevPosition.y = b.position.y;
  b.prevPosition.z = b.position.z;
  b.prevHeading = b.heading;
}

export function linkGouraiShot(p: GouraiShotParts): void {
  linkKaijuShot<GouraiShotDef>({
    ...p,
    shots: GOURAI_SHOTS,
    weathers: GOURAI_SHOT_WEATHERS,
    image: GOURAI_SHOT_IMAGE,
    subject: () => {
      const b = p.raid().kaiju.body;
      return {
        position: b.position,
        forward: { x: -Math.sin(b.heading), z: -Math.cos(b.heading) },
      };
    },
    elapsed: () => p.raid().elapsed,
    where: () => {
      const b = p.raid().kaiju.body;
      return { ...b.position, heading: b.heading };
    },
    arrange: (s) => {
      arrange(p.raid(), s);
    },
    // 壊れる前・倒す前の形を一度描いておく（破片・爆発の演出はその瞬間に出る）
    preRoll: (s) =>
      s.id === 'break' ? { ...s, id: 'orbit' } : s.id === 'defeat' ? { ...s, id: 'falling' } : null,
    // 動き（油圧の順の構え・放熱板）が落ち着くまで
    settle: (s) => (s.id === 'break' ? 12 : s.id === 'defeat' ? 40 : 36),
  });
}
