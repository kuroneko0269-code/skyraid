// 10-7b: 白鯨アルビオンの見た目: 描画（形・動きの上乗せ・粒・演出の進行）は判定の状態を変えない（状態のハッシュが同じ。
// 画質 低・中・高）・画質ごとの重さ（三角形・描く物の数・作る絵の大きさ）・絵は決まった値。描画そのものはテストしない
import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Mesh, SkinnedMesh, Vector3, type Object3D } from 'three';
import { createHullContact, hullPenetration } from '../src/ai/albion-hull';
import { AlbionBody } from '../src/entities/albion/albion-body';
import { AlbionMotion } from '../src/render/albion-model/motion';
import {
  ALBION_BONE,
  animateAlbion,
  createAlbionSkeleton,
  type AlbionSkeleton,
} from '../src/render/albion-model/skeleton';
import { ALBION_VISUAL } from '../src/data/albion-visual';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { bayRoute } from '../src/missions/albion-dev';
import { AlbionRaid } from '../src/missions/albion-raid';
import { hashState } from '../src/replay/state-walk';
import { AlbionObject, buildAlbionGeometry } from '../src/render/albion-model/albion-object';
import { buildAlbionSkinPixels } from '../src/render/albion-model/textures';
import { buildKaiju2Geometries } from '../src/render/kaiju2-model/kaiju2-object';
import { kaijuTextureBytes } from '../src/render/kaiju-look/noise';
import { createHeightField } from '../src/render/terrain-height';

const DT = 1 / 60;
const ground = createHeightField(HARBOR_TERRAIN).getGroundHeight;

function makeRaid(): AlbionRaid {
  const r = new AlbionRaid(ground);
  r.reset(true, 'normal');
  r.spawn(bayRoute({ x: 0, z: 0 }), 0, 7, { x: 0, z: 0 });
  return r;
}

