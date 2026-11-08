// 10-7c: メカ怪獣ゴウライの生き物らしい形（「ただの建物」に見えないように）: 頭（光る目・眉の板・あご・口の中の光）・前の装甲の
// 顔（大きな目・口の切れ目・牙）と大あごの牙・腕（肩の関節・上腕・前腕・爪 2 枚）・背の放熱板（左右 3 枚ずつ。下に光る格子）・背のとげ・尾（後ろの下へ曲がる 3 節）。
// どれも体の当たりの箱（data/gourai.ts の GOURAI_HULL）+ 衝突の余裕の中に収める（動かしても。tests/gourai-visual.test.ts）
import { GOURAI_MODEL_CONFIG, type GouraiDetailSpec } from '../../data/gourai-model';
import { GOURAI_VISUAL } from '../../data/gourai-visual';
import { rgb, type BoneBind, type KaijuMeshBuilder } from '../kaiju-model/builder';
import { buildFace, buildHead } from './creature-head';
import { beam, box, cylinder, hexa, v } from './primitives';
import {
  bonePosition,
  GOURAI_BONE,
  GOURAI_FIN_HINGE,
  GOURAI_FIN_Z,
  type GouraiBoneName,
} from './skeleton';

const C = GOURAI_MODEL_CONFIG.colors;
const VC = GOURAI_VISUAL.colors;
const one = (n: GouraiBoneName): BoneBind => ({ a: GOURAI_BONE[n] });

/** aGlow の番号（parts.ts の GLOW と同じ） */
const G = { grill: 8 } as const;

/** 腕 1 本（s: −1 左 / 1 右）: 肩の関節・上腕・肘・前腕と油圧の筒・爪 2 枚（下は前腕、上は爪の骨で開く） */
function buildArm(b: KaijuMeshBuilder, d: GouraiDetailSpec, s: -1 | 1): void {
  const arm = one(s < 0 ? 'armL' : 'armR');
  const fore = one(s < 0 ? 'foreL' : 'foreR');
  const claw = one(s < 0 ? 'clawL' : 'clawR');
  const root = one('root');
  const armor = rgb(C.armor);
  const hull = rgb(C.hull);
  const dark = rgb(C.dark);
  const accent = rgb(C.accent);
  const sh = bonePosition(s < 0 ? 'armL' : 'armR');
  const el = bonePosition(s < 0 ? 'foreL' : 'foreR');
  const wr = bonePosition(s < 0 ? 'clawL' : 'clawR');
  const x = (n: number): number => n * s;
  const sides = Math.max(5, d.sides - 2);
  // 肩の台（胴の横から張り出す）と関節の筒
  box(b, Math.min(x(34), x(44)), Math.max(x(34), x(44)), -1, 15, -33, -15, dark, root);
  cylinder(b, v(x(39), sh[1], sh[2]), v(x(51), sh[1], sh[2]), 7, 7, sides, hull, arm);
  // 上腕（肩 → 肘。装甲の板と警告の帯）
  beam(b, v(sh[0], sh[1], sh[2]), v(el[0], el[1], el[2]), 9, 10, 7.5, 8, armor, arm);
  if (d.greebles)
    beam(
      b,
      v(sh[0] + x(4.4), sh[1] - 3, sh[2] - 2),
      v(el[0] + x(3.6), el[1] + 3, el[2] + 1),
      1.2,
      3,
      1.2,
      2.4,
      accent,
      arm,
    );
  // 肘の関節
  cylinder(b, v(x(42), el[1], el[2]), v(x(51.5), el[1], el[2]), 5, 5, sides, dark, fore);
  // 前腕（肘 → 手首）と油圧の筒（細い 2 本）
  beam(b, v(el[0], el[1], el[2]), v(wr[0], wr[1], wr[2]), 8, 8, 6.5, 6.5, hull, fore);
  if (d.greebles)
    for (const dx of [-2.6, 2.6])
      cylinder(
        b,
        v(el[0] + dx, el[1] + 5, el[2] + 1),
        v(wr[0] + dx, wr[1] + 5.5, wr[2] + 3),
        1.1,
        1.1,
        4,
        rgb(C.barrel),
        fore,
      );
  // 手首の関節
  cylinder(b, v(x(42), wr[1], wr[2]), v(x(50.5), wr[1], wr[2]), 4.2, 4.2, sides, dark, fore);
  // 爪: 下の刃（前腕に付く）と上の刃（爪の骨で開く）。先は前の下へ曲がる
  beam(
    b,
    v(wr[0], wr[1] - 2, wr[2] - 1),
    v(wr[0], wr[1] - 5, wr[2] - 10),
    5,
    3.4,
    3.2,
    2.2,
    dark,
    fore,
  );
  b.spike(v(wr[0], wr[1] - 5, wr[2] - 9.5), v(wr[0], wr[1] - 8, wr[2] - 12.5), 1.8, 4, armor, fore);
  beam(
    b,
    v(wr[0], wr[1] + 2, wr[2] - 1),
    v(wr[0], wr[1] + 1, wr[2] - 10),
    5,
    3.4,
    3.2,
    2.2,
    armor,
    claw,
  );
  b.spike(
    v(wr[0], wr[1] + 1, wr[2] - 9.5),
    v(wr[0], wr[1] - 2.5, wr[2] - 12.5),
    1.8,
    4,
    armor,
    claw,
  );
}

