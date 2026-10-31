// 6-4: 街の建物の判定（高層の衝突・爆弾とロケットの着弾）・破壊（崩れる・怪獣・熱線・爆弾）・守れた建物
import { describe, expect, it } from 'vitest';
import { KaijuAi } from '../src/ai/kaiju-ai';
import { BuildingField, protectedPercent, segmentHitsBox } from '../src/combat/buildings';
import { applyKaijuToCity } from '../src/combat/city-damage';
import { createCombatInput } from '../src/combat/combat-system';
import { CITY_CONFIG } from '../src/data/city';
import { RAID_CONFIG } from '../src/data/kaiju';
import { HARBOR_MAP } from '../src/data/maps';
import { RAID_MISSION } from '../src/data/missions-special';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { Kaiju } from '../src/entities/kaiju';
import { ActiveMap } from '../src/missions/active-map';
import { FlightSession } from '../src/missions/flight-session';
import { generateCity } from '../src/render/city/layout';
import { createHeightField } from '../src/render/terrain-height';

const harbor = createHeightField(HARBOR_TERRAIN);
const city = generateCity();

describe('建物の判定', () => {
  const tower = city.buildings.find((b) => b.kind === 'tower');
  const low = city.buildings.find((b) => b.kind === 'low');
  if (!tower || !low) throw new Error('建物がない');
  const shaft = tower.parts[1];
  if (!shaft) throw new Error('塔');

  it('高層（40m 以上）は AABB で衝突し、低層は飛び抜けられる。崩れたら当たらない', () => {
    const f = new BuildingField(city);
    const y = tower.base + shaft.h * 0.6;
    // 塔の中を短く横切る（隣の建物にかからない長さ）
    const a = { x: shaft.cx - shaft.w / 2 - 8, y, z: shaft.cz };
    const b = { x: shaft.cx + shaft.w / 2 + 8, y, z: shaft.cz };
    expect(f.collides(a, b)).toBe(true);
    // 塔の上を越える
    // （近くにもっと高いタワーがあるので、街で最も高い建物より上）
    const over = tower.base + Math.max(...city.buildings.map((x) => x.height)) + 20;
    expect(f.collides({ ...a, y: over }, { ...b, y: over })).toBe(false);
    // 低層の壁の高さで突き抜ける
    const ly = low.base + low.height / 2;
    const lx = (low.minX + low.maxX) / 2;
    const lz = (low.minZ + low.maxZ) / 2;
    expect(low.height).toBeLessThan(CITY_CONFIG.collisionMinHeight);
    expect(f.collides({ x: lx - 6, y: ly, z: lz }, { x: lx + 6, y: ly, z: lz })).toBe(false);
    f.destroy(city.buildings.indexOf(tower), 'player');
    expect(f.collides(a, b)).toBe(false);
  });

  it('自機（FlightSession）が高層に当たると墜落、低層は抜けられる', () => {
    const f = new BuildingField(city);
    const session = new FlightSession({ groundHeight: harbor.getGroundHeight, buildings: () => f });
    session.startMission({
      x: shaft.cx,
      y: tower.base + shaft.h * 0.5,
      z: shaft.cz + 400,
      headingDeg: 0,
    });
    const controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0.7, afterburner: false };
    const input = createCombatInput();
    let downs = 0;
    session.onPlayerDown(() => downs++);
    for (let i = 0; i < 180 && downs === 0; i++) session.step(controls, input, 1 / 60);
    expect(downs).toBe(1);
  });

  it('segmentHitsBox: 箱を通る・外れる・端に触れる', () => {
    expect(
      segmentHitsBox({ x: -1, y: 0.5, z: 0.5 }, { x: 2, y: 0.5, z: 0.5 }, 0, 0, 0, 1, 1, 1),
    ).toBe(true);
    expect(segmentHitsBox({ x: -1, y: 2, z: 0.5 }, { x: 2, y: 2, z: 0.5 }, 0, 0, 0, 1, 1, 1)).toBe(
      false,
    );
    expect(
      segmentHitsBox({ x: -1, y: 0.5, z: 0.5 }, { x: -0.1, y: 0.5, z: 0.5 }, 0, 0, 0, 1, 1, 1),
    ).toBe(false);
  });

  it('爆弾・ロケットの着弾の高さは立っている建物の屋根（壊れたら地表）', () => {
    const map = new ActiveMap(HARBOR_MAP);
    const b = map.buildings;
    if (!b) throw new Error('街');
    const i = city.buildings.indexOf(tower);
    const t = b.layout.buildings[i];
    if (!t) throw new Error('塔');
    const s = t.parts[1];
    if (!s) throw new Error('塔');
    expect(map.ordnanceGround(s.cx, s.cz)).toBeCloseTo(t.base + t.height, 3);
    b.destroy(i, 'player');
    expect(map.ordnanceGround(s.cx, s.cz)).toBeCloseTo(CITY_CONFIG.groundHeight, 3);
  });
});

