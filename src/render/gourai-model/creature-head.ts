// 10-7c: メカ怪獣ゴウライの頭と顔（creature.ts から分けた）: 頭（首の襟・前へ細る頭の骨・光る目・眉の板・あご・口の中・頬の板・
// 上下の牙）と、前の装甲の楔の顔（大きな目・眉の板・口の切れ目の熾火・下の縁と先の牙・内側の縁の牙）
import { Vector3 } from 'three';
import { GOURAI_MODEL_CONFIG, type GouraiDetailSpec } from '../../data/gourai-model';
import { GOURAI_VISUAL } from '../../data/gourai-visual';
import { rgb, type BoneBind, type KaijuMeshBuilder, type Rgb } from '../kaiju-model/builder';
import { box, hexa, v } from './primitives';
import { GOURAI_BONE, type GouraiBoneName } from './skeleton';

const C = GOURAI_MODEL_CONFIG.colors;
const VC = GOURAI_VISUAL.colors;
const one = (n: GouraiBoneName): BoneBind => ({ a: GOURAI_BONE[n] });

/** aGlow の番号（parts.ts の GLOW と同じ） */
const G = { eye: 7, mouth: 9, slit: 10 } as const;

/** 頭: 首の襟・頭の骨（前へ細る）・眉の板・目（光る）・あご・口の中・頬の板・上の牙 */
export function buildHead(b: KaijuMeshBuilder, d: GouraiDetailSpec): void {
  const root = one('root');
  const head = one('head');
  const jaw = one('jaw');
  const armor = rgb(C.armor);
  const hull = rgb(C.hull);
  const dark = rgb(C.dark);
  const accent = rgb(C.accent);
  // 首の襟（胴の前の上。頭が回っても隙間が見えない）
  box(b, -17, 17, 17.5, 28.5, -50, -28, dark, root);
  // 頭の骨: 後ろ（広く高い）→ 前（細く低い）。上の前の縁が鼻すじ
  hexa(
    b,
    [
      v(-15, 20.5, -30),
      v(15, 20.5, -30),
      v(8, 21.5, -60),
      v(-8, 21.5, -60),
      v(-13, 33.5, -30),
      v(13, 33.5, -30),
      v(5, 30.5, -60),
      v(-5, 30.5, -60),
    ],
    armor,
    head,
  );
  // 頭の上の甲（後ろへ反る。首の上を覆う）
  hexa(
    b,
    [
      v(-11, 32.5, -50),
      v(11, 32.5, -50),
      v(12, 33, -24),
      v(-12, 33, -24),
      v(-8, 35, -50),
      v(8, 35, -50),
      v(9, 35, -26),
      v(-9, 35, -26),
    ],
    hull,
    head,
  );
  for (const s of [-1, 1] as const) {
    const x = (n: number): number => n * s;
    // 目（斜めの切れ長。前の横の面から少し出る）
    hexa(
      b,
      [
        v(x(4.5), 26.5, -60.6),
        v(x(10.5), 27.7, -54.5),
        v(x(10.8), 27.7, -52.5),
        v(x(4.8), 26.5, -59.2),
        v(x(5), 29.1, -60.4),
        v(x(10.4), 30.5, -54.5),
        v(x(10.7), 30.5, -52.5),
        v(x(5.3), 29.1, -59),
      ],
      rgb(C.visor),
      head,
      G.eye,
    );
    // 眉の板（目の上へ張り出す。怒った形）
    hexa(
      b,
      [
        v(x(2), 30.5, -61.2),
        v(x(13), 33, -51),
        v(x(13), 33, -47),
        v(x(2), 30.5, -57),
        v(x(2), 32.5, -61),
        v(x(13), 35.1, -51),
        v(x(13), 35.1, -47),
        v(x(2), 32.5, -57),
      ],
      dark,
      head,
    );
    // 頬の板（警告の帯）
    hexa(
      b,
      [
        v(x(14.2), 22, -32),
        v(x(9.2), 22, -54),
        v(x(9.2), 25.5, -54),
        v(x(14.2), 26.5, -32),
        v(x(15.4), 22, -32),
        v(x(10.4), 22, -54),
        v(x(10.4), 25.5, -54),
        v(x(15.4), 26.5, -32),
      ],
      accent,
      head,
    );
  }
  // あご（骨 jaw。下へ開く）と口の中（光る。開くと見える）
  hexa(
    b,
    [
      v(-10, 16, -38),
      v(10, 16, -38),
      v(6, 17.5, -60),
      v(-6, 17.5, -60),
      v(-10, 20.1, -38),
      v(10, 20.1, -38),
      v(6.5, 20.7, -60.5),
      v(-6.5, 20.7, -60.5),
    ],
    hull,
    jaw,
  );
  box(b, -6, 6, 20.1, 21.7, -58, -40, rgb(VC.mouth), jaw, G.mouth);
  box(b, -6.5, 6.5, 20.7, 21.9, -59, -40, rgb(VC.mouth), head, G.mouth);
  if (!d.greebles) return;
  // 牙（上と下。かみ合わせ）
  for (let i = 0; i < 4; i++) {
    const z = -58 + i * 4.2;
    for (const s of [-1, 1] as const) {
      b.spike(
        v(s * (5.4 - i * 0.2), 21.1, z),
        v(s * (5 - i * 0.2), 18.1, z - 0.8),
        1,
        3,
        rgb(0xd9d4c8),
        head,
      );
      b.spike(
        v(s * (4.6 - i * 0.2), 20.3, z + 2),
        v(s * (4.4 - i * 0.2), 22.9, z + 1.4),
        0.9,
        3,
        rgb(0xd9d4c8),
        jaw,
      );
    }
  }
}

