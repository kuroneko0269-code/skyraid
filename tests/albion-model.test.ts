// 10-3a: 白鯨アルビオンのモデルの重さ（三角形・描画の回数）をネフィルガと比べる。子分はまとめて 1 回で描く。描画そのものはテストしない
import { describe, expect, it } from 'vitest';
import { InstancedMesh, SkinnedMesh } from 'three';
import { AlbionKaiju } from '../src/ai/albion-ai';
import { ALBION_CONFIG as C } from '../src/data/albion';
import { AlbionObject, buildAlbionGeometry } from '../src/render/albion-model/albion-object';
import { buildMinionGeometry } from '../src/render/albion-model/minion-mesh';
import { buildKaiju2Geometries } from '../src/render/kaiju2-model/kaiju2-object';

const DT = 1 / 60;

describe('白鯨アルビオンのモデル（10-3a）', () => {
  it('三角形: 「高」はネフィルガの「高」以下、「低」は 1,500 以下。子分 1 匹は 50 以下（上限の数でも 600 以下）', () => {
    const hi = buildAlbionGeometry('high').triangles;
    const lo = buildAlbionGeometry('low').triangles;
    const nHi = buildKaiju2Geometries('high').triangles;
    const nLo = buildKaiju2Geometries('low').triangles;
    const minion = buildMinionGeometry().getAttribute('position').count / 3;
    console.info(
      `albion triangles high ${String(hi)} / low ${String(lo)}, minion ${String(minion)} × ${String(C.minions.cap)} (nephirga ${String(nHi)} / ${String(nLo)})`,
    );
    expect(hi).toBeLessThanOrEqual(nHi);
    expect(lo).toBeLessThanOrEqual(1500);
    expect(lo).toBeLessThan(hi);
    expect(minion).toBeLessThanOrEqual(50);
    expect(minion * C.minions.cap).toBeLessThanOrEqual(600);
  });

  it('頂点の値に NaN が無く、骨の重みの合計は 1', () => {
    for (const d of ['high', 'low'] as const) {
      const g = buildAlbionGeometry(d).skin;
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
      const w = g.getAttribute('skinWeight');
      for (let i = 0; i < w.count; i++)
        expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 5);
    }
  });

  it('描画の回数: 体 1（SkinnedMesh）+ 子分 1（InstancedMesh）+ 効果は出ているときだけ。動かしても例外・NaN が出ない', () => {
    const obj = new AlbionObject('high');
    let skinned = 0;
    obj.group.traverse((o) => {
      if (o instanceof SkinnedMesh) skinned++;
    });
    expect(skinned).toBe(1);
    expect(obj.minions.mesh).toBeInstanceOf(InstancedMesh);
    expect(obj.minions.mesh.count).toBe(0);
    const hi = obj.triangles;
    obj.setDetail('low');
    expect(obj.triangles).toBeLessThan(hi);
    // 2 分動かして、子分・攻撃の見た目を出す
    const k = new AlbionKaiju(() => 0);
    k.spawn(
      { x: 0, z: 0, axis: 0, halfLength: C.route.halfLength, turnRadius: C.route.turnRadius },
      0,
      11,
      0.5,
    );
    obj.setVisible(true);
    const player = { position: { x: 0, y: 0, z: 0 }, active: true };
    let maxDraws = 0;
    let fxSeen = 0;
    for (let i = 0; i < 120 / DT; i++) {
      player.position.x = k.body.position.x + 100;
      player.position.y = k.body.position.y + 200;
      player.position.z = k.body.position.z;
      k.step(DT, player);
      obj.update(k, 0.5, DT, (j) => k.swarm.minions[j]?.position ?? k.body.position);
      const fx = obj.fx.objects.filter((m) => m.visible).length;
      fxSeen = Math.max(fxSeen, fx);
      maxDraws = Math.max(maxDraws, 1 + (obj.minions.mesh.visible ? 1 : 0) + fx);
    }
    expect(obj.minions.mesh.count).toBe(k.swarm.activeCount);
    expect(fxSeen).toBeGreaterThan(0);
    expect(maxDraws).toBeLessThanOrEqual(4);
    expect(Number.isFinite(obj.group.quaternion.w)).toBe(true);
    expect(Number.isFinite(obj.group.position.y)).toBe(true);
  });
});
