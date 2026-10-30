import { describe, expect, it } from 'vitest';
import { NET_CONFIG } from '../src/data/net';
import { ClientRoom } from '../src/net/client-room';
import {
  HostRoom,
  JoinFailure,
  generateRoomCode,
  hostPeerId,
  normalizeRoomCode,
} from '../src/net/room';
import { MemoryNetwork } from '../src/net/transport';
import { SILENCE_MS, createLobby, profile, pump, seeded, settle } from './net-helpers';

describe('room: 部屋コード', () => {
  it('6 文字で、紛らわしい 0 / O / 1 / I を含まない（乱数の端の値も）', () => {
    const r = seeded(3);
    const seen = new Set<string>();
    const rngs = [r, () => 0, () => 0.999999999];
    for (let i = 0; i < 5000; i++) {
      const code = generateRoomCode(rngs[i % 3]);
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      expect(code).not.toMatch(/[01OI]/);
      for (const ch of code) seen.add(ch);
    }
    // 32 文字すべてが使われる
    expect(seen.size).toBe(NET_CONFIG.room.codeAlphabet.length);
    expect(NET_CONFIG.room.codeAlphabet).not.toMatch(/[01OI]/);
  });

  it('入力のゆれを整え、形が違えば null', () => {
    expect(normalizeRoomCode(' abc-234 ')).toBe('ABC234');
    expect(normalizeRoomCode('ABC23')).toBeNull();
    expect(normalizeRoomCode('ABCO23')).toBeNull();
    expect(normalizeRoomCode('ABC1234')).toBeNull();
  });

  it('PeerJS の ID は接頭辞 + コード（PeerJS の ID の文字の制限に合う）', () => {
    const id = hostPeerId('ABC234');
    expect(id).toBe(`${NET_CONFIG.room.peerIdPrefix}ABC234`);
    expect(id).toMatch(/^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/);
  });

  it('コードが使用中なら作り直す', async () => {
    const net = new MemoryNetwork();
    const first = await HostRoom.create({ open: net.open, profile: profile('A'), rng: () => 0 });
    let calls = 0;
    // 1 回目は同じコード（使用中）、2 回目から別のコード
    const rng = (): number => (calls++ < NET_CONFIG.room.codeLength ? 0 : 0.5);
    const second = await HostRoom.create({ open: net.open, profile: profile('B'), rng });
    expect(second.code).not.toBe(first.code);
  });
});

describe('room: 参加と名簿', () => {
  it('ホスト + 3 人が参加し、全員の名簿と ID がそろう', async () => {
    const { host, clients } = await createLobby(3, { latencyMs: 50 });
    expect(host.players.map((p) => p.id)).toEqual([0, 1, 2, 3]);
    expect(clients.map((c) => c.localPlayerId)).toEqual([1, 2, 3]);
    for (const c of clients) {
      expect(c.players.map((p) => p.name)).toEqual(['HOST', 'P1', 'P2', 'P3']);
      expect(c.settings).toEqual(NET_CONFIG.defaultSettings);
    }
  });

  it('5 人目は満員で断られる', async () => {
    const { net, host, clients } = await createLobby(3);
    let error: unknown = null;
    ClientRoom.join(host.code, {
      open: net.open,
      profile: profile('P4'),
      now: () => net.now,
    }).catch((e: unknown) => {
      error = e;
    });
    await pump(net, 100, [host, ...clients]);
    expect(error).toBeInstanceOf(JoinFailure);
    expect((error as JoinFailure).reason).toBe('full');
    expect(host.players).toHaveLength(4);
  });

  it('知らないコードは not-found', async () => {
    const net = new MemoryNetwork();
    await expect(
      ClientRoom.join('ZZZZZZ', { open: net.open, profile: profile('X') }),
    ).rejects.toMatchObject({ reason: 'not-found' });
  });

  it('開始後の参加は断られる', async () => {
    const { net, host, clients } = await createLobby(1);
    host.start();
    let reason = '';
    ClientRoom.join(host.code, {
      open: net.open,
      profile: profile('late'),
      now: () => net.now,
    }).catch((e: unknown) => {
      if (e instanceof JoinFailure) reason = e.reason;
    });
    await pump(net, 100, [host, ...clients]);
    expect(reason).toBe('started');
  });

  it('開始は全員に届く', async () => {
    const { net, host, clients } = await createLobby(2, { latencyMs: 80 });
    const started: number[] = [];
    clients.forEach((c, i) => {
      c.onStart(() => started.push(i));
    });
    host.start();
    expect(host.started).toBe(true);
    await pump(net, 100);
    expect(started.sort()).toEqual([0, 1]);
  });
});

describe('room: 切断', () => {
  it('クライアントが抜けると名簿から消え、ホストに知らせる', async () => {
    const { net, host, clients } = await createLobby(2);
    const left: number[] = [];
    host.onPlayerLeave((id) => left.push(id));
    clients[0]?.leave();
    await pump(net, 50);
    expect(left).toEqual([1]);
    expect(host.players.map((p) => p.id)).toEqual([0, 2]);
    expect(clients[1]?.players.map((p) => p.id)).toEqual([0, 2]);
  });

  it('ホストが閉じると全員に「ホストが切断」が届く', async () => {
    const { net, host, clients } = await createLobby(3, { latencyMs: 40 });
    const reasons: string[] = [];
    for (const c of clients) c.onEnd((r) => reasons.push(r));
    host.leave();
    await pump(net, 100);
    expect(reasons).toEqual(['host-left', 'host-left', 'host-left']);
  });

  it('ホストが黙って落ちても、無通信の時間切れで全員が終わる', async () => {
    const { net, host, clients } = await createLobby(2);
    const reasons: string[] = [];
    for (const c of clients) c.onEnd((r) => reasons.push(r));
    // ping は続くので時間切れにならない
    await pump(net, SILENCE_MS + 1000, [host, ...clients]);
    expect(reasons).toEqual([]);
    // ホストのタブが落ちた（接続を閉じる知らせなし）
    const t = (host as unknown as { transport: { crash(): void } }).transport;
    t.crash();
    await pump(net, SILENCE_MS + 1000, clients);
    expect(reasons).toEqual(['host-left', 'host-left']);
  });

  it('ping で往復時間を測る', async () => {
    const { net, host, clients } = await createLobby(1, { latencyMs: 60 });
    await pump(net, 1500, [host, ...clients]);
    expect(clients[0]?.rtt()).toBeCloseTo(120, -1);
    expect(host.rtt(1)).toBeCloseTo(120, -1);
    await settle();
  });
});
