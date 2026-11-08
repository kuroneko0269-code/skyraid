// 10-4a: メカ怪獣ゴウライのモデルの重さ（三角形・描画の回数）をネフィルガ・アルビオンと比べる。弾はまとめて 2 回で描く。
// 描画そのものはテストしない
import { describe, expect, it } from 'vitest';
import { InstancedMesh, SkinnedMesh } from 'three';
import { GouraiKaiju } from '../src/ai/gourai-ai';
import { GOURAI_CONFIG as C } from '../src/data/gourai';
import { buildAlbionGeometry } from '../src/render/albion-model/albion-object';
import { GouraiObject, buildGouraiGeometry } from '../src/render/gourai-model/gourai-object';
import { buildShotGeometry } from '../src/render/gourai-model/shot-mesh';
import { buildKaiju2Geometries } from '../src/render/kaiju2-model/kaiju2-object';

const DT = 1 / 60;

describe('メカ怪獣ゴウライのモデル（10-4a）', () => {
  it('三角形: 「高」はネフィルガ・アルビオンの「高」以下、「低」は 1,500 以下。弾 1 発は 8（上限の数でも 20,000 以下）', () => {
    const hi = buildGouraiGeometry('high').triangles;
    const lo = buildGouraiGeometry('low').triangles;
    const nHi = buildKaiju2Geometries('high').triangles;
    const nLo = buildKaiju2Geometries('low').triangles;
    const aHi = buildAlbionGeometry('high').triangles;
    const aLo = buildAlbionGeometry('low').triangles;
    const shot = buildShotGeometry(0xffffff, 0).getAttribute('position').count / 3;
    console.info(
      `gourai triangles high ${String(hi)} / low ${String(lo)}, shot ${String(shot)} × ${String(C.shotCap)} (nephirga ${String(nHi)} / ${String(nLo)}, albion ${String(aHi)} / ${String(aLo)})`,
    );
    expect(hi).toBeLessThanOrEqual(Math.min(nHi, aHi));
    expect(lo).toBeLessThanOrEqual(1500);
    expect(lo).toBeLessThan(hi);
    expect(shot).toBe(8);
    // 10-4b: プール 480 発（回転掃射の弾の筋を詰めた）。10-4c: 2,400 発（回転掃射の弾を 2 つの輪の縦の幅に散らした）。
    // 上限の数で 20,000 以下（1 フレームの三角形の予算 100 万の 2%。描画は弾の種類ごとに 1 回のまま）
    expect(shot * C.shotCap).toBeLessThanOrEqual(20000);
  });

  it('頂点の値に NaN が無く、骨の重みの合計は 1', () => {
    for (const d of ['high', 'low'] as const) {
      const g = buildGouraiGeometry(d).skin;
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
      const nrm = g.getAttribute('normal');
      for (let i = 0; i < nrm.count; i++)
        expect(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i))).toBeCloseTo(1, 4);
      const w = g.getAttribute('skinWeight');
      for (let i = 0; i < w.count; i++)
        expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 5);
    }
  });

  it('描画の回数: 体 1（SkinnedMesh）+ 弾 2（InstancedMesh）+ 輪は出ているときだけ = 4 以下。動かしても例外・NaN が出ない', () => {
    const obj = new GouraiObject('high');
    let skinned = 0;
    obj.group.traverse((o) => {
      if (o instanceof SkinnedMesh) skinned++;
    });
    expect(skinned).toBe(1);
    expect(obj.shots.meshes.every((m) => m instanceof InstancedMesh)).toBe(true);
    const hi = obj.triangles;
    obj.setDetail('low');
    expect(obj.triangles).toBeLessThan(hi);
    // 3 分動かして、弾・一斉発射・回転掃射・放熱・後半を出す
    const k = new GouraiKaiju(() => 0);
    k.spawn({ x: 0, z: 0, radius: C.patrol.radius }, 0, -C.patrol.radius, 0, 11);
    k.immortal = true;
    obj.setVisible(true);
    const player = { position: { x: 0, y: 0, z: 0 }, active: true, id: 0 };
    let maxDraws = 0;
    let ringSeen = false;
    let maxShots = 0;
    for (let i = 0; i < 180 / DT; i++) {
      const a = i * DT * 0.2;
      player.position.x = k.body.position.x + Math.cos(a) * 700;
      player.position.y = k.body.position.y + 20;
      player.position.z = k.body.position.z + Math.sin(a) * 700;
      if (i === Math.floor(120 / DT)) k.parts.partHp[2] = 0;
      k.step(DT, player);
      obj.update(k, 0.5, DT, player.position);
      ringSeen ||= obj.sweepRing.visible;
      maxShots = Math.max(
        maxShots,
        obj.shots.meshes.reduce((s, m) => s + m.count, 0),
      );
      maxDraws = Math.max(maxDraws, obj.draws);
    }
    expect(k.vents).toBeGreaterThan(0);
    expect(k.phase).toBe(2);
    expect(ringSeen).toBe(true);
    expect(maxShots).toBeGreaterThan(50);
    expect(maxDraws).toBeLessThanOrEqual(4);
    expect(Number.isFinite(obj.group.quaternion.w)).toBe(true);
    expect(Number.isFinite(obj.group.position.y)).toBe(true);
    console.info(`gourai draws max ${String(maxDraws)}, shots drawn max ${String(maxShots)}`);
  });
});
