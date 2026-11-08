// 10-7c: メカ怪獣ゴウライの見た目: 描画（形・動きの上乗せ・粒・演出の進行）は判定の状態を変えない（状態のハッシュが同じ。
// 画質 低・中・高）・足した形（頭・あご・腕・爪・背の放熱板・背のとげ・尾）は動かしても体の当たりの箱 + 衝突の余裕の中・
// 画質ごとの重さ（三角形・描く物の数・作る絵の大きさ）・絵は決まった値。描画そのものはテストしない
import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Mesh, SkinnedMesh, Vector3, type Object3D } from 'three';
import { GOURAI_CONFIG, GOURAI_PARTS, GOURAI_TARGET_SPHERES } from '../src/data/gourai';
import { GOURAI_MODEL_CONFIG } from '../src/data/gourai-model';
import { GOURAI_VISUAL } from '../src/data/gourai-visual';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { bayPatrol } from '../src/missions/gourai-dev';
import { GouraiRaid } from '../src/missions/gourai-raid';
import { hashState } from '../src/replay/state-walk';
import { buildCreature } from '../src/render/gourai-model/creature';
import { GouraiObject, buildGouraiGeometry } from '../src/render/gourai-model/gourai-object';
import { GouraiMotion, Servo } from '../src/render/gourai-model/motion';
import { createGouraiSkeleton, GOURAI_BONE } from '../src/render/gourai-model/skeleton';
import { buildGouraiPlatePixels } from '../src/render/gourai-model/textures';
import { KaijuMeshBuilder } from '../src/render/kaiju-model/builder';
import { kaijuTextureBytes } from '../src/render/kaiju-look/noise';
import { createHeightField } from '../src/render/terrain-height';
import { inSpheres, outside } from './gourai-visual-helpers';

const DT = 1 / 60;
const ground = createHeightField(HARBOR_TERRAIN).getGroundHeight;

function makeRaid(): GouraiRaid {
  const r = new GouraiRaid(ground);
  r.reset(true, 'normal');
  const p = bayPatrol({ x: 0, z: 0 });
  r.spawn(p, p.x, p.z - p.radius, Math.PI, 7, { x: 0, z: 0 });
  return r;
}

const sphere = (part: string): number => GOURAI_TARGET_SPHERES.findIndex((s) => s.part === part);

