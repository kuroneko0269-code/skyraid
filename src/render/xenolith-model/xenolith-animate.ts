// 10-7d: UFO ゼノリスの骨の動きと光の値（10-5a の xenolith-object.ts から分けた。判定の値は読むだけ）: 円盤の飾りと発光体の輪の回転・
// 10-7d の浮かぶ光の輪 2 つの回転（描画だけ）・壊れた部位を縮める・溜めの間に砲口が震える・縁の帯 / 発光体 / 発生器 / 砲口 / ドームの光・
// バリアの殻（六角・揺らぎ・波紋）
import { Vector3, type Mesh } from 'three';
import { xenolithSpherePoint, type XenolithKaiju } from '../../ai/xenolith-ai';
import {
  XENOLITH_CONFIG,
  XENOLITH_EMITTERS,
  XENOLITH_GENS,
  XENOLITH_PARTS,
} from '../../data/xenolith';
import { XENOLITH_MODEL_CONFIG } from '../../data/xenolith-model';
import { XENOLITH_VISUAL } from '../../data/xenolith-visual';
import type { XenolithGlow } from './chrome-material';
import type { createBarrierMesh } from './holo';
import { XENOLITH_BONE, type XenolithBoneName, type XenolithSkeleton } from './skeleton';

const M = XENOLITH_MODEL_CONFIG;
const X = XENOLITH_CONFIG;
const V = XENOLITH_VISUAL;
const PART = (id: (typeof XENOLITH_PARTS)[number]): number => XENOLITH_PARTS.indexOf(id);
const CANNON = PART('cannon');
const DOME = PART('dome');
const tmp = { x: 0, y: 0, z: 0 };
const rippleDir = new Vector3(0, 1, 0);

/** 骨を動かす（円盤の飾り・発光体の輪・浮かぶ光の輪・壊れた部位・砲口の震え） */
export function animateXenolithParts(
  rig: XenolithSkeleton,
  k: XenolithKaiju,
  alpha: number,
  time: number,
): void {
  const bone = (name: XenolithBoneName) => rig.bones[XENOLITH_BONE[name]];
  const b = k.body;
  let ds = b.spin - b.prevSpin;
  if (ds < 0) ds += Math.PI * 2;
  const disc = bone('disc');
  if (disc) disc.rotation.y = -(b.prevSpin + ds * alpha);
  const ring = bone('ring');
  if (ring) ring.rotation.y = -(b.ringDeg * Math.PI) / 180;
  const halo = bone('halo');
  if (halo) halo.rotation.y = -time * V.motion.haloSpin;
  const under = bone('underRing');
  if (under) under.rotation.y = time * V.motion.haloSpin * 0.7;
  // 壊れた部位は縮める（発光体・発生器・砲口）
  const shrink = (name: XenolithBoneName, broken: boolean, s: number): void => {
    const bn = bone(name);
    if (bn) bn.scale.setScalar(broken ? s : 1);
  };
  XENOLITH_EMITTERS.forEach((id) => {
    shrink(id as XenolithBoneName, k.parts.isBroken(PART(id)), 0.4);
  });
  XENOLITH_GENS.forEach((id) => {
    shrink(id as XenolithBoneName, k.parts.isBroken(PART(id)), 0.45);
  });
  shrink('cannon', k.parts.isBroken(CANNON), 0.6);
  // 溜め撃ちの溜めの間、砲口が小刻みに震える
  const cannon = bone('cannon');
  if (cannon) {
    const shake = k.beam.kind === 'charged' && k.beam.phase === 'charge' ? 0.6 : 0;
    cannon.position.set(Math.sin(time * 70) * shake, -14, Math.cos(time * 63) * shake);
  }
}

/** 光の値（10-5a のまま: 縁の帯・発光体・発生器・砲口・ドーム・被弾） */
export function setXenolithGlow(
  glow: XenolithGlow,
  k: XenolithKaiju,
  flash: number,
  time: number,
): void {
  const bar = k.barrier;
  const G = M.glow;
  // 縁の帯: 張っている間は明るく、揺らぎで点滅、外れている間は暗い（攻めどきの印）
  glow.rim =
    bar.phase === 'up'
      ? G.rim
      : bar.phase === 'flicker'
        ? Math.sin(time * 40) > 0
          ? G.rim * 1.6
          : 0.2
        : G.rim * 0.2;
  // 10-5b: 光の弾の予兆: 縁の帯と発光体が白く強く光る（点滅しながら明るく）
  const orbK =
    k.orbPhase === 'warn'
      ? (0.5 + k.orbTime / X.orbs.warn) * (Math.sin(time * 30) > 0 ? 1 : 0.7)
      : 0;
  if (orbK > 0) glow.rim = Math.max(glow.rim, G.rim * M.orb.warnRim * orbK);
  // 瞬間移動の予兆の間は発光体が強く光る
  const warpK = Math.max(k.warp.glow, orbK);
  XENOLITH_EMITTERS.forEach((id, i) => {
    glow.emitters[i] = k.parts.isBroken(PART(id)) ? 0 : G.emitter * (1 + warpK * 1.5);
  });
  XENOLITH_GENS.forEach((id, i) => {
    glow.gens[i] = k.parts.isBroken(PART(id)) ? 0 : G.gen * (0.8 + 0.2 * Math.sin(time * 5 + i));
  });
  const beam = k.beam;
  let cannon: number = G.cannonIdle;
  if (beam.kind === 'charged') {
    if (beam.phase === 'warn')
      cannon = G.cannonIdle + (G.cannonMax * 0.4 * beam.time) / beam.spec.warn;
    else if (beam.phase === 'charge') cannon = G.cannonMax * (Math.sin(time * 30) > 0 ? 1 : 0.6);
    else if (beam.phase === 'fire') cannon = G.cannonMax;
  }
  glow.cannon = k.parts.isBroken(CANNON) ? 0 : cannon;
  glow.dome = k.parts.isBroken(DOME) ? 0 : G.dome;
  if (k.parts.isBroken(DOME)) glow.core = 0;
  glow.flash = flash;
}

/** バリアの殻（張っている間だけ。揺らぎで点滅し六角が欠ける・波紋は止めた判定の球の向き） */
export function setXenolithBarrier(
  fx: ReturnType<typeof createBarrierMesh>,
  mesh: Mesh,
  k: XenolithKaiju,
  center: Readonly<Vector3>,
  time: number,
): void {
  const bar = k.barrier;
  const B = X.barrier;
  const on = bar.absorbs;
  mesh.visible = on;
  if (!on) return;
  mesh.position.copy(center);
  mesh.position.y += B.up;
  mesh.scale.set(B.rx, B.ry, B.rx);
  let opacity: number = M.barrier.opacity;
  if (bar.phase === 'flicker') opacity *= Math.sin(time * 45) > 0 ? 1.4 : 0.15;
  const age = k.rippleAge;
  const life = M.barrier.ripple;
  let ripple = 0;
  if (k.rippleSphere >= 0 && age < life) {
    xenolithSpherePoint(tmp, k.body, k.rippleSphere);
    rippleDir
      .set(
        (tmp.x - k.body.position.x) / B.rx,
        (tmp.y - k.body.position.y - B.up) / B.ry,
        (tmp.z - k.body.position.z) / B.rx,
      )
      .normalize();
    ripple = 1 - age / life;
  }
  fx.set(opacity, rippleDir, ripple, bar.flickerAmount, time);
}
