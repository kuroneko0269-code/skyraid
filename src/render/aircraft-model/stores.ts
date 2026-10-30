// パイロンとミサイル（搭載数ぶん）。ミサイルは頂点の部品番号（100 + 番号）でシェーダーが消す
import { BoxGeometry, ConeGeometry, CylinderGeometry, type BufferGeometry } from 'three';
import type { AircraftShape } from '../../data/aircraft-shapes';
import { AIRCRAFT_MODEL_CONFIG } from '../../data/aircraft-model';
import type { MeshAccumulator, Rgb, UvFn } from './accumulator';
import { MISSILE_PART_BASE, PART, pylonLayout, wingSection, type PylonSpot } from './planform';
import { nacelleSpots } from './fuselage';

/** 汚れ・線のないアトラスの場所（パイロン・ミサイル） */
const cleanUv: UvFn = () => [0.75, 0.875];

/** ミサイル 1 発（胴・先端のシーカー・後ろの十字のフィン・前の小さなフィン）。前方 -Z */
function addMissile(
  acc: MeshAccumulator,
  at: Readonly<PylonSpot>,
  radial: number,
  fins: boolean,
  body: Rgb,
  seeker: Rgb,
): void {
  const m = AIRCRAFT_MODEL_CONFIG.missile;
  const part = MISSILE_PART_BASE + at.slot;
  const r = m.radius;
  const noseLength = r * 4;
  const bodyLength = m.length - noseLength;
  const put = (g: BufferGeometry, color: Rgb, z: number): void => {
    g.translate(at.x, at.y, at.z + z);
    acc.addGeometry(g, color, part, cleanUv);
  };
  // Cylinder・Cone は +Y 向きなので -Z（前）へ倒す
  put(
    new CylinderGeometry(r, r, bodyLength, radial, 1, false).rotateX(Math.PI / 2),
    body,
    noseLength / 2,
  );
  put(
    new ConeGeometry(r, noseLength, radial, 1, true).rotateX(-Math.PI / 2),
    seeker,
    -bodyLength / 2,
  );
  if (!fins) return;
  const tailZ = m.length / 2 - 0.2;
  put(new BoxGeometry(r * 5, 0.012, 0.32), body, tailZ);
  put(new BoxGeometry(0.012, r * 5, 0.32), body, tailZ);
  put(new BoxGeometry(r * 3.4, 0.01, 0.16), body, -m.length / 2 + noseLength + 0.25);
  put(new BoxGeometry(0.01, r * 3.4, 0.16), body, -m.length / 2 + noseLength + 0.25);
}

/** パイロン（翼の下は縦の板、翼端は横のレール、胴体の下は短い台） */
function addPylon(acc: MeshAccumulator, at: Readonly<PylonSpot>, color: Rgb): void {
  const r = AIRCRAFT_MODEL_CONFIG.missile.radius;
  let g: BufferGeometry;
  if (at.kind === 'tip') {
    const inward = at.x > 0 ? -1 : 1;
    g = new BoxGeometry(r * 1.6, 0.1, 2.2).translate(at.x + inward * r * 0.9, at.y, at.z - 0.1);
  } else {
    const h = at.kind === 'center' ? 0.3 : 0.36;
    g = new BoxGeometry(0.09, h, 1.5).translate(at.x, at.y + r + h / 2 - 0.02, at.z - 0.1);
  }
  acc.addGeometry(g, color, PART.none, cleanUv);
}

/** パイロンとミサイルを count 発ぶん積む。戻り値はパイロンの数 */
export function addStores(
  acc: MeshAccumulator,
  shape: Readonly<AircraftShape>,
  count: number,
  radial: number,
  fins: boolean,
  body: Rgb,
  missile: Rgb,
  seeker: Rgb,
): number {
  const spots = pylonLayout(shape, count);
  for (const at of spots) {
    addPylon(acc, at, body);
    addMissile(acc, at, radial, fins, missile, seeker);
  }
  return spots.length;
}

/** 輸送機のナセルを主翼に吊るす板 */
export function addNacellePylons(
  acc: MeshAccumulator,
  shape: Readonly<AircraftShape>,
  body: Rgb,
): void {
  if (shape.engines !== 4) return;
  for (const n of nacelleSpots(shape)) {
    const sec = wingSection(shape, shape.wing, Math.abs(n.x) / (shape.wing.span / 2));
    const top = sec.y;
    const h = top - n.y;
    acc.addGeometry(
      new BoxGeometry(0.28, h, 2.6).translate(n.x, n.y + h / 2, n.z + 1.6),
      body,
      PART.none,
      cleanUv,
    );
  }
}
