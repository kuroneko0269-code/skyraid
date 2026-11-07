// 10-3a: 白鯨アルビオンの形（手続き生成）: 皮膚 1 つ（胴・頭のこぶ・胸びれ・尾びれ・背びれ・目・噴気孔・腹の巣 3・古傷）。
// 頂点の積み方はヴォルガスの KaijuMeshBuilder（管・楕円体、骨 2 本までの混ぜ）。aGlow: 皮膚 0 / 目 1 / 噴気孔 2 / 巣 3・4・5
import { Vector3 } from 'three';
import { ALBION_MODEL_CONFIG, type AlbionDetailSpec } from '../../data/albion-model';
import {
  KaijuMeshBuilder,
  rgb,
  type BoneBind,
  type Rgb,
  type TubeRing,
} from '../kaiju-model/builder';
import { ALBION_BONE, type AlbionBoneName } from './skeleton';

const C = ALBION_MODEL_CONFIG.colors;
const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
const one = (n: AlbionBoneName): BoneBind => ({ a: ALBION_BONE[n] });
const mix = (a: AlbionBoneName, b: AlbionBoneName, w: number): BoneBind => ({
  a: ALBION_BONE[a],
  b: ALBION_BONE[b],
  w,
});

interface Pt {
  readonly p: Vector3;
  /** 横の半径（ひれは翼弦）・縦の半径（ひれは厚さ） */
  readonly rx: number;
  readonly ry: number;
  readonly bone: BoneBind;
}

/** 点の列を管にする（点の間を steps 分割。両端はふさぐ） */
function tubeAlong(
  b: KaijuMeshBuilder,
  pts: readonly Pt[],
  steps: number,
  radial: number,
  color: Rgb,
  under: Rgb,
): void {
  const rings: TubeRing[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const c = pts[i + 1];
    if (!a || !c) continue;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      // 滑らかに（端で緩む）
      const e = t * t * (3 - 2 * t);
      rings.push({
        center: a.p.clone().lerp(c.p, t),
        rx: a.rx + (c.rx - a.rx) * e,
        ry: a.ry + (c.ry - a.ry) * e,
        color,
        under,
        bone: t < 0.5 ? a.bone : c.bone,
      });
    }
  }
  const last = pts[pts.length - 1];
  if (last) rings.push({ center: last.p, rx: last.rx, ry: last.ry, color, under, bone: last.bone });
  b.tube(rings, radial, true, true, true);
}

/** 胴（尾びれの付け根 → 頭の先）。白鯨らしい丸い頭（メロン）と、尾へ細くなる体 */
const BODY: readonly Pt[] = [
  { p: v(0, 0, 300), rx: 5, ry: 5, bone: one('flukes') },
  { p: v(0, 0, 282), rx: 10, ry: 10, bone: mix('tail2', 'flukes', 0.6) },
  { p: v(0, 0, 240), rx: 16, ry: 18, bone: one('tail2') },
  { p: v(0, 0, 190), rx: 24, ry: 26, bone: mix('tail1', 'tail2', 0.4) },
  { p: v(0, 1, 130), rx: 35, ry: 37, bone: one('tail1') },
  { p: v(0, 2, 70), rx: 46, ry: 47, bone: mix('tail0', 'tail1', 0.3) },
  { p: v(0, 2, 10), rx: 54, ry: 54, bone: mix('root', 'tail0', 0.6) },
  { p: v(0, 2, -60), rx: 58, ry: 57, bone: one('root') },
  { p: v(0, 2, -140), rx: 60, ry: 58, bone: one('root') },
  { p: v(0, 3, -200), rx: 58, ry: 56, bone: mix('root', 'head', 0.5) },
  { p: v(0, 5, -250), rx: 54, ry: 53, bone: one('head') },
  { p: v(0, 6, -285), rx: 46, ry: 46, bone: one('head') },
  { p: v(0, 5, -308), rx: 32, ry: 33, bone: one('head') },
  { p: v(0, 3, -318), rx: 15, ry: 15, bone: one('head') },
  { p: v(0, 2, -321), rx: 3, ry: 3, bone: one('head') },
];

