// 10-7d: UFO ゼノリスの見た目: 描画（形・動き・粒・光の効果・演出の進行）は判定の状態を変えない（状態のハッシュが同じ。画質 低・中・高）・
// 足した飾り（結晶の冠・浮かぶ光の輪 2 つ）は動かしても体の当たり（円盤の楕円体とドーム + 衝突の余裕）の中・画質ごとの重さ
// （三角形・描く物の数）・絵は作らない。描画そのものはテストしない
import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Mesh, SkinnedMesh, Vector3, type Object3D } from 'three';
import { xenolithPenetrationLocal } from '../src/ai/xenolith-hull';
import type { HullHit } from '../src/ai/albion-hull';
import { XENOLITH_CONFIG, XENOLITH_TARGET_SPHERES } from '../src/data/xenolith';
import { XENOLITH_MODEL_CONFIG } from '../src/data/xenolith-model';
import { XENOLITH_VISUAL } from '../src/data/xenolith-visual';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { XenolithRaid } from '../src/missions/xenolith-raid';
import { hashState } from '../src/replay/state-walk';
import { KaijuMeshBuilder } from '../src/render/kaiju-model/builder';
import { buildXenolithOrnaments } from '../src/render/xenolith-model/ornaments';
import { createXenolithSkeleton, XENOLITH_BONE } from '../src/render/xenolith-model/skeleton';
import { animateXenolithParts } from '../src/render/xenolith-model/xenolith-animate';
import {
  XenolithObject,
  buildXenolithGeometry,
} from '../src/render/xenolith-model/xenolith-object';
import { createHeightField } from '../src/render/terrain-height';

const DT = 1 / 60;
const ground = createHeightField(HARBOR_TERRAIN).getGroundHeight;

function makeRaid(): XenolithRaid {
  const r = new XenolithRaid(ground);
  r.reset(true, 'normal');
  r.spawn(0, 900, 2000, 0, 7, { x: 0, z: 0 });
  return r;
}

const sphere = (part: string): number => XENOLITH_TARGET_SPHERES.findIndex((s) => s.part === part);