/**
 * 前の装甲の楔を「顔」に: 前の面に大きな目（光る）と眉の板・口の切れ目（熾火のように光る）・下の縁の牙・先の牙。内側の縁の牙は
 * 閉じると反対の板の中に隠れ、放熱で開くと見える（大あごが開いて喉の核が光る）
 */
export function buildFace(b: KaijuMeshBuilder, d: GouraiDetailSpec): void {
  const fang = rgb(0xd6cfbf);
  const dark = rgb(C.dark);
  const n = d.greebles ? 6 : 3;
  for (const s of [-1, 1] as const) {
    const plate = one(s < 0 ? 'armorL' : 'armorR');
    // 前の面（外の後ろ A・内の先 B・内の先の上 C・外の後ろの上 D）と外向きの法線
    const A = v(44 * s, -16, -78);
    const B = v(1 * s, -12, -96);
    const Cc = v(1 * s, 14, -96);
    const D = v(44 * s, 18, -78);
    const nrm = new Vector3(0.386 * s, 0, -0.922);
    const at = (u: number, w: number, off: number): Vector3 => {
      const lo = new Vector3().lerpVectors(A, B, u);
      const hi = new Vector3().lerpVectors(D, Cc, u);
      return lo.lerp(hi, w).addScaledVector(nrm, off);
    };
    const quad = (
      u0: number,
      w0a: number,
      w0b: number,
      u1: number,
      w1a: number,
      w1b: number,
      off0: number,
      off1: number,
      color: Rgb,
      glow = 0,
    ): void => {
      hexa(
        b,
        [
          at(u0, w0a, off0),
          at(u1, w1a, off0),
          at(u1, w1b, off0),
          at(u0, w0b, off0),
          at(u0, w0a, off1),
          at(u1, w1a, off1),
          at(u1, w1b, off1),
          at(u0, w0b, off1),
        ],
        color,
        plate,
        glow,
      );
    };
    // 目（外ほど高い怒った切れ長）と、その上へ張り出す眉の板
    quad(0.16, 0.74, 0.9, 0.58, 0.62, 0.74, 0.1, 1.2, rgb(C.visor), G.eye);
    quad(0.1, 0.9, 0.99, 0.64, 0.75, 0.86, 0.2, 3.4, dark);
    // 口の切れ目（熾火の光）と、その上の唇の板
    quad(0.04, 0.3, 0.36, 0.97, 0.3, 0.36, 0.1, 0.5, rgb(VC.mouth), G.slit);
    quad(0.04, 0.36, 0.42, 0.97, 0.36, 0.42, 0.2, 1.6, dark);
    // 下の縁の牙（下へ）と先の牙（前の下へ）
    for (let i = 0; i < n; i++) {
      const u = 0.12 + (i / Math.max(1, n - 1)) * 0.7;
      const base = at(u, 0.05, 0.8);
      b.spike(base, base.clone().add(v(0, -6 - (i % 2) * 2, -1)), 1.8, 4, fang, plate);
    }
    b.spike(at(0.9, 0.12, 0.6), v(5 * s, -23, -101), 2.6, 4, fang, plate);
    // 内側の縁の牙（閉じると隠れる）
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const z = -60 - t * 30;
      const y = (i % 2 === 0 ? 4 : -6) * (1 - t * 0.4);
      b.spike(v(s * 1.2, y, z), v(-s * 5, y - 1.5, z - 2), 2.4 - t, 4, fang, plate);
    }
  }
}
