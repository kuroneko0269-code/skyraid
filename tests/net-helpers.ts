// 通信のテストの共通部分: インメモリのネットワークで部屋を作る・時間を進める
import { NET_CONFIG } from '../src/data/net';
import { ClientRoom } from '../src/net/client-room';
import { HostRoom, type PlayerProfile } from '../src/net/room';
import { MemoryNetwork, type MemoryNetworkOptions } from '../src/net/transport';

/** 決定的な乱数（mulberry32） */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function profile(name: string, aircraftId = 'kestrel'): PlayerProfile {
  return { name, aircraftId, upgrades: { engine: 0, airframe: 0, weapons: 0, avionics: 0 } };
}

/** 保留中の Promise の続きを流す */
export function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** ネットワークの時刻を ms 進める（10ms ずつ、Promise の続きと部屋の tick を挟む） */
export async function pump(
  net: MemoryNetwork,
  ms: number,
  rooms: readonly { tick(): void }[] = [],
): Promise<void> {
  for (let t = 0; t < ms; t += 10) {
    net.advance(Math.min(10, ms - t));
    for (const r of rooms) r.tick();
    await settle();
  }
}

export interface Lobby {
  net: MemoryNetwork;
  host: HostRoom;
  clients: ClientRoom[];
}

/** ホスト 1 + クライアント n の部屋を作る（全員の参加が済むまで進める） */
export async function createLobby(
  n: number,
  options: MemoryNetworkOptions = {},
  seed = 1,
): Promise<Lobby> {
  const net = new MemoryNetwork({ rng: seeded(seed + 100), ...options });
  const now = (): number => net.now;
  const rng = seeded(seed);
  const host = await HostRoom.create({ open: net.open, profile: profile('HOST'), rng, now });
  const clients: ClientRoom[] = [];
  for (let i = 0; i < n; i++) {
    const p = ClientRoom.join(host.code, {
      open: net.open,
      profile: profile(`P${i + 1}`),
      rng,
      now,
    });
    const result: { joined: ClientRoom | null; error: unknown } = { joined: null, error: null };
    p.then(
      (c) => {
        result.joined = c;
      },
      (e: unknown) => {
        result.error = e;
      },
    );
    for (let k = 0; k < 200 && !result.joined && !result.error; k++)
      await pump(net, 10, [host, ...clients]);
    if (result.error) throw result.error instanceof Error ? result.error : new Error('参加に失敗');
    if (!result.joined) throw new Error('参加が終わらない');
    clients.push(result.joined);
  }
  return { net, host, clients };
}

export const SILENCE_MS = NET_CONFIG.room.silenceTimeoutSeconds * 1000;
