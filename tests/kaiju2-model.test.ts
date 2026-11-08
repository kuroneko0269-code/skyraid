// 9-6a: ネフィルガのモデルの重さ（三角形・描画の回数）をヴォルガスと比べる。描画そのものはテストしない
import { describe, expect, it } from 'vitest';
import { SkinnedMesh } from 'three';
import { buildKaijuGeometries } from '../src/render/kaiju-model/kaiju-object';
import { Kaiju2Object, buildKaiju2Geometries } from '../src/render/kaiju2-model/kaiju2-object';
import { SkyKaiju } from '../src/entities/kaiju2/sky-kaiju';

describe('ネフィルガのモデル（9-6a）', () => {
  it('三角形: 「高」15,000 以下・「低」5,000 以下。どちらもヴォルガスより少ない', () => {
    const hi = buildKaiju2Geometries('high');
    const lo = buildKaiju2Geometries('low');
    const vHi = buildKaijuGeometries('high').triangles;
    const vLo = buildKaijuGeometries('low').triangles;
    console.info(
      `kaiju2 triangles high ${String(hi.triangles)} / low ${String(lo.triangles)} (vorgas ${String(vHi)} / ${String(vLo)})`,
    );
    expect(hi.triangles).toBeLessThanOrEqual(15000);
    expect(lo.triangles).toBeLessThanOrEqual(5000);
    expect(lo.triangles).toBeLessThan(hi.triangles);
    expect(hi.triangles).toBeLessThan(vHi);
    expect(lo.triangles).toBeLessThan(vLo);
  });

  it('頂点の値に NaN が無く、骨の重みの合計は 1', () => {
    for (const d of ['high', 'low'] as const) {
      const g = buildKaiju2Geometries(d);
      for (const geo of [g.skin, g.membrane]) {
        const pos = geo.getAttribute('position');
        for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
        const w = geo.getAttribute('skinWeight');
        for (let i = 0; i < w.count; i++)
          expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 5);
      }
    }
  });

  it('描画の回数: 体は皮膚と膜の 2 つ（雷球・突風は出ているときだけ 1 つずつ）。ヴォルガスは 8', () => {
    const obj = new Kaiju2Object('high');
    let skinned = 0;
    obj.group.traverse((o) => {
      if (o instanceof SkinnedMesh) skinned++;
    });
    expect(skinned).toBe(2);
    expect(obj.objects.length).toBe(4);
    // 画質を変えると作り直す（三角形が減る）
    const hi = obj.triangles;
    obj.setDetail('low');
    expect(obj.triangles).toBeLessThan(hi);
    // 動かしても例外が出ない（姿勢の値を極端に）
    const k = new SkyKaiju(() => 0);
    Object.assign(k.pose, { wingFold: 1, wingRaise: 1, tailCurl: 1, tailSwing: -1, legsDown: 1 });
    obj.setVisible(true);
    obj.update(k, 0.5, 1 / 60);
    expect(Number.isFinite(obj.group.quaternion.w)).toBe(true);
  });
});
