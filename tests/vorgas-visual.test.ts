// 10-7e: ヴォルガスの見た目: 描画（形・動きの上乗せ・粒・演出の進行）は判定の状態を変えない（状態のハッシュが同じ。画質 低・中・高）・
// 足した背の骨板は動かしても今の体の面 + 衝突の余裕の中・動きの上乗せは動かしていない形から tolerance m の中・崩れ落ちても地面に
// 埋まりすぎない・画質ごとの重さ（三角形・描く物の数・作る絵の大きさ）・絵は決まった値。描画そのものはテストしない
import { describe, expect, it } from 'vitest';
import { InstancedMesh, Mesh, SkinnedMesh, Triangle, Vector3, type BufferGeometry } from 'three';
import { KaijuAi, type KaijuTarget } from '../src/ai/kaiju-ai';
import { KAIJU_CONFIG, KAIJU_PARTS } from '../src/data/kaiju';
import { KAIJU_MODEL_CONFIG } from '../src/data/kaiju-model';
import type { KaijuTier } from '../src/data/kaiju-look';
import { VORGAS_VISUAL } from '../src/data/vorgas-visual';
import { Kaiju } from '../src/entities/kaiju';
import { createPose, type KaijuPose } from '../src/entities/kaiju-pose';
import { hashState } from '../src/replay/state-walk';
import { buildKaijuGeometries, KaijuObject } from '../src/render/kaiju-model/kaiju-object';
import { kaijuTextureBytes } from '../src/render/kaiju-look/noise';
import { VorgasMotion } from '../src/render/kaiju-model/motion';
import { SKIN_PARTS } from '../src/render/kaiju-model/geometry';
import { animate, createKaijuSkeleton } from '../src/render/kaiju-model/skeleton';
import { buildVorgasSkinPixels } from '../src/render/kaiju-model/textures';
import type { VorgasViewInput } from '../src/render/kaiju-model/vorgas-view';

const DT = 1 / 60;
const flat = (): number => 0;

/** 決まった筋書き: 海から上陸し、自機は前を回り、決まった時刻に結晶・左脚・尾を壊し、最後に倒す */
function play(render: KaijuObject | null, seconds: number): string[] {
  const k = new Kaiju(flat);
  const ai = new KaijuAi(k, { damage: () => undefined, stun: () => undefined });
  k.emerge(0, 0, 0, -10000, { players: 1, raid: true });
  ai.configure({ goal: { x: 0, z: -10000 } });
  const me: KaijuTarget & { position: { x: number; y: number; z: number } } = {
    id: 0,
    position: { x: 0, y: 120, z: -500 },
    hitRadius: 6,
    active: true,
    flareAge: Infinity,
  };
  const part = (id: (typeof KAIJU_PARTS)[number]) => k.part(id);
  const hashes: string[] = [];
  let deadTime = -1;
  for (let i = 0; i < seconds * 60; i++) {
    const t = i * DT;
    me.position.x = k.feet.x + Math.sin(t * 0.25) * 420;
    me.position.z = k.feet.z - Math.cos(t * 0.25) * 420;
    if (i === 900) k.damagePart(part('crystal'), 1e6, 0);
    if (i === 1500) k.damagePart(part('leftLeg'), 1e6, 0);
    if (i === 2700) k.damagePart(part('tail'), 1e6, 0);
    if (i === 3300) k.damagePart(part('head'), 1e7, 0);
    ai.step([me], DT);
    if (render) {
      if (k.stage === 'dead') deadTime = Math.max(0, deadTime) + DT;
      // 描画は 1 ステップに 2 回（alpha・演出の秒数・倒してからの秒数・登場の進みを渡す）
      for (const alpha of [0.3, 0.9]) {
        const view: VorgasViewInput = {
          camera: { x: me.position.x, y: me.position.y + 20, z: me.position.z + 60 },
          target: me.position,
          floor: 0,
          deadTime,
          entrance: i < 300 ? i / 300 : -1,
          fxDt: DT / 2,
        };
        render.update(k, ai, alpha, DT / 2, view, {
          tier: render.tier,
          shown: true,
          clock: null,
          input: () => view,
          measured: () => undefined,
          takeReset: () => false,
          bind: () => undefined,
          impact: () => undefined,
        });
      }
    }
    if (i % 60 === 0) hashes.push(hashState([k, ai]));
  }
  hashes.push(hashState([k, ai]));
  return hashes;
}

