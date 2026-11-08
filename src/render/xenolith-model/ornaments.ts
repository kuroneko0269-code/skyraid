// 10-7d: UFO ゼノリスの足した飾り（KaijuMeshBuilder に積む）: ドームのまわりの結晶の冠（8 本。虹色に光る）・上の面に浮かぶ回る光の輪・
// 下の面に浮かぶ逆へ回る光の輪。どれも体の当たり（円盤の楕円体とドーム + 衝突の余裕）の中（tests/xenolith-visual.test.ts が頂点ごとに
// 確かめる）。aGlow: 11 結晶・12 上の光の輪・13 下の光の輪（chrome-material.ts）
import { Vector3 } from 'three';
import { XENOLITH_VISUAL } from '../../data/xenolith-visual';
import { KaijuMeshBuilder, rgb, type BoneBind, type Rgb } from '../kaiju-model/builder';
import { lathe } from './lathe';
import { XENOLITH_BONE, type XenolithBoneName } from './skeleton';

const V = XENOLITH_VISUAL;
const bone = (name: XenolithBoneName): BoneBind => ({ a: XENOLITH_BONE[name] });

/** 飾りの置き場所（m。体の中心から。結晶の根元と先・上の輪・下の輪の断面） */
export const XENOLITH_ORNAMENTS = {
  crystals: { count: 8, baseR: 32, baseY: 11.5, tipR: 28.5, tipY: 18.6, width: 2.4 },
  halo: { r0: 66, r1: 73, y0: 7.4, y1: 8.6 },
  under: { r0: 47, r1: 54, y0: -13.2, y1: -12.2 },
} as const;

const e1 = new Vector3();
const e2 = new Vector3();
const nrm = new Vector3();
const mid = new Vector3();

/** 平らな面の三角形（外向き out の側を表に） */
function facet(
  b: KaijuMeshBuilder,
  p0: Readonly<Vector3>,
  p1: Readonly<Vector3>,
  p2: Readonly<Vector3>,
  out: Readonly<Vector3>,
  color: Rgb,
  bind: BoneBind,
  glow: number,
): void {
  e1.subVectors(p1, p0);
  e2.subVectors(p2, p0);
  nrm.crossVectors(e1, e2).normalize();
  mid.copy(p0).add(p1).add(p2).divideScalar(3).sub(out);
  const flip = nrm.dot(mid) < 0;
  if (flip) nrm.negate();
  const a = b.vertex(p0, nrm, color, bind, glow);
  const c1 = b.vertex(flip ? p2 : p1, nrm, color, bind, glow);
  const c2 = b.vertex(flip ? p1 : p2, nrm, color, bind, glow);
  b.triangle(a, c1, c2);
}

/** 結晶 1 本（根元から先へ。中ほどが一番太い両錐。sides 面） */
function crystal(
  b: KaijuMeshBuilder,
  base: Readonly<Vector3>,
  tip: Readonly<Vector3>,
  width: number,
  sides: number,
  color: Rgb,
  bind: BoneBind,
): void {
  const axis = new Vector3().subVectors(tip, base);
  const len = axis.length();
  axis.normalize();
  const u = new Vector3(0, 0, 1).cross(axis);
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
  u.normalize();
  const v = new Vector3().crossVectors(axis, u).normalize();
  const center = new Vector3().copy(base).addScaledVector(axis, len * 0.35);
  const ring = Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return new Vector3()
      .copy(center)
      .addScaledVector(u, Math.cos(a) * width)
      .addScaledVector(v, Math.sin(a) * width);
  });
  for (let i = 0; i < sides; i++) {
    const r0 = ring[i];
    const r1 = ring[(i + 1) % sides];
    if (!r0 || !r1) continue;
    facet(b, base, r0, r1, center, color, bind, 11);
    facet(b, r0, tip, r1, center, color, bind, 11);
  }
}

/** 飾りを積む（high: 結晶 6 面・輪の分割 segments、low: 結晶 4 面） */
export function buildXenolithOrnaments(
  b: KaijuMeshBuilder,
  segments: number,
  detail: 'low' | 'high',
): void {
  const O = XENOLITH_ORNAMENTS;
  const c = O.crystals;
  const crystalColor = rgb(V.colors.crystal);
  const disc = bone('disc');
  for (let i = 0; i < c.count; i++) {
    const a = ((i + 0.5) / c.count) * Math.PI * 2;
    const s = Math.sin(a);
    const k = Math.cos(a);
    crystal(
      b,
      new Vector3(s * c.baseR, c.baseY, -k * c.baseR),
      new Vector3(s * c.tipR, c.tipY, -k * c.tipR),
      c.width,
      detail === 'high' ? 6 : 4,
      crystalColor,
      disc,
    );
  }
  // 浮かぶ光の輪（断面は四角。上は外へ回り、下は逆へ回る）
  const ringColor = rgb(V.colors.halo);
  for (const [ring, name, glow] of [
    [O.halo, 'halo', 12],
    [O.under, 'underRing', 13],
  ] as const) {
    lathe(
      b,
      [
        { r: ring.r0, y: ring.y0, color: ringColor, glow },
        { r: ring.r1, y: ring.y0, color: ringColor, glow },
        { r: ring.r1, y: ring.y1, color: ringColor, glow },
        { r: ring.r0, y: ring.y1, color: ringColor, glow },
        { r: ring.r0, y: ring.y0, color: ringColor, glow },
      ],
      segments,
      bone(name),
    );
  }
}