/** 決まった筋書き: 自機は周回し、決まった時刻に砲台・排気口を壊し、後半へ進め、最後に倒して海へ落とす */
function play(render: GouraiObject | null, seconds: number): string[] {
  const r = makeRaid();
  const k = r.kaiju;
  const me = {
    position: { x: 0, y: 300, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    active: true,
    id: 0,
  };
  const hashes: string[] = [];
  const hp = k.parts.maxHp;
  for (let i = 0; i < seconds * 60; i++) {
    const t = i * DT;
    const b = k.body.position;
    me.position.x = b.x + Math.cos(t * 0.3) * 700;
    me.position.z = b.z + Math.sin(t * 0.3) * 700;
    me.position.y = b.y + 60;
    if (i === 300) r.damageSphere(sphere('gunL'), hp * 0.1);
    if (i === 900) r.damageSphere(sphere('exhaustR'), hp * 0.1);
    if (i === 1500) r.damageSphere(sphere('hull'), hp * 0.65);
    if (i === 2400) r.damageSphere(sphere('hull'), hp * 5);
    r.step(DT, me, null, () => undefined);
    if (render) {
      // 描画は 1 ステップに 2 回（alpha・演出の秒数・雨・撃破・海に着いた・沈む・登場の浮かび上がりと目を渡す）
      for (const alpha of [0.3, 0.9]) {
        render.update(k, alpha, DT / 2, me.position, r.flash > 0 ? 1 : 0, {
          camera: { x: me.position.x, y: me.position.y + 20, z: me.position.z + 60 },
          rain: i > 1200 ? 1 : 0,
          dead: r.dead,
          landed: r.dead && r.landedTime >= 0,
          sink: r.dead && r.landedTime >= 0 ? Math.min(1, r.landedTime / 3) : 0,
          rise: i < 240 ? 1 - i / 240 : 0,
          eyes: i < 240 ? i / 240 : 1,
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

describe('メカ怪獣ゴウライの見た目（10-7c）', () => {
  it('描画（形・動きの上乗せ・粒・演出）を動かしても、判定の状態のハッシュは毎秒同じ（部位の破壊・後半・撃破・海に沈むまで）', () => {
    const plain = play(null, 50);
    for (const tier of ['low', 'medium', 'high'] as const) {
      const obj = new GouraiObject(tier);
      obj.setVisible(true);
      expect(play(obj, 50)).toEqual(plain);
    }
  });

  it('筋書きで砲台・排気口が壊れ、後半へ進み、倒して海に着く（演出が動く）', () => {
    const r = makeRaid();
    const k = r.kaiju;
    const me = { position: { x: 0, y: 3000, z: 0 }, active: true };
    r.damageSphere(sphere('gunL'), k.parts.maxHp * 0.1);
    expect(k.parts.isBroken(GOURAI_PARTS.indexOf('gunL'))).toBe(true);
    r.damageSphere(sphere('hull'), k.parts.maxHp * 0.65);
    r.step(DT, me, null, () => undefined);
    expect(k.phase).toBe(2);
    r.damageSphere(sphere('hull'), 1e9);
    expect(r.dead).toBe(true);
    for (let i = 0; i < 60 * 40 && r.landedTime < 0; i++) r.step(DT, me, null, () => undefined);
    expect(r.landedTime).toBeGreaterThanOrEqual(0);
  });

  it('三角形: 「低」は 1,500 以下、「中」「高」は同じ形（ネフィルガ・アルビオンの「高」以下は gourai-model.test.ts）', () => {
    const low = buildGouraiGeometry('low').triangles;
    const high = buildGouraiGeometry('high').triangles;
    console.info(`gourai triangles low ${String(low)} / high ${String(high)}`);
    expect(new GouraiObject('low').triangles).toBe(low);
    expect(new GouraiObject('medium').triangles).toBe(high);
    expect(low).toBeLessThanOrEqual(1500);
  });

  it('作る絵: 「高」で縮めた絵を含めて 2MB 以内・「低」は作らない。どの画素も決まった値（種が同じなら同じ絵）', () => {
    const T = GOURAI_VISUAL.tiers;
    expect(kaijuTextureBytes(T.high.textureSize, 1)).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(kaijuTextureBytes(T.low.textureSize, 1)).toBe(0);
    const a = buildGouraiPlatePixels(64);
    expect(buildGouraiPlatePixels(64)).toEqual(a);
    expect(a.length).toBe(64 * 64 * 4);
    // 継ぎ目（A）がある・無い所もある
    const alpha = Array.from(a).filter((_, i) => i % 4 === 3);
    expect(alpha.some((v) => v > 200)).toBe(true);
    expect(alpha.some((v) => v === 0)).toBe(true);
  });

  it('描く物: 体 1 + 弾 2 + 輪 1 + 粒 6（線・柔らかい粒・光る粒・破片・煙・影）。「低」は筋・影・熱のゆらぎなし', () => {
    const obj = new GouraiObject('high');
    expect(obj.objects.reduce((s, o) => s + countMeshes(o), 0)).toBe(1 + 2 + 1 + 6);
    const low = new GouraiObject('low');
    expect(low.objects.reduce((s, o) => s + countMeshes(o), 0)).toBe(1 + 2 + 1 + 5);
    const L = GOURAI_VISUAL.tiers.low;
    expect(L.streaks).toBe(0);
    expect(L.shadow).toBe(false);
    expect(L.haze).toBe(false);
    expect(L.textureSize).toBe(0);
    // 段を変えても作り直せる
    obj.setDetail('low');
    expect(obj.visualTier).toBe('low');
    expect(obj.triangles).toBe(low.triangles);
  });

  it('油圧のサーボ: 目標に着いて止まる（速さの上限を超えない）', () => {
    const s = new Servo(1.5, 8);
    let last = 0;
    let maxRate = 0;
    for (let i = 0; i < 180; i++) {
      const v = s.step(1, 1 / 60);
      maxRate = Math.max(maxRate, Math.abs(s.x - last) * 60);
      last = s.x;
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(maxRate).toBeLessThanOrEqual(1.5 + 1e-6);
    expect(Math.abs(s.value - 1)).toBeLessThan(0.01);
  });

  it('足した形（頭・あご・腕・爪・背の放熱板・背のとげ・尾）は、レイドの動きと構え・放熱・装甲を捨てる・倒れたでも、体の当たりの箱 + 衝突の余裕（m）の中（頂点ごと。前の装甲の顔と牙は装甲の板と動く）', () => {
    const margin = GOURAI_CONFIG.collision.margin;
    const b = new KaijuMeshBuilder();
    buildCreature(b, GOURAI_MODEL_CONFIG.detail.high);
    const g = b.build();
    const pos = g.getAttribute('position');
    const idx = g.getAttribute('skinIndex');
    const wt = g.getAttribute('skinWeight');
    const rig = createGouraiSkeleton();
    const motion = new GouraiMotion();
    const m = new Matrix4();
    const tmp = new Vector3();
    const out = new Vector3();
    const armor = [GOURAI_BONE.armorL, GOURAI_BONE.armorR];
    let worst = 0;
    let worstRaw = 0;
    let where = '';
    let checked = 0;
    const check = (armored: boolean): void => {
      rig.root.position.y = motion.bob;
      rig.root.updateMatrixWorld(true);
      for (let i = 0; i < pos.count; i++) {
        out.set(0, 0, 0);
        let onArmor = false;
        for (let j = 0; j < 4; j++) {
          const w = wt.getComponent(i, j);
          if (w <= 0) continue;
          const bi = idx.getComponent(i, j);
          if (armor.includes(bi)) onArmor = true;
          const bone = rig.bones[bi];
          const inv = rig.skeleton.boneInverses[bi];
          if (!bone || !inv) continue;
          m.multiplyMatrices(bone.matrixWorld, inv);
          out.add(tmp.fromBufferAttribute(pos, i).applyMatrix4(m).multiplyScalar(w));
        }
        // 前の装甲の顔と牙は装甲の板と一緒に開く・捨てる（10-4a の板の動きのまま）
        if (onArmor) continue;
        const raw = outside(out, armored);
        worstRaw = Math.max(worstRaw, raw);
        const o = raw - margin;
        if (o > worst) {
          worst = o;
          where = `${out.x.toFixed(1)},${out.y.toFixed(1)},${out.z.toFixed(1)} bone ${String(idx.getComponent(i, 0))}`;
        }
        checked++;
      }
    };
    // レイドの動き（自機は周り・正面・上下）。放熱・一斉発射・回転掃射・後半が出る
    const r = makeRaid();
    const k = r.kaiju;
    const me = { position: { x: 0, y: 0, z: 0 }, active: true };
    const dt = 1 / 30;
    for (let f = 0; f < 150 * 30; f++) {
      const t = f * dt;
      const bp = k.body.position;
      me.position.x = bp.x + Math.cos(t * 0.2) * 600;
      me.position.z = bp.z + Math.sin(t * 0.2) * 600;
      me.position.y = bp.y + 200 * Math.sin(t * 0.13);
      if (f === 100 * 30) r.damageSphere(sphere('hull'), k.parts.maxHp * 0.65);
      r.step(dt, me, null, () => undefined);
      const local = new Vector3(me.position.x - bp.x, me.position.y - bp.y, me.position.z - bp.z);
      motion.apply(
        rig,
        {
          action: k.action,
          attack: k.attack,
          actionTime: k.actionTime,
          phase: k.phase,
          heat: Math.min(1, k.heat / 100),
          dead: false,
          purge: k.body.pose.purge,
          aim: local.applyAxisAngle(new Vector3(0, 1, 0), -k.body.heading),
        },
        t,
        dt,
      );
      if (f % 3 === 0) check(k.phase === 1);
    }
    expect(k.vents).toBeGreaterThan(0);
    expect(k.attacksUsed.volley + k.attacksUsed.sweep).toBeGreaterThan(0);
    // 決まった構え（予兆 → 攻撃 → 硬直）・放熱・装甲を捨てる・倒れた
    const scenes = [
      { action: 'windup', attack: 'volley', phase: 1, dead: false },
      { action: 'active', attack: 'sweep', phase: 1, dead: false },
      { action: 'idle', attack: null, phase: 1, dead: false },
      { action: 'vent', attack: null, phase: 1, dead: false },
      { action: 'purge', attack: null, phase: 2, dead: false },
      { action: 'idle', attack: null, phase: 2, dead: true },
    ] as const;
    for (const sc of scenes)
      for (let f = 0; f < 90; f++) {
        motion.apply(
          rig,
          {
            ...sc,
            actionTime: f * dt,
            heat: 1,
            purge: 0,
            aim: new Vector3(Math.sin(f) * 300, 200, -300),
          },
          f * dt,
          dt,
        );
        check(sc.phase === 1);
      }
    console.info(
      `gourai creature parts: out of the hull box up to ${worstRaw.toFixed(2)} m (margin ${String(margin)} m: worst ${worst.toFixed(2)} m ${where}, ${String(checked)} vertex checks)`,
    );
    expect(worst).toBeLessThanOrEqual(0);
  });

  it('参考: 撃てる球（判定の球）の中にある頂点の割合（足した形と 10-4a の形。弾の当たりは変えていない）', () => {
    const share = (all: boolean): number => {
      const b = new KaijuMeshBuilder();
      if (all) {
        const g0 = buildGouraiGeometry('high').skin.getAttribute('position');
        const g1 = (() => {
          buildCreature(b, GOURAI_MODEL_CONFIG.detail.high);
          return b.build().getAttribute('position');
        })();
        // 10-4a の形 = 全体から足した形を除いた頂点（数で割合を出すため、全体 − 足した形）
        return inSpheres(g0) * g0.count - inSpheres(g1) * g1.count > 0
          ? (inSpheres(g0) * g0.count - inSpheres(g1) * g1.count) / (g0.count - g1.count)
          : 0;
      }
      buildCreature(b, GOURAI_MODEL_CONFIG.detail.high);
      return inSpheres(b.build().getAttribute('position'));
    };
    const added = share(false);
    const old = share(true);
    console.info(
      `gourai vertices inside the shot spheres: added parts ${(added * 100).toFixed(0)}% / 10-4a parts ${(old * 100).toFixed(0)}%`,
    );
    expect(added).toBeGreaterThan(0);
  });
});
