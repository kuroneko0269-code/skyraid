// 10-5a: UFO ゼノリスのモデルの重さ（三角形・描画の回数）をほかの怪獣と比べる。効果（バリア・光線・瞬間移動の光）は出ているときだけ描く。
// 描画そのものはテストしない
import { describe, expect, it } from 'vitest';
import { InstancedMesh, SkinnedMesh } from 'three';
import { XenolithKaiju } from '../src/ai/xenolith-ai';
import { buildAlbionGeometry } from '../src/render/albion-model/albion-object';
import { buildGouraiGeometry } from '../src/render/gourai-model/gourai-object';
import { buildKaiju2Geometries } from '../src/render/kaiju2-model/kaiju2-object';
import {
  XenolithObject,
  buildXenolithGeometry,
} from '../src/render/xenolith-model/xenolith-object';

const DT = 1 / 60;

describe('UFO ゼノリスのモデル（10-5a）', () => {
  it('三角形: 「高」は 2,000 以下でアルビオン・ネフィルガの「高」以下（丸い円盤なのでゴウライの箱より多い）、「低」は 1,000 以下で「高」より軽い', () => {
    const hi = buildXenolithGeometry('high').triangles;
    const lo = buildXenolithGeometry('low').triangles;
    const g = [buildGouraiGeometry('high').triangles, buildGouraiGeometry('low').triangles];
    const a = [buildAlbionGeometry('high').triangles, buildAlbionGeometry('low').triangles];
    const n = [buildKaiju2Geometries('high').triangles, buildKaiju2Geometries('low').triangles];
    console.info(
      `xenolith triangles high ${String(hi)} / low ${String(lo)} (gourai ${g.join(' / ')}, albion ${a.join(' / ')}, nephirga ${n.join(' / ')})`,
    );
    expect(hi).toBeLessThanOrEqual(Math.min(2000, a[0] ?? 0, n[0] ?? 0));
    expect(lo).toBeLessThanOrEqual(1000);
    expect(lo).toBeLessThan(hi);
  });

  it('頂点の値に NaN が無く、法線は長さ 1、骨の重みの合計は 1', () => {
    for (const d of ['high', 'low'] as const) {
      const geo = buildXenolithGeometry(d).skin;
      const pos = geo.getAttribute('position');
      for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
      const nrm = geo.getAttribute('normal');
      for (let i = 0; i < nrm.count; i++)
        expect(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i))).toBeCloseTo(1, 4);
      const w = geo.getAttribute('skinWeight');
      for (let i = 0; i < w.count; i++)
        expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 5);
    }
  });

  it('描画の回数: 体 1（SkinnedMesh）+ 殻・光線・柱と輪は出ているときだけ = 5 以下。3 分動かしても例外・NaN が出ない', () => {
    const obj = new XenolithObject('high');
    let skinned = 0;
    obj.group.traverse((o) => {
      if (o instanceof SkinnedMesh) skinned++;
    });
    expect(skinned).toBe(1);
    expect(obj.beam.mesh).toBeInstanceOf(InstancedMesh);
    const hi = obj.triangles;
    obj.setDetail('low');
    expect(obj.triangles).toBeLessThan(hi);
    const k = new XenolithKaiju(() => 0);
    k.spawn(0, 600, -1500, 0, 11, 0.5, ['gen0', 'emitter2']);
    k.immortal = true;
    obj.setVisible(true);
    const player = { position: { x: 0, y: 500, z: 0 }, active: true, id: 0 };
    let maxDraws = 0;
    let minDraws = 99;
    const seen = { barrier: false, beam: false, warp: false };
    for (let i = 0; i < 180 / DT; i++) {
      const a = i * DT * 0.15;
      player.position.x = Math.cos(a) * 1200;
      player.position.z = Math.sin(a) * 1200;
      if (i % 90 === 0) k.damageSphere(1, 1);
      k.step(DT, player);
      obj.update(k, 0.5, DT, 0);
      seen.barrier ||= obj.barrier.visible;
      seen.beam ||= obj.beam.mesh.visible;
      seen.warp ||= obj.objects.some(
        (o) => o !== obj.group && o !== obj.barrier && o !== obj.beam.mesh && o.visible,
      );
      maxDraws = Math.max(maxDraws, obj.draws);
      minDraws = Math.min(minDraws, obj.draws);
    }
    expect(seen).toEqual({ barrier: true, beam: true, warp: true });
    expect(maxDraws).toBeLessThanOrEqual(5);
    expect(minDraws).toBe(1);
    expect(Number.isFinite(obj.group.quaternion.w)).toBe(true);
    expect(Number.isFinite(obj.group.position.y)).toBe(true);
    console.info(`xenolith draws ${String(minDraws)}〜${String(maxDraws)}`);
  });
});