/** 点から三角形の集まり（体の面）までの一番近い距離。体の内側は 0 */
function nearest(p: Vector3, tris: readonly Triangle[]): number {
  let best = Infinity;
  let bestTri: Triangle | null = null;
  const q = new Vector3();
  const at = new Vector3();
  for (const t of tris) {
    t.closestPointToPoint(p, q);
    const d = q.distanceToSquared(p);
    if (d < best) {
      best = d;
      bestTri = t;
      at.copy(q);
    }
  }
  if (!bestTri) return Infinity;
  // 6-1 の管の三角形は時計回り（Triangle.getNormal は内向き）
  const n = bestTri.getNormal(new Vector3());
  return n.dot(q.subVectors(p, at)) > 0 ? 0 : Math.sqrt(best);
}

/** ジオメトリの頂点を骨で動かした位置（SkinnedMesh の計算と同じ） */
function posed(mesh: SkinnedMesh, filter?: (i: number) => boolean): Vector3[] {
  const n = mesh.geometry.getAttribute('position').count;
  const out: Vector3[] = [];
  for (let i = 0; i < n; i++) if (!filter || filter(i)) out.push(mesh.getVertexPosition(i, new Vector3()));
  return out;
}

function trianglesOf(mesh: SkinnedMesh, keep: (i: number) => boolean): Triangle[] {
  const g = mesh.geometry;
  const idx = g.index;
  if (!idx) return [];
  const pos = posed(mesh);
  const tris: Triangle[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i);
    if (!keep(a)) continue;
    const pa = pos[a];
    const pb = pos[idx.getX(i + 1)];
    const pc = pos[idx.getX(i + 2)];
    if (pa && pb && pc) tris.push(new Triangle(pa, pb, pc));
  }
  return tris;
}

function skinned(g: BufferGeometry): { mesh: SkinnedMesh; rig: ReturnType<typeof createKaijuSkeleton> } {
  const rig = createKaijuSkeleton();
  const mesh = new SkinnedMesh(g);
  mesh.add(rig.root);
  mesh.bind(rig.skeleton);
  return { mesh, rig };
}

const pose = (o: Partial<KaijuPose>): KaijuPose => ({ ...createPose(), ...o });

