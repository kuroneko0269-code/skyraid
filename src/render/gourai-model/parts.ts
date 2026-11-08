// 10-4a: メカ怪獣ゴウライの形（手続き生成）: 皮 1 つ（胴・頭と目の帯・前の装甲の板 2 枚・核・砲台 6・背のハッチ・排気口 2・
// 下の推進器 4・アンテナ）。機械らしく面ごとに法線を分けた箱と円柱で組む。頂点の積み方はヴォルガスの KaijuMeshBuilder。
// aGlow: 0 なし / 1 核 / 2 左の排気口 / 3 右の排気口 / 4 ミサイルのハッチ / 5 機銃 / 6 推進器 / 7 目（10-4a の目の帯）/
// 8 放熱の格子（10-7c）/ 9 口の中（10-7c）/ 10 前の装甲の口の切れ目（10-7c）。
// 10-7c: 「ただの建物」に見えないように生き物らしい形を足した（creature.ts: 頭とあご・光る目・大あごの牙・腕と爪・背の放熱板・
// 背のとげ・尾）。足した形は体の当たりの箱 + 衝突の余裕の中（tests/gourai-visual.test.ts）
import { GOURAI_MODEL_CONFIG, type GouraiDetailSpec } from '../../data/gourai-model';
import { KaijuMeshBuilder, rgb, type BoneBind } from '../kaiju-model/builder';
import { buildCreature } from './creature';
import { box, boxPair, cylinder, hexa, v } from './primitives';
import { bonePosition, GOURAI_BONE, type GouraiBoneName } from './skeleton';

const C = GOURAI_MODEL_CONFIG.colors;
const one = (n: GouraiBoneName): BoneBind => ({ a: GOURAI_BONE[n] });

export const GLOW = {
  none: 0,
  core: 1,
  exhaustL: 2,
  exhaustR: 3,
  hatch: 4,
  gun: 5,
  hover: 6,
  visor: 7,
  grill: 8,
  mouth: 9,
  slit: 10,
} as const;

function buildHull(b: KaijuMeshBuilder, d: GouraiDetailSpec): void {
  const root = one('root');
  const hull = rgb(C.hull);
  const dark = rgb(C.dark);
  const armor = rgb(C.armor);
  const accent = rgb(C.accent);
  // 胴: 上が細い台形の箱（前 z −56 から後ろ z 70）
  hexa(
    b,
    [
      v(-42, -22, -56),
      v(42, -22, -56),
      v(40, -22, 70),
      v(-40, -22, 70),
      v(-30, 26, -50),
      v(30, 26, -50),
      v(28, 24, 66),
      v(-28, 24, 66),
    ],
    hull,
    root,
  );
  // 腹の竜骨・後ろの機関・背骨（10-7c: 背骨は放熱板の前まで。頭は creature.ts）
  box(b, -26, 26, -32, -22, -40, 56, dark, root);
  box(b, -38, 38, -16, 20, 66, 86, dark, root);
  box(b, -10, 10, 24, 34, -30, 46, dark, root);
  // 核の部屋（装甲が開くと見える暗い奥）
  box(b, -20, 20, -18, 20, -66, -56, dark, root);
  // 肩・腰の砲台の台
  boxPair(b, 28, 48, 16, 26, -34, -8, armor, root);
  boxPair(b, 40, 50, -16, 0, -10, 10, armor, root);
  // 排気口（後ろ。左右）: 暗い筒の奥が橙に光る
  for (const [x, g] of [
    [-24, GLOW.exhaustL],
    [24, GLOW.exhaustR],
  ] as const) {
    cylinder(b, v(x, 4, 82), v(x, 4, 98), 12, 15, d.sides, dark, root, rgb(C.exhaust), g);
  }
  // 下の推進器 4 つ（青白く光る。低く浮く姿）
  for (const x of [-32, 32])
    for (const z of [-36, 48])
      cylinder(b, v(x, -22, z), v(x, -34, z), 8, 11, d.sides, dark, root, rgb(C.hover), GLOW.hover);
  // アンテナ（遠くからの形。10-7c: 前の 1 本は頭の後ろへ寄せた）
  b.spike(v(0, 34, -14), v(2, 64, -6), 3, 4, dark, root);
  b.spike(v(-12, 32, 52), v(-16, 56, 66), 2.2, 4, dark, root);
  b.spike(v(12, 32, 52), v(16, 56, 66), 2.2, 4, dark, root);
  if (!d.greebles) return;
  // 細かな凹凸（「高」だけ）: 警告の帯・放熱板のすじ・横の継ぎ目・脇の箱
  boxPair(b, 40.5, 42.5, -14, -8, -50, 60, accent, root);
  for (let i = 0; i < 3; i++) box(b, -22, 22, 24, 27, 30 + i * 6, 33 + i * 6, dark, root);
  boxPair(b, 33, 41.5, 4, 8, -40, 64, dark, root);
  boxPair(b, 20, 30, -30, -22, -30, 20, hull, root);
  boxPair(b, 12, 14, 34, 40, -28, 44, accent, root);
  box(b, -30, 30, 18, 22, 86, 90, accent, root);
}

