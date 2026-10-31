import { describe, expect, it } from 'vitest';
import { FLIGHT_CONFIG } from '../src/data/flight';
import { NET_CONFIG } from '../src/data/net';
import { PVP_SPAWN_POINTS } from '../src/data/pvp';
import { Aircraft, createControls } from '../src/entities/aircraft';
import { headingQuat } from '../src/entities/enemy-aircraft';
import { rotateVec3 } from '../src/flight/math';
import { netLoadout } from '../src/net/loadout';
import { SPAWN_ORIENTATION, spawnPosition } from '../src/net/net-game';
import { getGroundHeight } from '../src/render/terrain-height';

const DT = 1 / 60;

/** 操作なしで seconds 秒飛ばし、墜落の回数と機体どうしの最短距離を返す */
function idle(aircraft: Aircraft[], seconds: number): { crashes: number; minGap: number } {
  const controls = createControls();
  let minGap = Infinity;
  for (let k = 0; k < seconds * 60; k++) {
    for (const a of aircraft) a.step(controls, DT);
    for (let i = 0; i < aircraft.length; i++) {
      for (let j = i + 1; j < aircraft.length; j++) {
        const p = aircraft[i]?.state.position;
        const q = aircraft[j]?.state.position;
        if (p && q) minGap = Math.min(minGap, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
      }
    }
  }
  return { crashes: aircraft.reduce((n, a) => n + a.crashCount, 0), minGap };
}

function aircraftFor(id: string): Aircraft {
  return new Aircraft(netLoadout(id, undefined).flight, {}, FLIGHT_CONFIG, getGroundHeight);
}

describe('PvP の開始位置（5-4 の事前修正）', () => {
  it('高度 800m・間隔 150m・機首は海側（+Z、島の外向き）', () => {
    const p0 = spawnPosition(0, { x: 0, y: 0, z: 0 });
    const p1 = spawnPosition(1, { x: 0, y: 0, z: 0 });
    expect(p0.y).toBe(800);
    expect(p1.x - p0.x).toBe(150);
    const fwd = rotateVec3({ x: 0, y: 0, z: 0 }, SPAWN_ORIENTATION, { x: 0, y: 0, z: -1 });
    expect(fwd.z).toBeCloseTo(1, 6);
    // 機首の向きは島の中心から外へ（開始位置から中心への向きと逆）
    expect(fwd.z * Math.sign(p0.z)).toBeGreaterThan(0.99);
  });

  it.each(['kestrel', 'swift', 'bastion', 'vector'])(
    '4 機（%s）が操作しなくても 30 秒は墜落せず、互いにぶつからない',
    (id) => {
      const list = Array.from({ length: NET_CONFIG.maxPlayers }, (_, i) => {
        const a = aircraftFor(id);
        a.respawn(spawnPosition(i, { x: 0, y: 0, z: 0 }), SPAWN_ORIENTATION);
        return a;
      });
      const r = idle(list, 30);
      expect(r.crashes).toBe(0);
      expect(r.minGap).toBeGreaterThan(100);
    },
  );

  it('復帰の出現位置（8 か所）からも、操作しなければ 30 秒は墜落しない', () => {
    for (const s of PVP_SPAWN_POINTS) {
      const a = aircraftFor('bastion');
      a.respawn(s, headingQuat({ x: 0, y: 0, z: 0, w: 1 }, s.headingDeg));
      expect(idle([a], 30).crashes).toBe(0);
    }
  });
});