describe('破壊', () => {
  it('崩れる: 0.4 秒で瓦礫になり、壊れた数は 1 回だけ数える', () => {
    const f = new BuildingField(city);
    const events: number[] = [];
    f.onCollapse((e) => events.push(e.index));
    expect(f.destroy(5, 'player')).toBe(true);
    expect(f.destroy(5, 'player')).toBe(false);
    expect(f.states[5]).toBe('collapsing');
    for (let i = 0; i < 23; i++) f.step(1 / 60);
    expect(f.states[5]).toBe('collapsing');
    expect(f.collapseProgress(5)).toBeGreaterThan(0.9);
    for (let i = 0; i < 2; i++) f.step(1 / 60);
    expect(f.states[5]).toBe('rubble');
    expect(events).toEqual([5]);
    expect(f.destroyedCount).toBe(1);
  });

  it('怪獣の歩いた道の建物は壊れ、離れた建物は残る。タワー群に着くと街に到達（失敗）', () => {
    const f = new BuildingField(city);
    const kaiju = new Kaiju(harbor.getGroundHeight);
    const ai = new KaijuAi(kaiju, { damage: () => undefined, stun: () => undefined });
    const from = HARBOR_MAP.kaiju.from;
    const goal = HARBOR_MAP.kaiju.goal;
    kaiju.emerge(from.x, from.z, goal.x, goal.z, { players: 4 });
    ai.configure({ goal, stopRadius: RAID_CONFIG.reachRadius, arrivalFails: true });
    let t = 0;
    while (!kaiju.cityReached && t < 1500) {
      ai.step([], 1 / 60);
      applyKaijuToCity(f, kaiju, ai);
      f.step(1 / 60);
      t += 1 / 60;
    }
    expect(kaiju.cityReached).toBe(true);
    const stopZ = goal.z + RAID_CONFIG.reachRadius;
    let onPath = 0;
    let far = 0;
    city.buildings.forEach((b, i) => {
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      // 道（x ≈ 0、岸壁から止まった所まで）の真上の建物
      if (b.minX < 10 && b.maxX > -10 && cz > stopZ + 40) {
        onPath++;
        expect([i, f.states[i]]).toEqual([i, 'rubble']);
      }
      if (Math.abs(cx) > 500) {
        far++;
        expect([i, f.states[i]]).toEqual([i, 'intact']);
      }
    });
    expect(onPath).toBeGreaterThan(3);
    expect(far).toBeGreaterThan(1000);
    expect(f.intactRatio).toBeGreaterThan(0.8);
    expect(f.intactRatio).toBeLessThan(1);
  });

  it('薙ぎ払い（尾の届く範囲）と熱線の通り道の建物が壊れる', () => {
    const f = new BuildingField(city);
    const c = CITY_CONFIG.center;
    const visible = {
      visible: true,
      feet: { x: c.x, y: 6, z: c.z + 300 },
      heading: 0,
      attack: 'sweep' as const,
      attackStep: 'active' as const,
    };
    const body = visible as unknown as Parameters<typeof applyKaijuToCity>[1];
    applyKaijuToCity(f, body, null);
    city.buildings.forEach((b, i) => {
      const dx = Math.max(b.minX - c.x, 0, c.x - b.maxX);
      const dz = Math.max(b.minZ - (c.z + 300), 0, c.z + 300 - b.maxZ);
      if (Math.hypot(dx, dz) < CITY_CONFIG.kaiju.sweepRadius - 1)
        expect(f.states[i]).toBe('collapsing');
      if (Math.hypot(dx, dz) > CITY_CONFIG.kaiju.sweepRadius + 1 && Math.hypot(dx, dz) > 200)
        expect(f.states[i]).toBe('intact');
    });
    // 熱線: 高さ 20m を東西に横切る
    const g = new BuildingField(city);
    const n = g.hitBeam({ x: -1250, y: 26, z: 650 }, { x: 1, y: 0, z: 0 }, 2500, 15, 'kaiju');
    expect(n).toBeGreaterThan(5);
    city.buildings.forEach((b, i) => {
      if (g.states[i] !== 'intact') {
        expect(b.minZ).toBeLessThan(665);
        expect(b.maxZ).toBeGreaterThan(635);
        expect(b.base + b.height).toBeGreaterThan(11);
      }
    });
  });

  it('爆弾は爆風の半径の建物を 1 回で壊す（プレイヤーの武器は爆弾・ロケットだけ）', () => {
    const f = new BuildingField(city);
    const low = city.buildings.findIndex((b) => b.kind === 'low');
    const b = city.buildings[low];
    if (!b) throw new Error('低層');
    const n = f.hitSphere(
      (b.minX + b.maxX) / 2,
      b.base + b.height + 1,
      (b.minZ + b.maxZ) / 2,
      5,
      'player',
    );
    expect(n).toBeGreaterThanOrEqual(1);
    expect(f.states[low]).toBe('collapsing');
  });
});

describe('守れた建物', () => {
  it('割合は壊れていない建物 / 全部（崩れている途中は壊れた扱い）の % を切り捨て', () => {
    const f = new BuildingField(city);
    expect(protectedPercent(f)).toBe(100);
    f.destroy(0, 'kaiju');
    expect(protectedPercent(f)).toBe(99);
    for (let i = 1; i < 400; i++) f.destroy(i, 'kaiju');
    expect(protectedPercent(f)).toBe(90);
    for (let i = 400; i < 401; i++) f.destroy(i, 'kaiju');
    expect(protectedPercent(f)).toBe(89);
    f.reset();
    expect(protectedPercent(f)).toBe(100);
  });

  it('フライトの始めに建て直し、セッションが割合を返す（街のないマップは null）', () => {
    const f = new BuildingField(city);
    const session = new FlightSession({ groundHeight: harbor.getGroundHeight, buildings: () => f });
    for (let i = 0; i < 40; i++) f.destroy(i, 'kaiju');
    expect(session.protectedBuildings).toBe(99);
    session.startMission(RAID_MISSION.start);
    expect(session.protectedBuildings).toBe(100);
    expect(new FlightSession().protectedBuildings).toBeNull();
  });
});
