// 10-5a: UFO ゼノリスの形（KaijuMeshBuilder に積む）: 銀の円盤（周りの断面を回した面。下は少し暗い）・光る縁の帯・上のガラスのドーム・
// 縁の回る発光体 4・下の砲口・下にぶら下がる発生器 3（細い支柱と青い球）・円盤の上の放射状の筋（「高」だけ）。
// aGlow: 1 縁の帯・2〜5 発光体・6 砲口・7〜9 発生器・10 ドーム・11〜13 は 10-7d の飾り（ornaments.ts。chrome-material.ts）。
// 10-7d: 銀は鏡の金属の映り込みの色（chrome-material.ts）
import { XENOLITH_GENS } from '../../data/xenolith';
import { XENOLITH_MODEL_CONFIG, type XenolithDetailSpec } from '../../data/xenolith-model';
import { KaijuMeshBuilder, rgb, type BoneBind } from '../kaiju-model/builder';
import { lathe, type ProfilePoint } from './lathe';
import { buildXenolithOrnaments } from './ornaments';
import { box, cylinder, v } from '../gourai-model/primitives';
import { bonePosition, XENOLITH_BONE, type XenolithBoneName } from './skeleton';

const M = XENOLITH_MODEL_CONFIG;
const bone = (name: XenolithBoneName): BoneBind => ({ a: XENOLITH_BONE[name] });

export function buildXenolithSkin(d: XenolithDetailSpec): KaijuMeshBuilder {
  const b = new KaijuMeshBuilder();
  const C = M.colors;
  const silver = rgb(C.silver);
  const under = rgb(C.under);
  const seam = rgb(C.seam);
  const glass = rgb(C.glass);
  const disc = bone('disc');
  // 円盤: 下（砲口の付け根）→ 縁の帯（光る）→ 上（ドームの付け根）。面ごとに法線を分ける（金属の段がはっきり見える）
  lathe(
    b,
    [
      { r: 12, y: -14, color: under },
      { r: 46, y: -11, color: under },
      { r: 70, y: -5, color: under },
      { r: 78, y: -2, color: rgb(C.rim), glow: 1 },
      { r: 80, y: 0, color: rgb(C.rim), glow: 1 },
      { r: 78, y: 2.5, color: silver },
      { r: 62, y: 7, color: silver },
      { r: 40, y: 11, color: silver },
      { r: 26, y: 13, color: seam },
      { r: 24, y: 12, color: seam },
    ],
    d.segments,
    disc,
  );
  // 上のドーム（ガラス。薄紫に光る）
  const [, dy] = bonePosition('dome');
  const domeR = 26;
  const rows = Math.max(3, Math.round(d.segments / 6));
  const dome: ProfilePoint[] = [];
  for (let i = 0; i <= rows; i++) {
    const t = (i / rows) * (Math.PI / 2);
    dome.push({
      r: Math.max(0.01, Math.cos(t) * domeR),
      y: dy + Math.sin(t) * domeR * 0.95,
      color: glass,
      glow: 10,
    });
  }
  lathe(b, dome, d.segments, bone('dome'));
  // 円盤の上の放射状の筋と継ぎ目の帯（「高」だけ）
  if (d.greebles) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      cylinder(b, v(s * 30, 12.4, -c * 30), v(s * 74, 3.6, -c * 74), 1.2, 1.2, 4, seam, disc);
    }
    lathe(
      b,
      [
        { r: 50, y: -10.3, color: seam },
        { r: 54, y: -9.6, color: seam },
      ],
      d.segments,
      disc,
    );
  }
  // 下の砲口（溜め撃ちで橙に光る）
  const cannon = bone('cannon');
  const [, cy] = bonePosition('cannon');
  cylinder(
    b,
    v(0, cy + 2, 0),
    v(0, cy - 8, 0),
    12,
    9,
    Math.max(6, Math.round(d.segments / 3)),
    seam,
    cannon,
  );
  cylinder(
    b,
    v(0, cy - 8, 0),
    v(0, cy - 18, 0),
    7,
    5,
    Math.max(6, Math.round(d.segments / 3)),
    silver,
    cannon,
    rgb(C.cannon),
    6,
  );
  // 縁の発光体 4（回る輪に付く）
  for (let i = 0; i < 4; i++) {
    const name = `emitter${String(i)}` as XenolithBoneName;
    const [x, y, z] = bonePosition(name);
    b.ellipsoid(v(x, y, z), 7, 5, 7, d.rows, d.rows * 2, rgb(C.emitter), bone(name), 2 + i);
  }
  // 下の発生器 3（細い支柱と青い球。殻の外にぶら下がる）
  XENOLITH_GENS.forEach((part, i) => {
    const name = part as XenolithBoneName;
    const [x, y, z] = bonePosition(name);
    const g = bone(name);
    box(b, x - 1.6, x + 1.6, y + 6, -10, z - 1.6, z + 1.6, seam, g);
    b.ellipsoid(v(x, y, z), 8, 9, 8, d.rows, d.rows * 2, rgb(C.gen), g, 7 + i);
  });
  // 10-7d: 足した飾り（結晶の冠・浮かぶ光の輪 2 つ。体の当たりの中）
  buildXenolithOrnaments(b, d.segments, d.greebles ? 'high' : 'low');
  return b;
}