/** 決まった筋書き: 自機は周回し、決まった時刻に発光体・発生器・ドームを壊し、段階を進め、最後に倒して海へ落とす */
function play(render: XenolithObject | null, seconds: number): string[] {
  const r = makeRaid();
  const k = r.kaiju;
  const me = {
    position: { x: 0, y: 900, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    active: true,
    id: 0,
  };
  const hashes: string[] = [];
  const hp = k.parts.maxHp;
  for (let i = 0; i < seconds * 60; i++) {
    const t = i * DT;
    me.position.x = Math.cos(t * 0.25) * 900;
    me.position.z = Math.sin(t * 0.25) * 900;
    me.velocity.x = -Math.sin(t * 0.25) * 225;
    me.velocity.z = Math.cos(t * 0.25) * 225;
    if (i === 600) r.damageSphere(sphere('emitter1'), hp);
    if (i === 900) r.damageSphere(sphere('gen0'), hp);
    if (i === 1500) {
      k.barrier.phase = 'down';
      r.damageSphere(sphere('dome'), hp * 0.5);
    }
    if (i === 2700) {
      k.barrier.phase = 'down';
      r.damageSphere(sphere('hull'), hp * 5);
    }
    r.step(DT, me, () => undefined);
    if (render) {
      // 描画は 1 ステップに 2 回（alpha・演出の秒数・雨・撃破・海に着いた・沈む・登場の高さを渡す）
      for (const alpha of [0.3, 0.9]) {
        const landed = r.dead && r.landedTime >= 0;
        render.update(k, alpha, DT / 2, r.flash > 0 ? 1 : 0, {
          camera: { x: me.position.x, y: me.position.y + 20, z: me.position.z + 60 },
          rain: i > 1200 ? 1 : 0,
          dead: r.dead,
          landed,
          sink: landed ? Math.min(1, r.landedTime / 2.5) : 0,
          descend: i < 240 ? 1 - i / 240 : 0,
          fxDt: DT / 2,
        });
      }
    }
    if (i % 60 === 0) hashes.push(hashState([r]));
  }
  hashes.push(hashState([r]));
  return hashes;
}

const countMeshes = (o: Object3D): number => {
  let n = 0;
  o.traverse((x) => {
    if (x instanceof Mesh || x instanceof InstancedMesh || x instanceof SkinnedMesh) n++;
  });
  return n;
};

describe('UFO ゼノリスの見た目（10-7d）', () => {
  it('描画（形・動き・粒・光の効果・演出）を動かしても、判定の状態のハッシュは毎秒同じ（急停止・瞬間移動・光線・部位の破壊・撃破・海まで）', () => {
    const plain = play(null, 60);
    for (const tier of ['low', 'medium', 'high'] as const) {
      const obj = new XenolithObject(tier);
      obj.setVisible(true);
      expect(play(obj, 60)).toEqual(plain);
    }
  });

  it('筋書きで急停止・瞬間移動・光線・部位の破壊・撃破・海に着く（演出が動く）', () => {
    const r = makeRaid();
    const k = r.kaiju;
    const me = { position: { x: 0, y: 900, z: 0 }, active: true, id: 0 };
    const moves = new Set<string>();
    for (let i = 0; i < 60 * 40; i++) {
      r.step(DT, me, () => undefined);
      moves.add(k.body.move);
    }
    expect(moves).toEqual(new Set(['cruise', 'stop', 'dash', 'hold']));
    expect(k.warp.warps).toBeGreaterThan(0);
    expect(k.attacksUsed.sweep + k.attacksUsed.charged).toBeGreaterThan(0);
    k.barrier.phase = 'down';
    r.damageSphere(sphere('hull'), 1e9);
    expect(r.dead).toBe(true);
    for (let i = 0; i < 60 * 60 && r.landedTime < 0; i++) r.step(DT, me, () => undefined);
    expect(r.landedTime).toBeGreaterThanOrEqual(0);
  });

  it('三角形: 「低」は 1,000 以下、「中」「高」は同じ形で 3,000 以下（足した飾りの分）', () => {
    const low = buildXenolithGeometry('low').triangles;
    const high = buildXenolithGeometry('high').triangles;
    console.info(`xenolith triangles low ${String(low)} / high ${String(high)}`);
    expect(new XenolithObject('low').triangles).toBe(low);
    expect(new XenolithObject('medium').triangles).toBe(high);
    expect(low).toBeLessThanOrEqual(1000);
    expect(high).toBeLessThanOrEqual(3000);
  });

  it('描く物: 体 1 + 殻 1 + 光線 1 + 柱と輪 2 + 光の弾 1 + 粒（星・波・柔らかい粒・破片・煙・尾・弧・影）。「低」は尾・弧・影なし。絵は作らない', () => {
    const obj = new XenolithObject('high');
    expect(obj.objects.reduce((s, o) => s + countMeshes(o), 0)).toBe(1 + 1 + 1 + 2 + 1 + 8);
    const low = new XenolithObject('low');
    expect(low.objects.reduce((s, o) => s + countMeshes(o), 0)).toBe(1 + 1 + 1 + 2 + 1 + 5);
    const L = XENOLITH_VISUAL.tiers.low;
    expect(L.trail).toBe(false);
    expect(L.shadow).toBe(false);
    expect(L.arcs).toBe(0);
    expect(L.surfaceDetail).toBe(false);
    // 段を変えても作り直せる
    obj.setDetail('low');
    expect(obj.visualTier).toBe('low');
    expect(obj.triangles).toBe(low.triangles);
    obj.setDetail('medium');
    expect(obj.visualTier).toBe('medium');
  });

  it('足した飾り（結晶の冠・浮かぶ光の輪 2 つ）は、輪が回り・浮かぶ揺れとつんのめりが一番大きいときも、体の当たり（円盤の楕円体とドーム）+ 衝突の余裕の中（頂点ごと）', () => {
    const margin = XENOLITH_CONFIG.collision.margin;
    const V = XENOLITH_VISUAL.motion;
    for (const detail of ['high', 'low'] as const) {
      const b = new KaijuMeshBuilder();
      buildXenolithOrnaments(b, XENOLITH_MODEL_CONFIG.detail[detail].segments, detail);
      const g = b.build();
      const pos = g.getAttribute('position');
      const idx = g.getAttribute('skinIndex');
      const rig = createXenolithSkeleton();
      const r = makeRaid();
      const m = new Matrix4();
      const p = new Vector3();
      const hit: HullHit = { depth: 0, normal: { x: 0, y: 0, z: 0 }, shape: 'body' };
      let outside = 0;
      let checked = 0;
      for (let f = 0; f < 120; f++) {
        r.kaiju.body.spin = f * 0.21;
        r.kaiju.body.prevSpin = r.kaiju.body.spin;
        animateXenolithParts(rig, r.kaiju, 1, f * 0.37);
        // 描画だけの動き: 浮かぶ揺れ（上下）・つんのめり（前へ傾く）の一番大きいとき
        rig.root.position.y = (f % 2 === 0 ? 1 : -1) * V.bob;
        rig.root.rotation.x = (f % 3 === 0 ? -1 : 1) * V.stopTilt;
        rig.root.updateMatrixWorld(true);
        for (let i = 0; i < pos.count; i++) {
          const bi = idx.getComponent(i, 0);
          const bone = rig.bones[bi];
          const inv = rig.skeleton.boneInverses[bi];
          if (!bone || !inv) continue;
          m.multiplyMatrices(bone.matrixWorld, inv);
          p.fromBufferAttribute(pos, i).applyMatrix4(m);
          checked++;
          if (!xenolithPenetrationLocal(p.x, p.y, p.z, margin, hit)) outside++;
        }
      }
      console.info(
        `xenolith ornaments (${detail}): ${String(outside)} / ${String(checked)} vertex checks outside the hull + margin ${String(margin)} m`,
      );
      expect(outside).toBe(0);
      expect(XENOLITH_BONE.halo).toBeGreaterThan(0);
    }
  });

  it('参考: 「中」「高」の光の効果（バリアの六角・光線の 2 層・光の弾のきらめき・遠くの目印）を出しても 3 分で例外・NaN が出ない', () => {
    const obj = new XenolithObject('high');
    const r = makeRaid();
    const k = r.kaiju;
    obj.setVisible(true);
    const me = { position: { x: 0, y: 900, z: 0 }, active: true, id: 0 };
    let max = 0;
    for (let i = 0; i < 180 * 60; i++) {
      const t = i * DT;
      me.position.x = Math.cos(t * 0.2) * 1400;
      me.position.z = Math.sin(t * 0.2) * 1400;
      r.step(DT, me, () => undefined);
      obj.update(k, 0.5, DT, 0, {
        camera: me.position,
        rain: 0,
        dead: false,
        landed: false,
        sink: 0,
        descend: 0,
        fxDt: DT,
      });
      max = Math.max(max, obj.draws);
    }
    expect(Number.isFinite(obj.group.position.y)).toBe(true);
    console.info(`xenolith draws up to ${String(max)}`);
    expect(max).toBeLessThanOrEqual(16);
  });
});
