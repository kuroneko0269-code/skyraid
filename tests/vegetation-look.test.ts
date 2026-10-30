import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { VEGETATION_CONFIG } from '../src/data/vegetation';
import { forestDensity, placeTrees, treeEdgeScale } from '../src/render/terrain-gen/forest';
import { getHeight } from '../src/render/terrain-height';
import { treeShape } from '../src/render/vegetation-billboard';
import { createCrownTexture, crownHalfWidth } from '../src/render/vegetation-crowns';
import { createTreeGeometry } from '../src/render/vegetation-near';

const v = VEGETATION_CONFIG;

describe('木の見た目（4-9）', () => {
  it('近くの木は 1 本 40 三角形以下（円錐 3 段 + 丸めた頂点 + 幹）', () => {
    const g = createTreeGeometry();
    const triangles = g.getAttribute('position').count / 3;
    expect(triangles).toBeLessThanOrEqual(40);
    expect(triangles).toBe(31);
    // 高さ 1・根元 0 に収まる
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeGreaterThanOrEqual(0);
      expect(pos.getY(i)).toBeLessThanOrEqual(1);
    }
  });

  it('葉の色は 4-8 より明度（HSL）が約 25% 高い', () => {
    const hsl = { h: 0, s: 0, l: 0 };
    const before = new Color(0x30492a).getHSL(hsl, 'srgb').l;
    const after = new Color(v.colors.foliage).getHSL(hsl, 'srgb').l;
    expect(after / before).toBeCloseTo(1.25, 1);
  });

  it('森の密集部の高さは平均の ±25%、縁ほど低い', () => {
    for (const seed of [0, 0.25, 0.5, 0.999]) {
      const h = treeShape(seed).height;
      expect(h).toBeGreaterThanOrEqual(v.height.mean * 0.75 - 1e-6);
      expect(h).toBeLessThanOrEqual(v.height.mean * 1.25 + 1e-6);
    }
    expect(treeEdgeScale(0)).toBeCloseTo(v.edge.heightMin, 6);
    expect(treeEdgeScale(1)).toBe(1);
    expect(treeEdgeScale(0.3)).toBeLessThan(treeEdgeScale(0.6));
  });

  it('森の縁（密度が低い所）は木が疎で低い', () => {
    const t = placeTrees(getHeight, 20000, undefined, undefined, true);
    let edge = 0;
    let edgeScale = 0;
    let core = 0;
    for (let i = 0; i < t.count; i++) {
      const d = forestDensity(t.positions[i * 3] ?? 0, t.positions[i * 3 + 2] ?? 0);
      if (d < 0.4) {
        edge++;
        edgeScale += t.scales[i] ?? 1;
      } else if (d > 0.9) core++;
    }
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(core);
    expect(edgeScale / edge).toBeLessThan(0.85);
  });

  it('遠景の樹冠は頂点が丸い（4-8 の三角形より頂点の近くが太い）。種類ごとに形が違う', () => {
    for (let type = 0; type < v.crowns.types; type++) {
      expect(crownHalfWidth(type, 0.95)).toBeGreaterThan(0.05 * 2);
      expect(crownHalfWidth(type, 1.01)).toBe(0);
    }
    expect(crownHalfWidth(0, 0.5)).not.toBeCloseTo(crownHalfWidth(1, 0.5), 2);
    expect(crownHalfWidth(1, 0.5)).not.toBeCloseTo(crownHalfWidth(2, 0.5), 2);
  });

  it('樹冠のテクスチャは手続き生成で、種類 × [1 本・束] + 上からの輪郭のタイルに覆いがある', () => {
    const tex = createCrownTexture();
    const { width, height } = tex.image;
    const data = tex.image.data as Uint8Array;
    const tile = v.crowns.tileSize;
    expect(width).toBe((v.crowns.types + 1) * tile);
    expect(height).toBe(2 * tile);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col <= v.crowns.types; col++) {
        let covered = 0;
        for (let y = 0; y < tile; y++) {
          for (let x = 0; x < tile; x++) {
            if ((data[((row * tile + y) * width + col * tile + x) * 4 + 3] ?? 0) > 0) covered++;
          }
        }
        expect(covered).toBeGreaterThan(tile * tile * 0.15);
        expect(covered).toBeLessThan(tile * tile * 0.9);
      }
    }
    tex.dispose();
  });
});
