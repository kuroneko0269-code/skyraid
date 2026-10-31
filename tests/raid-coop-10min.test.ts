// 協力レイドの仕上げ（6-6）の続き: 怪獣の state の大きさ（40 バイト以下）と岩の event、
// 4 人協力をインメモリで 10 分通して撃破し、リザルトが全員で一致・帯域 8KB/s 以下
import { describe, expect, it } from 'vitest';
import { protectedPercent, type BuildingField } from '../src/combat/buildings';
import { PvpArena } from '../src/combat/pvp-arena';
import { RAID_CONFIG } from '../src/data/kaiju';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { KAIJU_STATE_MAX_BYTES } from '../src/net/codec-kaiju';
import { KaijuMirror } from '../src/net/kaiju-mirror';
import {
  decodeMessage,
  encodeMessage,
  eventMsg,
  packRockVelocity,
  type StateMsg,
} from '../src/net/protocol';
import { RAID_OUTCOME, RaidHost } from '../src/net/raid-host';
import { raidSummary } from '../src/net/raid-result';
import { raidReward } from '../src/progression/raid-reward';
import { createHeightField } from '../src/render/terrain-height';
import { DT, startMatch } from './pvp-match';
import { cityFields as fields, coopBots, ruined } from './raid-coop-bots';

const harbor = createHeightField(HARBOR_TERRAIN).getGroundHeight;
const RAID = { mode: 'raid', mapId: RAID_CONFIG.mapId } as const;

describe('怪獣の state の大きさと岩', () => {
  it('熱線ありでも 40 バイト以下（部位 HP 5 × 16bit・位置・向き・状態・予兆の残り）', () => {
    const arena = new PvpArena(() => undefined);
    const raid = new RaidHost(arena, 4);
    for (let i = 0; i < 12 * 60; i++) raid.step(DT);
    const k = raid.state();
    k.beam = { x: 0.6, y: -0.3, z: Math.sqrt(1 - 0.36 - 0.09) };
    k.finalRemaining = 123.4;
    const msg: StateMsg = { type: 'state', tick: 1, aircraft: [], missiles: [], kaiju: k };
    const none = encodeMessage({ ...msg, kaiju: null }).byteLength;
    const size = encodeMessage(msg).byteLength - none + 1;
    expect(size).toBeLessThanOrEqual(40);
    expect(size).toBe(KAIJU_STATE_MAX_BYTES);
    const back = decodeMessage(encodeMessage(msg));
    if (back?.type !== 'state' || !back.kaiju?.beam) throw new Error('decode');
    expect(back.kaiju.beam.x).toBeCloseTo(0.6, 3);
    expect(back.kaiju.beam.y).toBeCloseTo(-0.3, 3);
    expect(back.kaiju.finalRemaining).toBeCloseTo(123.4, 1);
    expect(back.kaiju.feet.x).toBeCloseTo(k.feet.x, 0);
    expect(back.kaiju.attackDuration).toBeCloseTo(k.attackDuration, 1);
  });

  it('岩は投げた位置と速度の event で、写しが同じ放物線を進める', () => {
    const m = new KaijuMirror();
    m.handleRock(
      eventMsg('rock', 1, 0, 0, packRockVelocity({ x: 100, y: 50, z: -200 }), 10, 90, 20),
    );
    for (let i = 0; i < 60; i++) m.step(DT);
    const r = m.rocks[1];
    expect(r?.active).toBe(true);
    expect(r?.position.x).toBeCloseTo(110, 0);
    expect(r?.position.z).toBeCloseTo(-180, 0);
    expect(r?.position.y).toBeCloseTo(90 + 50 - 9.8 / 2, 0);
    m.handleRock(eventMsg('rock', 0, 1, 0, 0, r?.position.x, r?.position.y, r?.position.z));
    expect(r?.active).toBe(false);
  });
});

describe('4 人協力を 10 分通す', () => {
  it('ボットで撃破し、リザルト（与ダメージ・ブレイク・復帰・MVP・時間・守れた建物 %・報酬）が全員で一致。8KB/s 以下', async () => {
    const fs = fields();
    const m = await startMatch(3, { latencyMs: 50, jitterMs: 15 }, RAID, 0, harbor, 23, {
      buildings: (id) => fs[id] ?? null,
    });
    const state = { breakOff: [0, 0, 0, 0], fireTicks: 8 };
    const seconds = 600;
    let elapsed = 0;
    while (elapsed < seconds && !m.host.finished) {
      await m.run(10, coopBots(m, state));
      elapsed += 10;
    }
    await m.run(1);
    expect(m.host.finished).toBe(true);
    const over = [0, 1, 2, 3].map((id) => m.events[id]?.find((e) => e.kind === 'over'));
    for (const e of over) {
      expect(e?.b).toBe(RAID_OUTCOME.clear);
      expect(e?.n).toBe(over[0]?.n);
    }
    const clear = (over[0]?.n ?? 0) / 60;
    expect(clear).toBeGreaterThan(300);
    expect(clear).toBeLessThanOrEqual(seconds);
    // 建物の集合が全員で一致
    const host = ruined(fs[0] as BuildingField);
    for (const id of [1, 2, 3]) expect(ruined(fs[id] as BuildingField)).toEqual(host);
    // リザルトは全員が自分の受け取ったものから作って一致する
    const summaries = [0, 1, 2, 3].map((id) => {
      const s = m.scores[id];
      if (!s?.over) throw new Error(`score ${id}`);
      return raidSummary(s.players, {
        cleared:
          m.events[id]?.some((e) => e.kind === 'over' && e.b === RAID_OUTCOME.clear) ?? false,
        difficulty: 'normal',
        seconds: (m.events[id]?.find((e) => e.kind === 'over')?.n ?? 0) / 60,
        protectedBuildings: protectedPercent(fs[id] as BuildingField),
      });
    });
    for (const s of summaries) expect(s).toEqual(summaries[0]);
    const s0 = summaries[0];
    if (!s0) throw new Error('summary');
    expect(s0.cleared).toBe(true);
    expect(s0.rows).toHaveLength(4);
    expect(s0.mvp).not.toBeNull();
    const top = Math.max(...s0.rows.map((r) => r.total));
    expect(s0.rows.find((r) => r.id === s0.mvp)?.total).toBe(top);
    // 与ダメージの合計は怪獣の最大 HP（丸めの誤差まで）。ブレイクと復帰も記録されている
    const total = s0.rows.reduce((a, r) => a + r.total, 0);
    expect(Math.abs(total - (m.host.raid?.kaiju.maxHp ?? 0))).toBeLessThan(10);
    expect(s0.rows.reduce((a, r) => a + r.breaks, 0)).toBeGreaterThan(0);
    expect(s0.rows.every((r) => r.respawns === m.host.arena.fighters.get(r.id)?.deaths)).toBe(true);
    expect(s0.credits).toBe(
      raidReward({ coop: true, cleared: true, seconds: clear, difficulty: 'normal' }),
    );
    // 帯域: 1 本の接続あたり 8KB/s 以下（上り・下り）
    const net = m.lobby.net;
    const hostId = m.lobby.host.transportId;
    const time = clear + 1;
    for (const c of m.lobby.clients) {
      const down = (net.bytes.get(`${hostId}>${c.transportId}`) ?? 0) / time;
      const up = (net.bytes.get(`${c.transportId}>${hostId}`) ?? 0) / time;
      expect(down).toBeLessThanOrEqual(8000);
      expect(up).toBeLessThanOrEqual(8000);
      expect(down).toBeGreaterThan(2000);
    }
  }, 120_000);
});
