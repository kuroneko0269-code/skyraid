import { describe, expect, it } from 'vitest';
import { NET_CONFIG } from '../src/data/net';
import { hostPeerId, type RoomEndReason } from '../src/net/room';
import { pump } from './net-helpers';
import { startMatch } from './pvp-match';

const SILENCE = NET_CONFIG.room.silenceTimeoutSeconds;
const GRACE = NET_CONFIG.reconnect.graceSeconds;

/** 水平にゆるく旋回する（墜落しない） */
function cruise(m: Awaited<ReturnType<typeof startMatch>>): void {
  for (const c of m.controls) {
    c.roll = 0.05;
    c.throttleTarget = 0.6;
  }
}

describe('切断への耐性（5-4。インメモリ transport・4 人）', () => {
  it('10 秒以内の切断は再接続して同じ ID で続く（ホストは止めて待ち、戻ったら出現位置からそろえる）', async () => {
    const m = await startMatch(3, { latencyMs: 40, jitterMs: 10 });
    const net = m.lobby.net;
    const room = m.lobby.clients[1];
    const game = m.clients[1];
    if (!room || !game) throw new Error('client');
    const id = room.localPlayerId;
    const ends: RoomEndReason[] = [];
    room.onEnd((r) => ends.push(r));
    await m.run(2, () => {
      cruise(m);
    });
    // 8 秒だけ通信が途切れる（タブは動いたまま）
    net.setOffline(room.transportId, true);
    await m.run(SILENCE + 1, () => {
      cruise(m);
    });
    const hostView = m.lobby.host.players.find((p) => p.id === id);
    expect(hostView?.away).toBe(true);
    expect(room.reconnecting).toBe(true);
    expect(m.lobby.clients[0]?.players.find((p) => p.id === id)?.away).toBe(true);
    // 待っている間、ホストの機体は止まって当たらない（対象外・無敵の表示）
    const frozen = { ...m.host.aircraftOf(id)?.state.position };
    const fighter = m.host.arena.fighters.get(id);
    expect(fighter?.active).toBe(false);
    expect(fighter?.invulnerable).toBe(true);
    await m.run(1, () => {
      cruise(m);
    });
    expect(m.host.aircraftOf(id)?.state.position).toEqual(frozen);
    expect(game.inputBlocked).toBe(true);
    net.setOffline(room.transportId, false);
    await m.run(4, () => {
      cruise(m);
    });
    expect(room.reconnecting).toBe(false);
    expect(room.ended).toBe(false);
    expect(ends).toEqual([]);
    expect(room.localPlayerId).toBe(id);
    expect(m.lobby.host.players.find((p) => p.id === id)?.away).toBe(false);
    expect(m.lobby.host.players).toHaveLength(4);
    // ホストが出現位置へ戻し（撃墜には数えない）、クライアントもそこから計算し直して動いている
    const respawn = m.events[id]?.filter((e) => e.kind === 'respawn' && e.a === id) ?? [];
    expect(respawn.length).toBe(1);
    expect(game.awaitingResync).toBe(false);
    expect(game.inputBlocked).toBe(false);
    expect(m.host.arena.fighters.get(id)?.deaths).toBe(0);
    await m.run(3, () => {
      cruise(m);
    });
    const hostPos = m.host.aircraftOf(id)?.state.position;
    const ownPos = m.owns[id]?.state.position;
    if (!hostPos || !ownPos) throw new Error('pos');
    // 自機の先行計算はホストの正より 40ms + 溜め分だけ先にいる（距離にして数十 m）。大きく外れていない
    expect(
      Math.hypot(hostPos.x - ownPos.x, hostPos.y - ownPos.y, hostPos.z - ownPos.z),
    ).toBeLessThan(120);
    expect(m.host.arena.fighters.get(id)?.active).toBe(true);
  });

  it('10 秒を超えたら離脱扱い（ホストは名簿と機体を消し、クライアントは「接続が切れた」で終わる）', async () => {
    const m = await startMatch(3, { latencyMs: 40 });
    const room = m.lobby.clients[2];
    if (!room) throw new Error('client');
    const id = room.localPlayerId;
    const ends: RoomEndReason[] = [];
    room.onEnd((r) => ends.push(r));
    const left: number[] = [];
    m.lobby.host.onPlayerLeave((p) => left.push(p));
    m.lobby.net.setOffline(room.transportId, true);
    await m.run(SILENCE + GRACE - 1, () => {
      cruise(m);
    });
    expect(left).toEqual([]);
    expect(m.lobby.host.players).toHaveLength(4);
    await m.run(3, () => {
      cruise(m);
    });
    expect(left).toEqual([id]);
    expect(m.lobby.host.players.map((p) => p.id)).not.toContain(id);
    expect(m.host.arena.fighters.has(id)).toBe(false);
    expect(ends).toEqual(['lost']);
    // ほかの人の名簿からも消える
    await m.run(0.5, () => {
      cruise(m);
    });
    expect(m.lobby.clients[0]?.players).toHaveLength(3);
    // 期限の後に戻っても同じ枠には入れない
    m.lobby.net.setOffline(room.transportId, false);
    await m.run(2, () => {
      cruise(m);
    });
    expect(m.lobby.host.players).toHaveLength(3);
  });

  it('自分から抜けたら待たずにすぐ消える（bye）', async () => {
    const m = await startMatch(2, { latencyMs: 40 });
    const room = m.lobby.clients[0];
    if (!room) throw new Error('client');
    room.leave();
    await m.run(0.3);
    expect(m.lobby.host.players).toHaveLength(2);
    expect(m.lobby.host.players.some((p) => p.away)).toBe(false);
  });

  it('ロビー（開始前）でも 10 秒以内なら戻れる。待っている間は開始できない', async () => {
    const { createLobby } = await import('./net-helpers');
    const { startBlock } = await import('../src/net/lobby-rules');
    const { net, host, clients } = await createLobby(1, { latencyMs: 30 });
    const c = clients[0];
    if (!c) throw new Error('client');
    c.setLobby({ ready: true });
    await pump(net, 100, [host, c]);
    net.setOffline(c.transportId, true);
    await pump(net, (SILENCE + 1) * 1000, [host, c]);
    expect(startBlock(host.players, 'ffa')).toBe('away');
    net.setOffline(c.transportId, false);
    await pump(net, 3000, [host, c]);
    expect(c.reconnecting).toBe(false);
    expect(startBlock(host.players, 'ffa')).toBeNull();
  });

  it('ホストが落ちたら（ID が消えた）従来どおり終わる（ホスト移行はしない）', async () => {
    const m = await startMatch(2, { latencyMs: 40 });
    const ends: RoomEndReason[] = [];
    m.lobby.clients[0]?.onEnd((r) => ends.push(r));
    // ホストのタブが閉じた（通知なし）
    m.lobby.net.remove(hostPeerId(m.lobby.host.code));
    await m.run(
      SILENCE + 1,
      () => {
        cruise(m);
      },
      new Set([0]),
    );
    expect(ends).toEqual(['host-left']);
  });
});
