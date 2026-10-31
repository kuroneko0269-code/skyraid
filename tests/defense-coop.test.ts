// 協力の防衛戦（7-2）: state の直列化、ホストの判定（プレイヤーの弾で敵を撃墜・撃墜数・スキップは全員・補給は全員）、
// 4 人をインメモリで通して、リザルトが全員で一致・クライアントの表示（爆撃機の再現・基地）がホストと合う・帯域が協力レイド以下
import { describe, expect, it } from 'vitest';
import { PvpArena } from '../src/combat/pvp-arena';
import { DEFENSE_CONFIG } from '../src/data/defense';
import { FREE_FLIGHT_ENEMIES } from '../src/data/ai';
import { FlightSession } from '../src/missions/flight-session';
import { DefenseHost, DEFENSE_OUTCOME } from '../src/net/defense-host';
import { DefenseMirror } from '../src/net/defense-mirror';
import { defenseSummary } from '../src/net/defense-result';
import { decodeMessage, encodeMessage, type EventMsg, type StateMsg } from '../src/net/protocol';
import { getGroundHeight } from '../src/render/terrain-height';
import { defenseBots } from './defense-coop-bots';
import { DT, startMatch } from './pvp-match';

const DEFENSE = { mode: 'defense', mapId: 'island' } as const;

describe('防衛戦の state', () => {
  it('戦闘機なしで 16 バイト、1 機 13 バイト（位置 0.5m・姿勢 smallest-three）。半分ずつ入れる', () => {
    const events: EventMsg[] = [];
    const arena = new PvpArena(() => undefined);
    const host = new DefenseHost(arena, {
      mapId: 'island',
      hard: false,
      players: 4,
      groundHeight: getGroundHeight,
      emit: (e) => events.push({ ...e }),
    });
    host.runner.skip();
    for (let i = 0; i < 2 * 60; i++) host.step(DT);
    const all = host.state(true);
    const fighters = all.enemies.length;
    expect(fighters).toBeGreaterThan(1);
    const base: StateMsg = {
      type: 'state',
      tick: 1,
      aircraft: [],
      missiles: [],
      kaiju: null,
      defense: null,
    };
    const none = encodeMessage(base).byteLength;
    const half = host.state(false);
    const msg: StateMsg = { ...base, defense: half };
    const size = encodeMessage(msg).byteLength - none + 1;
    expect(size).toBe(16 + 13 * half.enemies.length);
    expect(half.enemies.length).toBeLessThan(fighters);
    const other = host.state(false).enemies.length;
    expect(half.enemies.length + other).toBe(fighters);
    const back = decodeMessage(encodeMessage({ ...base, defense: host.state(true) }));
    if (back?.type !== 'state' || !back.defense) throw new Error('decode');
    const d = back.defense;
    expect(d.wave).toBe(1);
    expect(d.hqHp).toBe(DEFENSE_CONFIG.hqMaxHp.normal);
    expect(d.aliveBits).toBe(0b11111);
    d.enemies.forEach((e, i) => {
      const a = all.enemies[i];
      if (!a) throw new Error('missing');
      expect(e.index).toBe(a.index);
      expect(Math.abs(e.position.x - a.position.x)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(e.orientation.w - a.orientation.w)).toBeLessThan(1e-3);
    });
  });
});