/** 前の装甲の板（左右。骨 armorL / armorR）。合わさると前へ尖る楔になり、核を隠す */
function buildArmor(b: KaijuMeshBuilder, d: GouraiDetailSpec): void {
  const armor = rgb(C.armor);
  const accent = rgb(C.accent);
  const dark = rgb(C.dark);
  for (const s of [-1, 1] as const) {
    const bone = one(s < 0 ? 'armorL' : 'armorR');
    const x = (n: number): number => n * s;
    hexa(
      b,
      [
        v(x(44), -22, -56),
        v(x(1), -22, -56),
        v(x(1), -12, -96),
        v(x(44), -16, -78),
        v(x(44), 24, -56),
        v(x(1), 24, -56),
        v(x(1), 14, -96),
        v(x(44), 18, -78),
      ],
      armor,
      bone,
    );
    // 板の縁の警告の帯と継ぎ目
    hexa(
      b,
      [
        v(x(45), -6, -60),
        v(x(45), -6, -76),
        v(x(45), 2, -76),
        v(x(45), 2, -60),
        v(x(42), -6, -60),
        v(x(42), -6, -76),
        v(x(42), 2, -76),
        v(x(42), 2, -60),
      ],
      accent,
      bone,
    );
    if (d.greebles) {
      for (let i = 0; i < 3; i++) {
        const y = -14 + i * 12;
        hexa(
          b,
          [
            v(x(40), y, -60),
            v(x(6), y, -60),
            v(x(6), y - 0.5, -92),
            v(x(40), y - 1, -76),
            v(x(40), y + 2, -60),
            v(x(6), y + 2, -60),
            v(x(6), y + 1.5, -92),
            v(x(40), y + 1, -76),
          ],
          dark,
          bone,
        );
      }
    }
  }
}

/** 核（骨 core。水色に光る楕円体） */
function buildCore(b: KaijuMeshBuilder, d: GouraiDetailSpec): void {
  const [x, y, z] = bonePosition('core');
  b.ellipsoid(v(x, y, z), 14, 14, 12, d.rows, d.rows * 2, rgb(C.core), one('core'), GLOW.core);
}

/** 砲台 6 つ（骨ごと。形は前 −Z 向きに作り、骨の回りで向きを変える） */
function buildTurrets(b: KaijuMeshBuilder, d: GouraiDetailSpec): void {
  const turret = rgb(C.turret);
  const barrel = rgb(C.barrel);
  const gun = rgb(C.gun);
  for (const name of ['gunL', 'gunR', 'hipL', 'hipR'] as const) {
    const [x, y, z] = bonePosition(name);
    const bone = one(name);
    box(b, x - 8, x + 8, y - 5, y + 6, z - 9, z + 9, turret, bone);
    for (const dx of [-3.5, 3.5])
      cylinder(
        b,
        v(x + dx, y + 1, z - 9),
        v(x + dx, y + 1, z - 34),
        2,
        1.6,
        Math.max(4, d.sides - 4),
        barrel,
        bone,
        gun,
        GLOW.gun,
      );
  }
  const hatch = rgb(C.hatch);
  for (const name of ['podL', 'podR'] as const) {
    const [x, y, z] = bonePosition(name);
    const bone = one(name);
    box(b, x - 10, x + 10, y - 7, y + 7, z - 13, z + 13, turret, bone);
    // ミサイルの筒 4 つ（上の前寄り。ハッチの下で赤く光る）
    for (const dx of [-4.5, 4.5])
      for (const dz of [-6, 2])
        cylinder(
          b,
          v(x + dx, y + 5, z + dz),
          v(x + dx, y + 8, z + dz - 3),
          3,
          3,
          Math.max(4, d.sides - 4),
          barrel,
          bone,
          hatch,
          GLOW.hatch,
        );
  }
  // 背のハッチ（骨 hatch。後ろの蝶番で前が持ち上がる）。10-7c: 平らな板から、真ん中の背が高い甲羅の形に（高さは 10-4a の板の中）
  const hatchBone = one('hatch');
  for (const sx of [-1, 1] as const) {
    hexa(
      b,
      [
        v(0, 50, 14),
        v(36 * sx, 47.5, 15),
        v(36 * sx, 47.5, 44),
        v(0, 50, 44),
        v(0, 52.5, 14),
        v(36 * sx, 49.6, 15),
        v(36 * sx, 49.6, 44),
        v(0, 52.5, 44),
      ],
      rgb(C.armor),
      hatchBone,
    );
    // 甲羅の重なった帯（3 本）
    if (d.greebles)
      for (const z of [22, 30, 38])
        hexa(
          b,
          [
            v(0, 52.3, z),
            v(34 * sx, 49.4, z),
            v(34 * sx, 49.4, z + 1.6),
            v(0, 52.3, z + 1.6),
            v(0, 52.5, z),
            v(34 * sx, 49.9, z),
            v(34 * sx, 49.9, z + 1.6),
            v(0, 52.5, z + 1.6),
          ],
          rgb(C.dark),
          hatchBone,
        );
  }
}

export function buildGouraiSkin(d: GouraiDetailSpec): KaijuMeshBuilder {
  const b = new KaijuMeshBuilder();
  buildHull(b, d);
  buildArmor(b, d);
  buildCore(b, d);
  buildTurrets(b, d);
  buildCreature(b, d);
  return b;
}
