// 10-7b: 白鯨アルビオンの皮の絵を起動時（チャンクを読んだとき）にコードで作る（画像ファイルは使わない。道具は共通の
// kaiju-look/noise.ts）。三方向から貼る繰り返しの絵: R 明るさのむら（古傷は白っぽく）・G つや（粗さ）のむら・B 凹凸の高さ
// （深いしわは幅の広い溝、フジツボは輪の形に高く）・A フジツボ（色を変える）。乱数は決まった種から
import { ALBION_VISUAL } from '../../data/albion-visual';
import { byte, fbm, rng, stroke, walk } from '../kaiju-look/noise';

const S = ALBION_VISUAL.skin;

/** 皮の絵（繰り返し）。size × size × RGBA */
export function buildAlbionSkinPixels(size: number, seed = 0xa1b1): Uint8Array {
  const r = rng(seed);
  const wrinkles = new Float32Array(size * size);
  const scars = new Float32Array(size * size);
  const barnH = new Float32Array(size * size);
  const barnM = new Float32Array(size * size);
  // 深いしわ: 横へ長くゆるく波打つ幅の広い溝（鯨の皮のしわ）
  for (let i = 0; i < S.wrinkles; i++) {
    const pts = walk(r, r(), r(), (r() - 0.5) * 0.4, 16, 0.035, 0.22);
    stroke(wrinkles, size, pts, 0.012 + r() * 0.012, 0.5 + r() * 0.5, true);
  }
  // 古傷: 長い引っかき傷（平行の 2〜3 本。白っぽく少し盛り上がる）
  for (let i = 0; i < S.scars; i++) {
    const x = r();
    const y = r();
    const a = r() * Math.PI * 2;
    const lines = 2 + Math.floor(r() * 2);
    for (let j = 0; j < lines; j++) {
      const ox = Math.cos(a + Math.PI / 2) * 0.022 * j;
      const oy = Math.sin(a + Math.PI / 2) * 0.022 * j;
      stroke(
        scars,
        size,
        walk(r, x + ox, y + oy, a, 10, 0.024, 0.15),
        0.008 + r() * 0.005,
        1,
        true,
      );
    }
  }
  // フジツボ: 群れごとに輪（ふちが高く中がくぼむ）。群れの真ん中ほど密
  const R = size / 512;
  for (let c = 0; c < S.barnacleClusters; c++) {
    const cx = r() * size;
    const cy = r() * size;
    const spread = (0.035 + r() * 0.045) * size;
    for (let i = 0; i < S.barnaclesPerCluster; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * r() * spread;
      const bx = cx + Math.cos(a) * d;
      const by = cy + Math.sin(a) * d * 0.7;
      const br = Math.max(1.2, (3 + r() * 5) * R);
      const rr = Math.ceil(br + 1);
      for (let dy = -rr; dy <= rr; dy++)
        for (let dx = -rr; dx <= rr; dx++) {
          const q = Math.hypot(dx, dy) / br;
          if (q >= 1.2) continue;
          const x = ((Math.round(bx + dx) % size) + size) % size;
          const y = ((Math.round(by + dy) % size) + size) % size;
          const o = y * size + x;
          // 輪: ふち（q ≈ 0.7）が高く、中（穴）は低い
          const rim = Math.max(0, 1 - Math.abs(q - 0.7) / 0.4);
          const h = rim - (q < 0.35 ? 0.3 : 0);
          if (h > (barnH[o] ?? 0)) barnH[o] = h;
          if (q < 1.1) barnM[o] = Math.max(barnM[o] ?? 0, Math.min(1, 1.2 - q * 0.5));
        }
    }
  }
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const o = y * size + x;
      const u = x / size;
      const v = y / size;
      const big = fbm(u, v, 2, 41);
      const mid = fbm(u, v, 5, 53);
      const w = wrinkles[o] ?? 0;
      const sc = scars[o] ?? 0;
      const bh = barnH[o] ?? 0;
      const bm = barnM[o] ?? 0;
      // むら（大きな斑と中くらいのしみ）・溝は少し暗い・古傷は白い・フジツボは暗い
      const albedo =
        0.62 + 0.24 * (big - 0.5) + 0.1 * (mid - 0.5) - 0.12 * w + 0.22 * sc - 0.2 * bm;
      const rough = 0.55 + 0.2 * (mid - 0.5) + 0.15 * w - 0.25 * sc + 0.3 * bm;
      const height =
        0.6 + 0.16 * (big - 0.5) + 0.08 * (mid - 0.5) - 0.42 * w + 0.12 * sc + 0.4 * bh;
      out[o * 4] = byte(albedo);
      out[o * 4 + 1] = byte(rough);
      out[o * 4 + 2] = byte(height);
      out[o * 4 + 3] = byte(bm);
    }
  return out;
}
