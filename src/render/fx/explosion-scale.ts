// 爆発の規模の決め方（4-4。Three.js 非依存・テストあり）: 範囲ダメージの半径 → 規模、壊れた対象 → 規模、
// 火球の色の移り変わり（白 → 橙 → 黒煙）
import {
  BLAST_RADIUS_SCALES,
  EXPLOSION_SPECS,
  FIREBALL_CONFIG,
  type ExplosionScale,
  type ExplosionSpec,
} from '../../data/fx';

/** 範囲ダメージの半径（m）から規模（ロケット・ミサイル → small、爆弾 → ground、誘爆 → fuel） */
export function scaleForBlastRadius(radius: number): ExplosionScale {
  for (const s of BLAST_RADIUS_SCALES) if (radius >= s.minRadius) return s.scale;
  return 'small';
}

/** 壊れた対象の見分けに使う形（CombatTarget と GroundTarget の一部） */
export interface ExplodingTarget {
  /** 壊れると範囲ダメージを出す（燃料タンク） */
  readonly deathBlast?: unknown;
  /** 地上目標の種類（GroundTarget だけが持つ） */
  readonly type?: unknown;
  readonly base?: unknown;
}

/** 撃墜・破壊された対象の規模: 燃料タンク → fuel、地上目標 → ground、それ以外（機体・的・ドローン）→ aircraft */
export function scaleForTarget(t: ExplodingTarget): ExplosionScale {
  if (t.deathBlast) return 'fuel';
  if (typeof t.type === 'string' && t.base !== undefined) return 'ground';
  return 'aircraft';
}

export function explosionSpec(scale: ExplosionScale): ExplosionSpec {
  return EXPLOSION_SPECS[scale];
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** 0xRRGGBB → 0〜1（sRGB のまま。描画側で線形に直す） */
function hexToRgb(hex: number, out: Rgb): Rgb {
  out.r = ((hex >> 16) & 255) / 255;
  out.g = ((hex >> 8) & 255) / 255;
  out.b = (hex & 255) / 255;
  return out;
}

const a: Rgb = { r: 0, g: 0, b: 0 };
const b: Rgb = { r: 0, g: 0, b: 0 };

/**
 * 火球の色（sRGB 0〜1）と明るさ（露出後）を寿命の割合 t（0〜1）から。白 → 橙 → 黒煙の色。
 * 戻り値は明るさ。色は out に入れる
 */
export function fireballColor(t: number, out: Rgb): number {
  const c = FIREBALL_CONFIG;
  let from: { color: number; intensity: number } = c.white;
  let to: { color: number; intensity: number } = c.white;
  let k = 0;
  if (t > c.whiteUntil && t <= c.orangeAt) {
    from = c.white;
    to = c.orange;
    k = (t - c.whiteUntil) / (c.orangeAt - c.whiteUntil);
  } else if (t > c.orangeAt) {
    from = c.orange;
    to = c.smoke;
    k = Math.min(1, (t - c.orangeAt) / (1 - c.orangeAt));
  }
  hexToRgb(from.color, a);
  hexToRgb(to.color, b);
  out.r = a.r + (b.r - a.r) * k;
  out.g = a.g + (b.g - a.g) * k;
  out.b = a.b + (b.b - a.b) * k;
  return from.intensity + (to.intensity - from.intensity) * k;
}
