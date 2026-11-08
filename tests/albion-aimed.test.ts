// 10-3c: 白鯨アルビオンの体の当たり（通り抜けられない）と、人を狙う攻撃（水柱・歌・横転・呼び声）が「動かなければ当たる・
// 予兆を見て正しく避ければ当たらない」こと
import { describe, expect, it } from 'vitest';
import { AlbionKaiju, type AlbionTarget } from '../src/ai/albion-ai';
import { beginWindup } from '../src/ai/albion-actions';
import { bodyLocal } from '../src/ai/albion-aimed';
import {
  createHullContact,
  hullContact,
  hullPenetration,
  type HullHit,
} from '../src/ai/albion-hull';
import { ALBION_CONFIG as C, type AlbionAttack } from '../src/data/albion';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { vec3, type Vec3 } from '../src/flight/math';
import { bayRoute } from '../src/missions/albion-dev';
import { createHeightField } from '../src/render/terrain-height';

const DT = 1 / 60;
const ground = createHeightField(HARBOR_TERRAIN).getGroundHeight;

function whale(seed = 3): AlbionKaiju {
  const k = new AlbionKaiju(ground);
  k.spawn(bayRoute({ x: 0, z: 0 }), 0, seed);
  // 自分で選ばせない（攻撃は手で始める）
  k.cooldown = 1e9;
  return k;
}

/** 体から見た位置（前・右・上）の世界の点 */
function at(k: AlbionKaiju, along: number, side: number, above: number): Vec3 {
  const fx = -Math.sin(k.body.heading);
  const fz = -Math.cos(k.body.heading);
  const b = k.body.position;
  return { x: b.x + fx * along - fz * side, y: b.y + above, z: b.z + fz * along + fx * side };
}

interface Mover extends AlbionTarget {
  readonly position: Vec3;
  readonly velocity: Vec3;
}

/** 攻撃 a を手で始めて、終わるまで回す。steer(t) は予兆からの秒で速度を変える。当たった種類を返す */
function runAttack(
  k: AlbionKaiju,
  a: AlbionAttack,
  me: Mover,
  steer: (t: number, me: Mover) => void,
  seconds = 12,
): string[] {
  const hits: string[] = [];
  k.setAction('windup', a);
  beginWindup(k, a, me);
  let t = 0;
  for (let i = 0; i < seconds / DT && (k.action !== 'idle' || t < 0.1); i++) {
    t += DT;
    steer(t, me);
    me.position.x += me.velocity.x * DT;
    me.position.y += me.velocity.y * DT;
    me.position.z += me.velocity.z * DT;
    k.step(DT, me, (kind) => hits.push(kind));
  }
  return hits;
}

describe('アルビオンの体の当たり（10-3c）', () => {
  it('胴・頭・尾・胸びれ・尾びれ・背びれの中はめり込み、横 120m は外。外向きは外を向く', () => {
    const k = whale();
    // 胸びれのあおぎ 0・尾の上下ほぼ 0 の位相（形の静止姿勢に近い所）で見る
    k.body.pose.swimPhase = (Math.PI - 0.4) / Math.PI;
    const hit: HullHit = { depth: 0, normal: vec3(), shape: 'body' };
    const inside: [number, number, number, string][] = [
      [0, 0, 0, 'body'],
      [0, 0, 50, 'body'],
      [280, 0, 0, 'body'],
      [-250, 0, 5, 'body'],
      [110, 120, -50, 'fin'],
      [100, -120, -50, 'fin'],
      [-40, 0, 66, 'dorsal'],
    ];
    for (const [f, r, u, shape] of inside) {
      expect(hullPenetration(k.body, at(k, f, r, u), 0, hit), `${shape} ${f},${r},${u}`).toBe(true);
    }
    // 尾びれは泳ぎで上下する（尾の骨の動き）ので、上下 ±60m のどこかで当たる
    let fluke = false;
    for (let u = -60; u <= 60; u += 2)
      fluke ||= hullPenetration(k.body, at(k, -305, 60, u), 0, hit);
    expect(fluke).toBe(true);
    expect(hullPenetration(k.body, at(k, 0, 120, 0), 0, hit)).toBe(false);
    expect(hullPenetration(k.body, at(k, 0, 0, 120), 0, hit)).toBe(false);
    expect(hullPenetration(k.body, at(k, 400, 0, 0), 0, hit)).toBe(false);
    // 横から: 外向きは横（右）
    expect(hullPenetration(k.body, at(k, 0, 50, 0), 0, hit)).toBe(true);
    const side = bodyLocal(k.body, {
      x: k.body.position.x + hit.normal.x * 100,
      y: k.body.position.y,
      z: k.body.position.z + hit.normal.z * 100,
    }).side;
    expect(side).toBeGreaterThan(90);
  });

  it('体を横切る移動の線分は手前でめり込む（10-4c: 弾かない。ぶつかった後の扱いは共通の kaiju-ram）', () => {
    const k = whale();
    const a = at(k, 0, 200, 0);
    const b = at(k, 0, -200, 0);
    const c = createHullContact();
    expect(hullContact(k.body, a, b, C.collision.margin, C.collision.sampleStep, c)).toBe(true);
    expect(bodyLocal(k.body, c.point).side).toBeGreaterThan(40);
  });
});