describe('ヴォルガスの見た目（10-7e）', () => {
  it('描画（形・動きの上乗せ・粒・演出）を動かしても、判定の状態のハッシュは毎秒同じ（上陸・部位の破壊・ダウン・撃破まで）', () => {
    const base = play(null, 60);
    for (const tier of ['low', 'medium', 'high'] as const) {
      const obj = new KaijuObject(tier);
      expect(play(obj, 60), tier).toEqual(base);
    }
  }, 120_000);

  it('三角形: 「低」は 6-1b のまま（骨板なし）、「中」「高」は骨板の分だけ増える（4 万以下）', () => {
    const lo = buildKaijuGeometries('low');
    const mid = buildKaijuGeometries('medium');
    const hi = buildKaijuGeometries('high');
    expect(lo.scutes).toBeNull();
    expect(lo.triangles).toBeLessThanOrEqual(4000);
    expect(mid.triangles).toBe(hi.triangles);
    expect(hi.triangles).toBeLessThanOrEqual(19500);
    expect(hi.triangles).toBeLessThanOrEqual(40000);
  });

  it('描く物: 体 2（部位をまとめた皮膚 + 結晶）+ 熱線 1 + 岩 1 + 粒 4（柔らかい粒・光る粒・破片・煙。出ているときだけ）', () => {
    const obj = new KaijuObject('high');
    const meshes = obj.drawables.filter((o) => o instanceof Mesh || o instanceof InstancedMesh);
    expect(meshes.length).toBe(8);
    expect(obj.drawables.filter((o) => o instanceof SkinnedMesh).length).toBe(2);
  });

  it('作る絵: 「高」は縮めた絵を含めて 1.5MB 以内・「低」は作らない。どの画素も決まった値', () => {
    expect(VORGAS_VISUAL.tiers.low.textureSize).toBe(0);
    expect(kaijuTextureBytes(VORGAS_VISUAL.tiers.high.textureSize, 1)).toBeLessThanOrEqual(1.5e6);
    const a = buildVorgasSkinPixels(64);
    const b = buildVorgasSkinPixels(64);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.some((v, i) => i % 4 === 3 && v > 128)).toBe(true);
  });

  it('背の骨板は、歩く・薙ぎ払い・咆哮・ダウンでも今の体の面（6-1b の胴と尾）から衝突の余裕（6m）の中（頂点ごと）', () => {
    const g = buildKaijuGeometries('high');
    const scutes = g.scutes;
    if (!scutes) throw new Error('no scutes');
    const torsoTail = SKIN_PARTS.flatMap((p, i) => (i === 0 || i === 4 ? [p] : []));
    const d = KAIJU_MODEL_CONFIG.detail.high;
    let worst = 0;
    for (const [walk, p] of [
      [0, pose({})],
      [0.7, pose({})],
      [1.3, pose({ tailLift: 1 })],
      [0, pose({ headLift: 1 })],
      [0, pose({ bodyDrop: KAIJU_CONFIG.down.bodyDrop })],
    ] as const) {
      const body = torsoTail.map((tp) => skinned(tp.build(d).build()));
      const sc = skinned(scutes);
      for (const s of [...body, sc])
        animate(s.rig, { pose: p, walkPhase: walk, walking: 1, time: 3, roaring: false });
      for (const s of [...body, sc]) s.mesh.updateMatrixWorld(true);
      // 部位ごとの面（胴と尾の管は重なるので、どれかの内側なら 0）
      const parts = body.map((b) => trianglesOf(b.mesh, () => true));
      const dist = (v: Vector3) => Math.min(...parts.map((t) => nearest(v, t)));
      for (const v of posed(sc.mesh)) worst = Math.max(worst, dist(v));
      // 面の向き（外が表）の確かめ: 体のずっと上の点は外
      expect(dist(new Vector3(0, 300, 0))).toBeGreaterThan(100);
    }
    expect(worst).toBeGreaterThan(1);
    expect(worst).toBeLessThanOrEqual(6);
  }, 60_000);

  it('動きの上乗せ（頭が追う・足が着いた沈み・身じろぎ）は、動かしていない形から tolerance m の中（生きている間）', () => {
    const g = buildKaijuGeometries('high');
    const a = skinned(g.skin);
    const b = skinned(g.skin);
    const motion = new VorgasMotion();
    let worst = 0;
    const every = (i: number) => i % 5 === 0;
    for (let f = 0; f < 120; f++) {
      const t = f / 30;
      const input = { pose: createPose(), walkPhase: t * 0.4, walking: 1, time: t, roaring: false };
      animate(a.rig, input);
      animate(b.rig, input);
      if (f % 25 === 0) motion.kickStomp(1);
      if (f === 40) motion.kickFlinch();
      // 自機は右の上（追う角度の上限より外）
      motion.apply(b.rig, new Vector3(600, 400, -300), -1, 1 / 30, t);
      a.mesh.updateMatrixWorld(true);
      b.mesh.updateMatrixWorld(true);
      if (f % 10 !== 9) continue;
      const pa = posed(a.mesh, every);
      const pb = posed(b.mesh, every);
      pa.forEach((v, i) => {
        const w = pb[i];
        if (w) worst = Math.max(worst, v.distanceTo(w));
      });
    }
    expect(worst).toBeGreaterThan(0.5);
    expect(worst).toBeLessThanOrEqual(VORGAS_VISUAL.motion.tolerance);
  });

  it('崩れ落ちた後: 横へ倒れ、地面に埋まりすぎない（一番低い頂点が床から −22m より上。下になる脚の先・胸は 40m より低い）', () => {
    const obj = new KaijuObject('low');
    const k = new Kaiju(flat);
    const ai = new KaijuAi(k, { damage: () => undefined, stun: () => undefined });
    k.emerge(0, 0, 0, -10000, { players: 1 });
    for (let i = 0; i < KAIJU_CONFIG.riseSeconds * 60 + 2; i++) ai.step([], DT);
    k.damagePart(k.part('head'), 1e7, 0);
    expect(k.stage).toBe('dead');
    const view = (deadTime: number): VorgasViewInput => ({
      camera: { x: 0, y: 100, z: 500 },
      target: null,
      floor: 0,
      deadTime,
      entrance: -1,
      fxDt: DT,
    });
    for (let s = 0; s < 260; s++) obj.update(k, ai, 1, DT, view(s * DT * 2));
    const skin = obj.skinMesh;
    skin.updateMatrixWorld(true);
    const pts = posed(skin, (i) => i % 3 === 0);
    const low = Math.min(...pts.map((p) => p.y));
    expect(low).toBeGreaterThan(-22);
    const chest = new Vector3();
    const bone = skin.skeleton.bones.find((x) => x.name === 'chest');
    if (!bone) throw new Error('no chest');
    chest.setFromMatrixPosition(bone.matrixWorld);
    expect(chest.y).toBeLessThan(40);
  });

  it('見た目の段: 画質の機体の細かさ・ブルームから。段を変えるとジオメトリと絵を作り直す', () => {
    const obj = new KaijuObject('high');
    const hi = obj.triangles;
    obj.setDetail('low' satisfies KaijuTier);
    expect(obj.tier).toBe('low');
    expect(obj.triangles).toBeLessThan(hi);
    obj.setDetail('medium');
    expect(obj.triangles).toBe(hi);
  });
});
