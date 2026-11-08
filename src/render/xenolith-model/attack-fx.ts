// 10-7d: UFO ゼノリスの攻撃の見た目の進行（描画だけ。判定の値は読むだけ）: 光線（撃つ間は芯と外側の光・口の光の粒、予兆は撃つ先へ
// 流れる点線、溜めの間は砲口へ光の粒が吸い込まれる）・光の弾（八面体の粒にきらめく星を重ねる）。予兆の線は体のきらめきより明るく
import { Color, Vector3 } from 'three';
import type { XenolithKaiju } from '../../ai/xenolith-ai';
import { bodyDirection } from '../../ai/raid-kit/frame';
import { XENOLITH_MODEL_CONFIG } from '../../data/xenolith-model';
import { XENOLITH_VISUAL } from '../../data/xenolith-visual';
import type { BeamFx } from './beam-fx';
import type { StarSprites } from './sprites';

const M = XENOLITH_MODEL_CONFIG;
const V = XENOLITH_VISUAL;
const STEP = 1 / 60;
const origin = new Vector3();
const dir = new Vector3();
const p = new Vector3();
const v = new Vector3();
const tmp = { x: 0, y: 0, z: 0 };
const orbColor = new Color(M.colors.orb);

/** 光線（毎フレーム並べ直す）。sprites は口の光・溜めの粒（無ければ出さない） */
export function drawBeam(
  k: XenolithKaiju,
  fx: BeamFx,
  sprites: StarSprites | null,
  time: number,
  dt: number,
): void {
  const beam = k.beam;
  fx.begin(time);
  if (beam.busy && beam.phase !== 'recover') {
    const s = beam.spec;
    origin.set(beam.origin.x, beam.origin.y, beam.origin.z);
    const charged = beam.kind === 'charged';
    const hex = charged ? M.colors.chargedBeam : M.colors.sweepBeam;
    const warnR = M.beam.warnRadius;
    if (beam.phase === 'fire') {
      const r = s.radius * M.beam.fireScale * (0.85 + 0.15 * Math.sin(time * 50));
      dir.set(beam.direction.x, beam.direction.y, beam.direction.z);
      fx.add(origin, dir, s.length, r * V.beam.glowScale, hex, 1.1, 1);
      fx.add(origin, dir, s.length, r * 0.55, hex, 1.6, 0);
      // 口の光（大きな星が瞬く）
      if (sprites && dt > 0 && Math.random() < dt * 30)
        sprites.emit(origin, v.set(0, 0, 0), 0.18, V.beam.flare * (0.7 + Math.random() * 0.5), hex);
    } else if (!charged) {
      // なぎ払いの予兆: 撃つ線の始めと終わりが流れる点線（点滅しながら明るく）
      const kk = 0.35 + 0.65 * (beam.time / s.warn) * (Math.sin(time * 18) > 0 ? 1 : 0.6);
      for (const yaw of [beam.fromYawDeg, beam.toYawDeg]) {
        bodyDirection(tmp, k.body, yaw, beam.pitchDeg);
        dir.set(tmp.x, tmp.y, tmp.z);
        fx.add(origin, dir, s.length, warnR, hex, kk, 2);
      }
    } else {
      // 溜め撃ち: ロック警告の間は追う細い点線（点滅）、溜めの間は止まった線（明るく）と砲口へ吸い込まれる光
      dir.set(beam.direction.x, beam.direction.y, beam.direction.z);
      const lock = beam.phase === 'warn';
      const kk = lock ? (Math.sin(time * 14) > 0 ? 0.7 : 0.25) : 1.1;
      fx.add(origin, dir, s.length, lock ? warnR : warnR * 1.6, hex, kk, 2);
      if (sprites && !lock && dt > 0 && Math.random() < dt * 40) {
        const a = Math.random() * Math.PI * 2;
        const e = (Math.random() - 0.3) * Math.PI * 0.5;
        const r = 40 + Math.random() * 30;
        p.set(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r).add(
          origin,
        );
        v.subVectors(origin, p).multiplyScalar(2.6);
        sprites.emit(p, v, 0.38, 4 + Math.random() * 3, hex, 0.3, 0);
      }
    }
  }
  fx.end();
}

/** 光の弾のきらめき（弾ごとに星。前のステップとの間を alpha で補間） */
export function drawOrbHalos(
  k: XenolithKaiju,
  sprites: StarSprites,
  camera: Readonly<Vector3>,
  alpha: number,
  time: number,
): void {
  const back = (1 - alpha) * STEP;
  const size = 7 * V.orbHalo.scale;
  for (const s of k.orbs.shots) {
    if (!s.active) continue;
    p.set(
      s.position.x - s.velocity.x * back,
      s.position.y - s.velocity.y * back,
      s.position.z - s.velocity.z * back,
    );
    const tw = 0.75 + 0.25 * Math.sin(time * V.orbHalo.twinkleHz * Math.PI * 2 + s.turret * 1.7);
    sprites.star(camera, p, size * tw, orbColor, 0.6, time * 1.5 + s.turret);
  }
}
