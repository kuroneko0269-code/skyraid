// 10-7b: 白鯨アルビオンの見た目の前後を撮る（?dev=kshot のときだけ読む遅延チャンク。遊ぶ人は読まない）。
// 撮る・測る仕組みは共通の kaiju-shot.ts。ここはアルビオンを場面の形に置くことだけ（撮るためだけ。この飛行の結果は使わない）
import { ALBION_CONFIG } from '../data/albion';
import {
  ALBION_SHOTS,
  ALBION_SHOT_BASE,
  ALBION_SHOT_IMAGE,
  ALBION_SHOT_WEATHERS,
  type AlbionShotDef,
} from '../data/albion-shots';
import type { AlbionRaid } from '../missions/albion-raid';
import { linkKaijuShot, type KaijuShotParts } from './kaiju-shot';

export type AlbionShotParts = Pick<
  KaijuShotParts<AlbionShotDef>,
  'camera' | 'pipeline' | 'weather' | 'game' | 'setFxClock' | 'setKaijuShown' | 'updateMs' | 'cue'
> & {
  readonly raid: () => AlbionRaid;
};

/** 怪獣を場面の形に置く（状態・姿勢・壊れた部位・倒した後） */
function arrange(raid: AlbionRaid, s: AlbionShotDef): void {
  const k = raid.kaiju;
  const b = k.body;
  const B = ALBION_SHOT_BASE;
  const p = k.parts;
  b.visible = true;
  b.position.x = B.x;
  b.position.y = B.y;
  b.position.z = B.z;
  b.heading = B.heading;
  b.pitch = 0;
  b.bank = s.bank;
  for (let i = 0; i < p.count; i++) p.partHp[i] = p.partMaxHp[i] ?? 0;
  p.hp = p.maxHp * (s.id === 'break' ? 0.55 : 1);
  k.phase = 1;
  raid.dead = false;
  raid.deadTime = 0;
  raid.landedTime = -1;
  raid.flash = 0;
  k.setAction('idle', null);
  k.cloudLeft = 0;
  k.swarm.clear();
  Object.assign(b.pose, {
    swimPhase: s.swimPhase,
    tailLift: 0,
    spoutSwell: 0,
    sink: 0,
    mist: 0,
    mouth: 0,
  });
  if (s.id === 'spout') {
    k.setAction('active', 'spout');
    k.actionTime = 0.5;
    b.pose.spoutSwell = 0.6;
  } else if (s.id === 'roar') {
    k.phase = 2;
    k.setAction('roar', null);
    k.actionTime = 1.2;
    b.pose.mouth = 1;
  } else if (s.id === 'break') {
    const i = p.indexOf('nestMid');
    p.partHp[i] = 0;
  } else if (s.id === 'falling' || s.id === 'defeat') {
    raid.dead = true;
    raid.deadTime = 4;
    p.hp = 0;
    b.pitch = -0.3;
    b.pose.mouth = 1;
    const floor = b.floorAt(B.x, B.z) + ALBION_CONFIG.size.radius * 0.4;
    b.position.y = floor + (s.id === 'falling' ? 60 : 0);
    if (s.id === 'defeat') raid.landedTime = 0.1;
  }
  b.prevPosition.x = b.position.x;
  b.prevPosition.y = b.position.y;
  b.prevPosition.z = b.position.z;
  b.prevHeading = b.heading;
  b.prevBank = b.bank;
}

export function linkAlbionShot(p: AlbionShotParts): void {
  linkKaijuShot<AlbionShotDef>({
    ...p,
    shots: ALBION_SHOTS,
    weathers: ALBION_SHOT_WEATHERS,
    image: ALBION_SHOT_IMAGE,
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
    // 壊れる前・海に着く前の形を一度描いておく（破片・水柱の演出はその瞬間に出る）
    preRoll: (s) =>
      s.id === 'break' ? { ...s, id: 'orbit' } : s.id === 'defeat' ? { ...s, id: 'falling' } : null,
    settle: (s) => (s.id === 'break' ? 15 : s.id === 'defeat' ? 45 : 24),
  });
}