/** 決まった筋書き: 自機は周回し、決まった時刻に巣・背びれ・頭を壊し、段階を進め、最後に倒して海へ落とす */
function play(render: AlbionObject | null, seconds: number): string[] {
  const r = makeRaid();
  const k = r.kaiju;
  const me = { position: { x: 0, y: 900, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, active: true };
  const hashes: string[] = [];
  const hit = (id: string, ratio: number) => {
    r.damagePart(k.parts.indexOf(id), k.parts.maxHp * ratio);
  };
  for (let i = 0; i < seconds * 60; i++) {
    const t = i * DT;
    const b = k.body.position;
    me.position.x = b.x + Math.cos(t * 0.25) * 900;
    me.position.z = b.z + Math.sin(t * 0.25) * 900;
    me.position.y = b.y + 150;
    if (i === 300) hit('nestMid', 0.2);
    if (i === 900) hit('dorsal', 0.2);
    if (i === 1500) hit('body', 0.45);
    if (i === 2100) hit('head', 0.2);
    if (i === 2700) hit('body', 5);
    r.step(DT, me, () => undefined);
    if (render) {
      // 描画は 1 ステップに 2 回（alpha・演出の秒数・雨・撃破・海に着いた・雲の幕を渡す）
      for (const alpha of [0.3, 0.9]) {
        render.update(k, alpha, DT / 2, (j) => k.swarm.minions[j]?.position ?? b, r.flash, {
          camera: { x: me.position.x, y: me.position.y + 20, z: me.position.z + 60 },
          rain: i > 1200 ? 1 : 0,
          dead: r.dead,
          landed: r.dead && r.landedTime >= 0,
          veil: i < 200 ? 1 - i / 200 : 0,
          fxDt: DT / 2,
        });
      }
      if (i === 60) render.cloudBank();
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

describe('白鯨アルビオンの見た目（10-7b）', () => {
  it('描画（形・動きの上乗せ・粒・演出）を動かしても、判定の状態のハッシュは毎秒同じ（部位の破壊・段階・撃破・海に落ちるまで）', () => {
    const plain = play(null, 56);
    for (const tier of ['low', 'medium', 'high'] as const) {
      const obj = new AlbionObject(tier);
      obj.setVisible(true);
      expect(play(obj, 56)).toEqual(plain);
    }
  });

  it('筋書きで撃破して海に着く（水柱の演出が動く）', () => {
    const r = makeRaid();
    const me = { position: { x: 0, y: 2000, z: 0 }, active: true };
    r.damagePart(r.kaiju.parts.indexOf('body'), 1e9);
    expect(r.dead).toBe(true);
    for (let i = 0; i < 60 * 40 && r.landedTime < 0; i++) r.step(DT, me, () => undefined);
    expect(r.landedTime).toBeGreaterThanOrEqual(0);
  });

  it('三角形: 「低」は 1,500 以下（あご・口の分だけ増える）、「高」はネフィルガの「高」以下', () => {
    const low = buildAlbionGeometry('low').triangles;
    const high = buildAlbionGeometry('high').triangles;
    console.info(`albion triangles low ${String(low)} / high ${String(high)}`);
    expect(new AlbionObject('low').triangles).toBe(low);
    expect(new AlbionObject('medium').triangles).toBe(high);
    expect(low).toBeLessThanOrEqual(1500);
    expect(high).toBeLessThanOrEqual(buildKaiju2Geometries('high', true).triangles);
  });

  it('作る絵: 「高」で縮めた絵を含めて 2MB 以内・「低」は作らない。どの画素も決まった値（種が同じなら同じ絵）', () => {
    const T = ALBION_VISUAL.tiers;
    expect(kaijuTextureBytes(T.high.textureSize, 1)).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(kaijuTextureBytes(T.low.textureSize, 1)).toBe(0);
    const a = buildAlbionSkinPixels(64);
    expect(buildAlbionSkinPixels(64)).toEqual(a);
    expect(a.length).toBe(64 * 64 * 4);
    // フジツボ（A）がある
    expect(Array.from(a).some((v, i) => i % 4 === 3 && v > 128)).toBe(true);
  });

  it('描く物: 体 1 + 子分 1 + 攻撃 6（出ているときだけ）+ 粒 6（線・柔らかい粒・破片・煙・鳥・影）。「低」は筋・鳥・影・流れる雲なし', () => {
    const obj = new AlbionObject('high');
    const total = obj.objects.reduce((s, o) => s + countMeshes(o), 0);
    expect(total).toBe(1 + 1 + 6 + 6);
    const low = new AlbionObject('low');
    expect(low.objects.reduce((s, o) => s + countMeshes(o), 0)).toBe(1 + 1 + 6 + 5);
    const L = ALBION_VISUAL.tiers.low;
    expect(L.streaks).toBe(0);
    expect(L.birds).toBe(0);
    expect(L.shadow).toBe(false);
    expect(L.wispEvery).toBe(0);
    // 段を変えても作り直せる
    obj.setDetail('low');
    expect(obj.visualTier).toBe('low');
    expect(obj.triangles).toBe(low.triangles);
  });

  it('泳ぐ動き（描画だけの上下の揺れ・胸びれの舵・身じろぎ・口）は、判定の形（尾の打ち・うねり）からのずれが motion.tolerance の中（頂点ごと。下あごは当たりの形の中）', () => {
    const MO = ALBION_VISUAL.motion;
    const g = buildAlbionGeometry('low').skin;
    const pos = g.getAttribute('position');
    const idx = g.getAttribute('skinIndex');
    const wt = g.getAttribute('skinWeight');
    const rigA = createAlbionSkeleton();
    const rigB = createAlbionSkeleton();
    const motion = new AlbionMotion();
    const r = makeRaid();
    const k = r.kaiju;
    const me = { position: { x: 0, y: 900, z: 0 }, active: true };
    const hullBody = new AlbionBody(() => 0);
    const hit = createHullContact();
    const m = new Matrix4();
    const tmp = new Vector3();
    const skin = (rig: AlbionSkeleton, i: number, out: Vector3): Vector3 => {
      out.set(0, 0, 0);
      for (let j = 0; j < 4; j++) {
        const w = wt.getComponent(i, j);
        if (w <= 0) continue;
        const b = idx.getComponent(i, j);
        const bone = rig.bones[b];
        const inv = rig.skeleton.boneInverses[b];
        if (!bone || !inv) continue;
        m.multiplyMatrices(bone.matrixWorld, inv);
        out.add(tmp.fromBufferAttribute(pos, i).applyMatrix4(m).multiplyScalar(w));
      }
      return out;
    };
    const a = new Vector3();
    const b = new Vector3();
    let worst = 0;
    let jawOut = 0;
    const dt = 1 / 30;
    for (let f = 0; f < 90 * 30; f++) {
      const t = f * dt;
      const bp = k.body.position;
      me.position.x = bp.x + Math.cos(t * 0.3) * 700;
      me.position.z = bp.z + Math.sin(t * 0.3) * 700;
      me.position.y = bp.y + 250;
      if (f === 300) r.damagePart(k.parts.indexOf('body'), k.parts.maxHp * 0.45);
      if (f % 90 === 0) motion.kick(1.4);
      r.step(dt, me, () => undefined);
      const broken = { dorsal: false, tail: false };
      animateAlbion(rigA, k.body.pose, broken);
      animateAlbion(rigB, k.body.pose, broken);
      motion.apply(
        rigB,
        { pose: k.body.pose, bank: k.body.bank, roar: f % 600 < 200 ? 1 : 0, dead: false },
        t,
        dt,
      );
      rigB.root.position.y = motion.bob;
      rigA.root.updateMatrixWorld(true);
      rigB.root.updateMatrixWorld(true);
      Object.assign(hullBody.pose, k.body.pose);
      for (let i = 0; i < pos.count; i += 2) {
        skin(rigA, i, a);
        skin(rigB, i, b);
        const onJaw = [0, 1, 2, 3].some(
          (j) => idx.getComponent(i, j) === ALBION_BONE.jaw && wt.getComponent(i, j) > 0,
        );
        if (onJaw) {
          // 下あごは当たりの形（+ 許し）の中
          if (!hullPenetration(hullBody, { x: b.x, y: b.y, z: b.z }, MO.tolerance, hit)) jawOut++;
        } else worst = Math.max(worst, a.distanceTo(b));
      }
    }
    console.info(
      `albion render-only motion: max ${worst.toFixed(2)} m (tolerance ${String(MO.tolerance)} m - breath ${String(ALBION_VISUAL.breath.amount)} m)`,
    );
    expect(worst).toBeGreaterThan(0.2);
    expect(worst + ALBION_VISUAL.breath.amount).toBeLessThanOrEqual(MO.tolerance);
    expect(jawOut).toBe(0);
  });
});
