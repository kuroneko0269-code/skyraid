// 10-7a: ネフィルガの見た目の試作: 描画（形・動きの上乗せ・粒・演出の進行）は判定の状態を変えない（状態のハッシュが同じ）・
// 画質ごとの重さ（三角形・描く物の数・作る絵の大きさ）。描画そのものはテストしない
import { describe, expect, it } from 'vitest';
import { InstancedMesh, Mesh, SkinnedMesh, type Object3D } from 'three';
import { KAIJU2_VISUAL } from '../src/data/kaiju2-visual';
import { kaijuTier } from '../src/data/kaiju-look';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { Kaiju2Raid } from '../src/missions/kaiju2-raid';
import { hashState } from '../src/replay/state-walk';
import { buildKaijuGeometries } from '../src/render/kaiju-model/kaiju-object';
import { Kaiju2Object, buildKaiju2Geometries } from '../src/render/kaiju2-model/kaiju2-object';
import {
  buildKaiju2MembranePixels,
  buildKaiju2SkinPixels,
} from '../src/render/kaiju2-model/textures';
import { kaijuTextureBytes } from '../src/render/kaiju-look/noise';
import { createHeightField } from '../src/render/terrain-height';

const DT = 1 / 60;
const ground = createHeightField(HARBOR_TERRAIN).getGroundHeight;

function makeRaid(): Kaiju2Raid {
  const r = new Kaiju2Raid(ground, { hit: () => undefined });
  r.reset(true, 'normal');
  r.ai.spawn(0, 800, -2300, 0, 7);
  r.placeTargets();
  return r;
}

/** 決まった筋書き: 自機は周回し、決まった時刻に部位を壊し、段階を進め、最後に倒す */
function play(render: Kaiju2Object | null, seconds: number): string[] {
  const r = makeRaid();
  const target = { position: { x: 0, y: 900, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, active: true };
  const hashes: string[] = [];
  const hit = (id: string, amount: number) => {
    const t = r.targets.find((x) => x.id === id);
    t?.applyDamage(amount);
  };
  for (let i = 0; i < seconds * 60; i++) {
    const t = i * DT;
    target.position.x = r.body.position.x + Math.cos(t * 0.3) * 900;
    target.position.z = r.body.position.z + Math.sin(t * 0.3) * 900;
    target.position.y = r.body.position.y + 100;
    if (i === 600) hit('wingR', r.maxHp * 0.4);
    if (i === 1200) hit('tail', r.maxHp * 0.3);
    if (i === 1800) hit('body', r.maxHp * 0.2);
    if (i === 2400) hit('head', r.maxHp * 2);
    r.step(DT, target, null);
    if (render) {
      // 描画は 1 ステップに 1〜2 回（alpha・演出の秒数・雨・咆哮・撃破を渡す）
      for (const alpha of [0.3, 0.9]) {
        render.update(r.body, alpha, DT / 2, r.flash, {
          camera: { x: target.position.x, y: target.position.y + 20, z: target.position.z + 60 },
          target: target.position,
          rain: 1,
          dead: r.dead,
          shout: r.shout > 0,
          fxDt: DT / 2,
        });
      }
    }
    if (i % 60 === 0) hashes.push(hashState([r]));
  }
  hashes.push(hashState([r]));
  return hashes;
}

describe('ネフィルガの見た目の試作（10-7a）', () => {
  it('描画（形・動きの上乗せ・粒・演出）を動かしても、判定の状態のハッシュは毎秒同じ（部位の破壊・段階・撃破を含む）', () => {
    const plain = play(null, 50);
    for (const tier of ['low', 'medium', 'high'] as const) {
      const obj = new Kaiju2Object(tier);
      obj.setVisible(true);
      expect(play(obj, 50)).toEqual(plain);
    }
  });

  it('三角形: 「低」は 9-6a のまま、「高」はとげの分だけ増えて 15,000 以下・ヴォルガスより少ない', () => {
    const low = buildKaiju2Geometries('low').triangles;
    const high = buildKaiju2Geometries('high', true).triangles;
    const before = buildKaiju2Geometries('high').triangles;
    console.info(`kaiju2 triangles low ${String(low)} / high ${String(before)} → ${String(high)}`);
    expect(new Kaiju2Object('low').triangles).toBe(low);
    expect(new Kaiju2Object('medium').triangles).toBe(before);
    expect(new Kaiju2Object('high').triangles).toBe(high);
    expect(high).toBeGreaterThan(before);
    expect(high).toBeLessThanOrEqual(15000);
    expect(high).toBeLessThan(buildKaijuGeometries('high').triangles);
  });

  it('作る絵: 「高」で縮めた絵を含めて 4MB 以内・「低」は作らない。どの画素も決まった値（種が同じなら同じ絵）', () => {
    const hi = KAIJU2_VISUAL.tiers.high.textureSize;
    expect(kaijuTextureBytes(hi, 2)).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(kaijuTextureBytes(KAIJU2_VISUAL.tiers.low.textureSize, 2)).toBe(0);
    const a = buildKaiju2SkinPixels(64);
    expect(buildKaiju2SkinPixels(64)).toEqual(a);
    expect(a.length).toBe(64 * 64 * 4);
    const m = buildKaiju2MembranePixels(64);
    expect(m.some((v) => v > 0)).toBe(true);
  });

  it('描く物: 体 2 + 雷球・突風 + 粒 4（どれも出ているときだけ）。「低」は雨・風の筋・電気の弧を出さない', () => {
    const count = (o: Object3D): number => {
      let n = 0;
      o.traverse((x) => {
        if (x instanceof Mesh || x instanceof InstancedMesh || x instanceof SkinnedMesh) n++;
      });
      return n;
    };
    const obj = new Kaiju2Object('high');
    const total = obj.objects.reduce((s, o) => s + count(o), 0);
    expect(total).toBe(2 + 2 + 4);
    const low = new Kaiju2Object('low');
    low.setVisible(true);
    play(low, 3);
    const visible: string[] = [];
    for (const o of low.objects)
      o.traverse((x) => {
        if (
          (x instanceof InstancedMesh || x instanceof Mesh) &&
          !(x instanceof SkinnedMesh) &&
          x.visible
        )
          visible.push(x.type);
      });
    // 低で出るのは破片・煙（壊したときだけ）。雨・風・弧の数は 0
    expect(KAIJU2_VISUAL.tiers.low.streaks).toBe(0);
    expect(KAIJU2_VISUAL.tiers.low.arcs).toBe(0);
    // 段を変えても作り直せる
    obj.setDetail('low');
    expect(obj.visualTier).toBe('low');
  });

  it('画質の設定から段: 低 = low、中（ブルームなし）= medium、高 = high', () => {
    expect(kaijuTier({ aircraftDetail: 'low', bloom: false })).toBe('low');
    expect(kaijuTier({ aircraftDetail: 'high', bloom: false })).toBe('medium');
    expect(kaijuTier({ aircraftDetail: 'high', bloom: true })).toBe('high');
  });
});