describe('4 人協力をインメモリで通す', () => {
  it('終わりまで進み、リザルト（結果・波・撃墜・MVP・報酬）が全員で一致。表示はホストと合い、帯域は協力レイド以下', async () => {
    const m = await startMatch(3, { latencyMs: 50, jitterMs: 15 }, DEFENSE, 0, getGroundHeight, 23);
    const d = m.host.defense;
    if (!d) throw new Error('defense');
    // 4 人分（ホスト + 3）の人数スケール
    expect(d.runner.counts.fighter).toBe(Math.round(2 * 2.2));
    // クライアント 1 の表示（本番と同じ写し）
    const client = m.clients[0];
    if (!client) throw new Error('client');
    const session = new FlightSession({
      groundHeight: getGroundHeight,
      enemies: { ...FREE_FLIGHT_ENEMIES, maxCount: DEFENSE_CONFIG.hostFighterPool },
    });
    session.startMission({ x: 0, y: 500, z: 0, headingDeg: 0 });
    const mirror = new DefenseMirror(session, { mapId: 'island', hard: false }, client.localId);
    client.onEvent((e) => {
      mirror.handleEvent(e);
    });
    let version = -1;
    let compared = 0;
    let worst = 0;
    const kills: EventMsg[] = [];
    m.host.onEvent((e) => {
      if (e.kind === 'dkill') kills.push({ ...e });
    });
    const bots = defenseBots(m);
    let seconds = 0;
    while (seconds < 1800 && !m.host.finished) {
      await m.run(5, (k) => {
        bots(k);
        if (client.defenseVersion !== version && client.defenseState) {
          version = client.defenseVersion;
          mirror.onState(client.defenseState, client.defenseTick);
        }
        mirror.step(DT, client.viewTick);
        // 爆撃機の再現: ホストの同じ時刻の位置と比べる（表示は 100ms ほど遅れる）
        if (k % 30 === 0)
          d.props.bombers.forEach((b, i) => {
            const c = session.props.bombers[i];
            if (!b.active || !c?.active) return;
            const lag = ((m.host.tick - client.viewTick) / 60) * b.spec.speed;
            const err = Math.abs(b.traveled - c.traveled - lag);
            worst = Math.max(worst, err);
            compared++;
          });
      });
      seconds += 5;
    }
    await m.run(1);
    expect(m.host.finished).toBe(true);
    expect(d.runner.wavesCleared).toBeGreaterThanOrEqual(3);
    // 全員に同じ終わりの event
    const over = [0, 1, 2, 3].map((id) => m.events[id]?.find((e) => e.kind === 'over'));
    for (const e of over) {
      expect(e).toBeDefined();
      expect([e?.a, e?.b, e?.x, e?.y]).toEqual([over[0]?.a, over[0]?.b, over[0]?.x, over[0]?.y]);
    }
    const outcome = over[0]?.b;
    expect(outcome === DEFENSE_OUTCOME.cleared || outcome === DEFENSE_OUTCOME.failed).toBe(true);
    expect(over[0]?.x).toBe(d.runner.wavesCleared);
    // リザルトは全員が受け取ったものから作って一致する
    const summaries = [0, 1, 2, 3].map((id) => {
      const s = m.scores[id];
      if (!s?.over) throw new Error(`score ${id}`);
      return defenseSummary(over[id] ?? null, s.players, { mapId: 'island', hard: false });
    });
    for (const s of summaries) expect(s).toEqual(summaries[0]);
    const s0 = summaries[0];
    if (!s0) throw new Error('summary');
    // 撃墜数の合計は、プレイヤーが落とした dkill の数
    const byPlayers = kills.filter((e) => e.a < 4).length;
    expect(s0.score.kills).toBe(byPlayers);
    expect(byPlayers).toBeGreaterThan(5);
    const best = Math.max(...(m.scores[0]?.players.map((p) => p.kills) ?? [0]));
    expect(m.scores[0]?.players.find((p) => p.id === s0.mvp)?.kills).toBe(best);
    expect(s0.credits).toBe(s0.score.wavesCleared * 300 + s0.fullClear + s0.facilities);
    // クライアントの表示: 爆撃機は同じ直線の上（表示の時刻のずれを除いて 1m 以内）、基地の司令部・施設は最後の state と同じ
    expect(compared).toBeGreaterThan(10);
    expect(worst).toBeLessThan(1);
    expect(mirror.base.hq.hp).toBe(client.defenseState?.hqHp);
    expect(mirror.base.aliveBits).toBe(client.defenseState?.aliveBits);
    // 帯域: ホスト → 各クライアントは協力レイドの実測（約 3.1KB/s）以下、クライアント → ホストは入力だけ
    const net = m.lobby.net;
    const hostId = m.lobby.host.transportId;
    const time = seconds + 1;
    for (const c of m.lobby.clients) {
      const down = (net.bytes.get(`${hostId}>${c.transportId}`) ?? 0) / time;
      const up = (net.bytes.get(`${c.transportId}>${hostId}`) ?? 0) / time;
      expect(down).toBeLessThanOrEqual(3150);
      expect(up).toBeLessThanOrEqual(1700);
    }
  }, 300_000);

  it('準備のスキップは全員がそろったとき。補給は基地の上を低く遅く通った人に（ミサイル・フレア満タン）', async () => {
    const m = await startMatch(1, { latencyMs: 30, jitterMs: 0 }, DEFENSE, 0, getGroundHeight, 5);
    const d = m.host.defense;
    if (!d) throw new Error('defense');
    await m.run(0.5);
    // 2 人のうち 1 人だけ: まだ準備
    m.host.skipBriefing();
    await m.run(0.5);
    expect(d.runner.phase).toBe('intermission');
    // 補給: クライアントの機体を基地の上へ（撃ち尽くしてから）
    const f = m.host.arena.fighters.get(1);
    if (!f) throw new Error('fighter');
    while (f.missileAmmo.tryUse()) f.missileAmmo.step(1);
    const c = d.runner.map.center;
    const own = m.owns[1];
    if (!own) throw new Error('own');
    f.aircraft.respawn({ x: c.x, y: 220, z: c.z }, { x: 0, y: 0, z: 0, w: 1 });
    f.aircraft.state.speed = 120;
    own.respawn({ x: c.x, y: 220, z: c.z }, { x: 0, y: 0, z: 0, w: 1 });
    own.state.speed = 120;
    await m.run(0.2, () => {
      const ctl = m.controls[1];
      if (ctl) ctl.throttleTarget = 0.2;
    });
    expect(m.events[1]?.some((e) => e.kind === 'dsupply' && e.a === 1 && e.n === 100)).toBe(true);
    expect(f.missileAmmo.count).toBe(f.missileAmmo.capacity);
    // もう 1 人が押すと次の波
    m.clients[0]?.skipBriefing();
    await m.run(0.5);
    expect(d.runner.phase).toBe('wave');
  }, 60_000);
});