/** 背の放熱板（左右 3 枚ずつ。内側の縁の蝶番で外側が持ち上がる）と、その下の光る格子 */
function buildFins(b: KaijuMeshBuilder, d: GouraiDetailSpec): void {
  const armor = rgb(C.armor);
  const dark = rgb(C.dark);
  const accent = rgb(C.accent);
  const H = GOURAI_FIN_HINGE;
  // 後ろの甲板（格子の台。放熱板の下で橙に光る）
  box(b, -28, 28, 20, 24.6, 47, 86, dark, one('root'));
  box(b, -25, 25, 24.6, 25.2, 49, 85, rgb(VC.grill), one('root'), G.grill);
  GOURAI_FIN_Z.forEach((z, i) => {
    for (const s of [-1, 1] as const) {
      const bone = one(`fin${s < 0 ? 'L' : 'R'}${String(i)}` as GouraiBoneName);
      const x = (n: number): number => n * s;
      // 板（内側が高く外へ下がる。厚さ 1.6m・前後 11m）
      hexa(
        b,
        [
          v(x(H.x), H.y - 0.8, z - 5.5),
          v(x(25), 24.6, z - 5.5),
          v(x(25), 24.6, z + 5.5),
          v(x(H.x), H.y - 0.8, z + 5.5),
          v(x(H.x), H.y + 0.8, z - 5.5),
          v(x(25), 26.2, z - 5.5),
          v(x(25), 26.2, z + 5.5),
          v(x(H.x), H.y + 0.8, z + 5.5),
        ],
        armor,
        bone,
      );
      if (d.greebles) {
        // 板の縁の帯・裏の放熱のひれ（開くと見える）
        box(
          b,
          Math.min(x(23), x(25.2)),
          Math.max(x(23), x(25.2)),
          24.4,
          26.6,
          z - 5.6,
          z + 5.6,
          accent,
          bone,
        );
        for (const dz of [-2.6, 0, 2.6])
          box(
            b,
            Math.min(x(11), x(23)),
            Math.max(x(11), x(23)),
            23.6,
            25,
            z + dz - 0.3,
            z + dz + 0.3,
            dark,
            bone,
          );
      }
    }
  });
  // 背のとげ（背骨の上。頭の後ろから砲台の前まで）
  if (d.greebles)
    for (let i = 0; i < 5; i++) {
      const z = -24 + i * 9;
      hexa(
        b,
        [
          v(-1.2, 33.5, z - 3),
          v(1.2, 33.5, z - 3),
          v(1.2, 33.5, z + 4),
          v(-1.2, 33.5, z + 4),
          v(-0.5, 36.4 - i * 0.3, z + 1),
          v(0.5, 36.4 - i * 0.3, z + 1),
          v(0.5, 35.6 - i * 0.3, z + 4),
          v(-0.5, 35.6 - i * 0.3, z + 4),
        ],
        dark,
        one('root'),
      );
    }
}

/** 尾（後ろの機関の下から、排気口の間の下を通って後ろの下へ曲がる 3 節と先の針） */
function buildTail(b: KaijuMeshBuilder, d: GouraiDetailSpec): void {
  const armor = rgb(C.armor);
  const hull = rgb(C.hull);
  const dark = rgb(C.dark);
  const p1 = bonePosition('tail1');
  const p2 = bonePosition('tail2');
  const p3 = bonePosition('tail3');
  // 付け根（胴の下の後ろ）
  box(b, -10, 10, -22, -8, 64, 78, dark, one('root'));
  beam(
    b,
    v(p1[0], p1[1], p1[2] - 1),
    v(p2[0], p2[1], p2[2] + 1),
    14,
    12,
    11,
    10,
    hull,
    one('tail1'),
  );
  beam(
    b,
    v(p2[0], p2[1], p2[2] - 1),
    v(p3[0], p3[1], p3[2] + 1),
    11,
    10,
    8,
    8,
    armor,
    one('tail2'),
  );
  beam(b, v(p3[0], p3[1], p3[2] - 1), v(0, -33, 99.5), 8, 8, 4.5, 5, hull, one('tail3'));
  b.spike(v(0, -32, 99.5), v(0, -37, 101), 2.4, 4, dark, one('tail3'));
  if (d.greebles) {
    // 節の上の板（とげ）
    b.spike(v(0, p1[1] + 5, p1[2] + 5), v(0, p1[1] + 8.5, p1[2] + 10), 2.2, 4, dark, one('tail1'));
    b.spike(v(0, p2[1] + 4.2, p2[2] + 4), v(0, p2[1] + 7, p2[2] + 8.5), 1.8, 4, dark, one('tail2'));
  }
}

/** 生き物らしい形をまとめて積む */
export function buildCreature(b: KaijuMeshBuilder, d: GouraiDetailSpec): void {
  buildHead(b, d);
  buildFace(b, d);
  buildArm(b, d, -1);
  buildArm(b, d, 1);
  buildFins(b, d);
  buildTail(b, d);
}