describe('人を狙う攻撃（10-3c）: 動かなければ当たる・予兆を見て正しく避ければ当たらない', () => {
  const SPEED = 250;
  const turnAt = 0.6;

  it('水柱: まっすぐ進むと当たる。予兆の 0.6 秒後に 90° 横へ曲がると柱の間を抜ける', () => {
    for (const dodge of [false, true]) {
      const k = whale(5);
      const start = at(k, 0, 1500, 0);
      const me: Mover = { position: start, velocity: { x: SPEED, y: 0, z: 0 }, active: true };
      const hits = runAttack(k, 'geyser', me, (t, m) => {
        if (dodge && t >= turnAt && m.velocity.x !== 0) {
          m.velocity.x = 0;
          m.velocity.z = SPEED;
        }
      });
      expect(hits.filter((h) => h === 'geyser').length, `dodge=${String(dodge)}`).toBe(
        dodge ? 0 : 1,
      );
    }
  });

  it('歌: 体の高さにいると輪が当たる。予兆の 0.6 秒後に上（150m）か下へ動くと越える', () => {
    for (const dodge of [0, 1, -1]) {
      const k = whale(6);
      const me: Mover = {
        position: at(k, 200, 700, 0),
        velocity: { x: 0, y: 0, z: 0 },
        active: true,
      };
      const hits = runAttack(k, 'sonar', me, (t, m) => {
        m.velocity.y = dodge !== 0 && t >= turnAt && t < turnAt + 1.5 ? dodge * 100 : 0;
      });
      expect(hits.filter((h) => h === 'sonar').length, `dodge=${String(dodge)}`).toBe(
        dodge === 0 ? 1 : 0,
      );
    }
  });

  it('横転: 体の横 150m にいると胸びれで払われる。予兆の 0.6 秒後に横へ離れると当たらない', () => {
    for (const dodge of [false, true]) {
      const k = whale(7);
      let side = 150;
      const me: Mover = { position: at(k, 50, side, 0), velocity: vec3(), active: true };
      const hits = runAttack(k, 'roll', me, (t, m) => {
        if (dodge && t >= turnAt) side += SPEED * DT;
        // 体と一緒に動く（体から見た位置を保つ）
        const p = at(k, 50, side, 0);
        m.position.x = p.x - m.velocity.x * DT;
        m.position.y = p.y;
        m.position.z = p.z - m.velocity.z * DT;
      });
      expect(hits.filter((h) => h === 'roll').length, `dodge=${String(dodge)}`).toBe(dodge ? 0 : 1);
    }
  });

  it('呼び声: 子分が囲んで突撃し、まっすぐ進むと当たる。構え（攻撃の始め）を見て 90° 曲がると当たらない', () => {
    for (const dodge of [false, true]) {
      const k = whale(8);
      const me: Mover = {
        position: { x: k.body.position.x + 1200, y: k.body.position.y + 300, z: k.body.position.z },
        velocity: { x: SPEED, y: 0, z: 0 },
        active: true,
      };
      // 子分 8 匹を人の周り 500m に置く（飛び出しは済み）
      k.swarm.minions.slice(0, 8).forEach((m, i) => {
        const a = (i / 8) * Math.PI * 2;
        m.active = true;
        m.age = 5;
        m.hp = C.minions.hp;
        m.position.x = me.position.x + Math.cos(a) * 500;
        m.position.y = me.position.y;
        m.position.z = me.position.z + Math.sin(a) * 500;
        m.velocity.x = SPEED;
        m.velocity.y = 0;
        m.velocity.z = 0;
      });
      let turned = false;
      const hits = runAttack(k, 'call', me, (_t, m) => {
        if (dodge && !turned && k.attack === 'call' && k.action === 'active') {
          turned = true;
          m.velocity.x = 0;
          m.velocity.z = SPEED;
        }
      });
      const n = hits.filter((h) => h === 'call').length;
      if (dodge) expect(n).toBe(0);
      else expect(n).toBeGreaterThanOrEqual(1);
      // 突撃した子分は散る（消える）
      expect(k.callMask).toBe(0);
    }
  });
});
