// 10-7d: UFO ゼノリスの見た目の前後を撮る（?dev=kshot のときだけ読む遅延チャンク。遊ぶ人は読まない）。
// 撮る・測る仕組みは共通の kaiju-shot.ts。ここはゼノリスを場面の形に置くことだけ（撮るためだけ。この飛行の結果は使わない）
import { beamMouth, fireOrbs } from '../ai/xenolith-attacks';
import { XENOLITH_CONFIG, XENOLITH_SWEEP } from '../data/xenolith';
import {
  XENOLITH_SHOTS,
  XENOLITH_SHOT_BASE,
  XENOLITH_SHOT_IMAGE,
  XENOLITH_SHOT_WEATHERS,
  type XenolithShotDef,
} from '../data/xenolith-shots';
import type { XenolithRaid } from '../missions/xenolith-raid';
import { linkKaijuShot, type KaijuShotParts } from './kaiju-shot';
import { bodyDirection } from '../ai/raid-kit/frame';

export type XenolithShotParts = Pick<
  KaijuShotParts<XenolithShotDef>,
  'camera' | 'pipeline' | 'weather' | 'game' | 'setFxClock' | 'setKaijuShown' | 'updateMs' | 'cue'
> & {
  readonly raid: () => XenolithRaid;
};

const tmp = { x: 0, y: 0, z: 0 };

/** 怪獣を場面の形に置く（状態・光線・バリア・瞬間移動・光の弾・壊れた部位・倒した後） */
function arrange(raid: XenolithRaid, s: XenolithShotDef): void {
  const k = raid.kaiju;
  const b = k.body;
  const B = XENOLITH_SHOT_BASE;
  const p = k.parts;
  b.visible = true;
  b.position.x = B.x;
  b.position.y = b.floorAt(B.x, B.z) + B.y;
  b.position.z = B.z;
  b.heading = B.heading;
  b.pitch = 0;
  b.roll = 0;
  b.spin = 0.6;
  b.prevSpin = 0.6;
  b.ringDeg = 20;
  b.move = 'cruise';
  b.moveTime = 0;
  b.velocity.x = b.velocity.y = b.velocity.z = 0;
  b.warped = false;
  for (let i = 0; i < p.count; i++) p.partHp[i] = p.partMaxHp[i] ?? 0;
  p.hp = p.maxHp * 0.8;
  k.stage = 1;
  k.beam.cancel();
  k.attack = null;
  k.barrier.phase = 'up';
  k.barrier.time = 0;
  k.warp.phase = 'idle';
  k.warp.time = 0;
  k.clearOrbs();
  k.orbPhase = 'idle';
  k.orbTime = 0;
  k.rippleSphere = -1;
  k.rippleAge = 99;
  raid.dead = false;
  raid.deadTime = 0;
  raid.landedTime = -1;
  raid.flash = 0;
  // 右の向き（体の向きから）
  const rx = Math.cos(b.heading);
  const rz = -Math.sin(b.heading);
  if (s.id === 'dash') {
    // 右から左へ急加速（後ろへ尾が伸びる）
    b.move = 'dash';
    b.moveTime = 0.5;
    b.velocity.x = -rx * XENOLITH_CONFIG.move.dash;
    b.velocity.z = -rz * XENOLITH_CONFIG.move.dash;
    b.roll = 0.12;
  } else if (s.id === 'barrier') {
    // 前の右の輪の球に当たった波紋
    k.rippleSphere = 2;
    k.rippleAge = 0.25;
  } else if (s.id === 'warp') {
    k.warp.phase = 'telegraph';
    k.warp.time = 0.85;
    b.point(tmp, { forward: 0, right: 420, up: 30 });
    k.warp.destination.x = tmp.x;
    k.warp.destination.y = tmp.y;
    k.warp.destination.z = tmp.z;
  } else if (s.id === 'sweep') {
    k.beam.startSweep(-60, 60, -6);
    k.beam.phase = 'fire';
    k.beam.time = XENOLITH_SWEEP.fire * 0.4;
    k.beam.yawDeg = -60 + 120 * 0.4;
    k.attack = 'sweep';
    k.barrier.phase = 'down';
    b.move = 'hold';
  } else if (s.id === 'charged') {
    k.beam.startCharged(0);
    k.beam.phase = 'charge';
    k.beam.time = 0.9;
    k.beam.yawDeg = 18;
    k.beam.pitchDeg = -14;
    k.attack = 'charged';
    k.barrier.phase = 'flicker';
    k.barrier.time = 0.3;
    b.move = 'hold';
  } else if (s.id === 'orbs') {
    // 撃ったばかりの格子（0.35 秒進めた所）と、次の予兆の縁の光
    b.point(tmp, { forward: 1400, right: 0, up: -40 });
    fireOrbs(k, { position: { ...tmp }, active: true, id: 0 });
    for (const sh of k.orbs.shots) {
      if (!sh.active) continue;
      sh.position.x += sh.velocity.x * 0.35;
      sh.position.y += sh.velocity.y * 0.35;
      sh.position.z += sh.velocity.z * 0.35;
    }
    k.orbPhase = 'warn';
    k.orbTime = XENOLITH_CONFIG.orbs.warn * 0.6;
  } else if (s.id === 'break') {
    p.partHp[p.indexOf('emitter1')] = 0;
  } else if (s.id === 'falling' || s.id === 'defeat') {
    raid.dead = true;
    raid.deadTime = s.id === 'falling' ? 0.2 : 1.4;
    k.barrier.phase = 'down';
    p.hp = 0;
    b.roll = s.id === 'falling' ? 0.05 : 0.35;
    b.pitch = s.id === 'falling' ? 0.02 : 0.12;
    b.position.y -= s.id === 'falling' ? 2 : 30;
  }
  if (k.beam.busy) {
    beamMouth(k.beam.origin, k);
    bodyDirection(k.beam.direction, b, k.beam.yawDeg, k.beam.pitchDeg);
  }
  b.prevPosition.x = b.position.x;
  b.prevPosition.y = b.position.y;
  b.prevPosition.z = b.position.z;
  b.prevHeading = b.heading;
}

export function linkXenolithShot(p: XenolithShotParts): void {
  linkKaijuShot<XenolithShotDef>({
    ...p,
    shots: XENOLITH_SHOTS,
    weathers: XENOLITH_SHOT_WEATHERS,
    image: XENOLITH_SHOT_IMAGE,
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
    // 壊れる前・倒す前の形を一度描いておく（破片・光の演出はその瞬間に出る）
    preRoll: (s) =>
      s.id === 'break' ? { ...s, id: 'orbit' } : s.id === 'defeat' ? { ...s, id: 'falling' } : null,
    // 光の尾・粒が落ち着くまで
    settle: (s) => (s.id === 'break' ? 10 : s.id === 'defeat' ? 30 : s.id === 'dash' ? 30 : 24),
  });
}