/** 古傷（灰色の筋。胴の横と背に浮かせた細長い楕円体）: 中心・半径 */
const SCARS: readonly [number, number, number, number, number, number][] = [
  [57.5, 14, -60, 1.6, 2.4, 42],
  [-58.5, 4, -130, 1.6, 2, 30],
  [52, 24, 20, 1.6, 2.2, 26],
  [-20, 57.5, -100, 6, 1.4, 34],
];

export function buildAlbionSkin(d: AlbionDetailSpec): KaijuMeshBuilder {
  const b = new KaijuMeshBuilder();
  const rows = d.rows;
  const cols = rows * 2;
  tubeAlong(b, BODY, d.rings, d.radial, rgb(C.skin), rgb(C.belly));
  // 胸びれ（大きく、後ろへ流れる）と尾びれ（左右へ）。管の断面は横 = 翼弦・縦 = 厚さ
  const steps = Math.max(1, Math.round(d.rings * 0.7));
  for (const s of [-1, 1] as const) {
    const fin: AlbionBoneName = s < 0 ? 'finL' : 'finR';
    tubeAlong(
      b,
      [
        { p: v(36 * s, -32, -125), rx: 36, ry: 7, bone: one(fin) },
        { p: v(95 * s, -46, -110), rx: 30, ry: 4.5, bone: one(fin) },
        { p: v(140 * s, -54, -90), rx: 19, ry: 3, bone: one(fin) },
        { p: v(165 * s, -58, -74), rx: 5, ry: 1.6, bone: one(fin) },
      ],
      steps,
      d.finRadial,
      rgb(C.fin),
      rgb(C.belly, 0.95),
    );
    tubeAlong(
      b,
      [
        { p: v(4 * s, 0, 286), rx: 22, ry: 5, bone: one('flukes') },
        { p: v(40 * s, 0, 297), rx: 25, ry: 4, bone: one('flukes') },
        { p: v(80 * s, 1, 311), rx: 17, ry: 2.6, bone: one('flukes') },
        { p: v(105 * s, 2, 328), rx: 4, ry: 1.4, bone: one('flukes') },
      ],
      steps,
      d.finRadial,
      rgb(C.fin),
      rgb(C.fin, 0.9),
    );
    // 目（淡い青で光る）
    b.ellipsoid(
      v(48.5 * s, -2, -268),
      4,
      4,
      5,
      Math.max(3, rows - 2),
      Math.max(6, cols - 4),
      rgb(C.eye),
      one('head'),
      1,
    );
  }
  // 背びれ（低い山）
  b.ellipsoid(v(0, 52, 40), 5, 18, 46, rows, cols, rgb(C.skin, 0.96), one('dorsal'));
  // 噴気孔（潮吹きの予兆で膨らんで白く光る）
  b.ellipsoid(
    v(0, 58, -210),
    8,
    3,
    6,
    Math.max(3, rows - 2),
    Math.max(6, cols - 4),
    rgb(C.blowhole),
    one('root'),
    2,
  );
  // 腹の巣（赤い裂け目 3 つ: 前・中・後。光は巣ごと）
  const nests: readonly [number, number, BoneBind][] = [
    [-55, -120, one('root')],
    [-52, 0, mix('root', 'tail0', 0.5)],
    [-39, 110, mix('tail0', 'tail1', 0.3)],
  ];
  nests.forEach(([y, z, bone], i) => {
    b.ellipsoid(v(0, y, z), 13, 5, 30, rows, cols, rgb(C.nest), bone, 3 + i);
  });
  for (const [x, y, z, rx, ry, rz] of SCARS)
    b.ellipsoid(v(x, y, z), rx, ry, rz, 2, 6, rgb(C.scar), one('root'));
  return b;
}
