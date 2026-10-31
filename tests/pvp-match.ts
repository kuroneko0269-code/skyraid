// PvP の対戦のテストの共通部分（5-4）: インメモリのネットワークでホスト 1 + クライアント n の対戦を始め、
// 全員の固定ステップを進める。表示（PvpMirror）は通さず、戦闘の操作（LocalCombat）を直接入れる
import { FLIGHT_CONFIG } from '../src/data/flight';
import { Aircraft, createControls, type AircraftControls } from '../src/entities/aircraft';
import { ClientGame } from '../src/net/client-game';
import { HostGame } from '../src/net/host-game';
import { netLoadout } from '../src/net/loadout';
import { createLocalCombat, type LocalCombat, type NetGame } from '../src/net/net-game';
import type { EventMsg, GameSettings, ScoreMsg } from '../src/net/protocol';
import type { MemoryNetworkOptions } from '../src/net/transport';
import { createLobby, seeded, settle, type Lobby } from './net-helpers';

export const DT = 1 / 60;
const TICK_MS = 1000 / 60;

export interface Match {
  readonly lobby: Lobby;
  readonly host: HostGame;
  /** 参加者のゲーム（クライアントの順。lobby.clients と同じ並び） */
  readonly clients: ClientGame[];
  /** プレイヤー ID → 自機 */
  readonly owns: Aircraft[];
  /** プレイヤー ID → このステップの操作（毎ステップ初めに中立に戻す） */
  readonly controls: AircraftControls[];
  readonly combat: LocalCombat[];
  /** プレイヤー ID → 受け取った event（ホストは自分の判定） */
  readonly events: EventMsg[][];
  /** プレイヤー ID → 最後に受け取った成績 */
  readonly scores: (ScoreMsg | null)[];
  /** 固定ステップ 1 回分（ネットワーク・部屋・全員のゲーム）。止めたい人（落ちたタブ）は skip に入れる */
  step(skip?: ReadonlySet<number>): void;
  /** seconds 秒進める（Promise の続き（再接続）を 10 ステップごとに流す） */
  run(seconds: number, each?: (k: number) => void, skip?: ReadonlySet<number>): Promise<void>;
  game(id: number): NetGame | null;
}

function kestrel(groundHeight?: (x: number, z: number) => number): Aircraft {
  return new Aircraft(netLoadout('kestrel', undefined).flight, {}, FLIGHT_CONFIG, groundHeight);
}

export async function startMatch(
  n: number,
  options: MemoryNetworkOptions,
  settings: Partial<GameSettings> = {},
  countdownSeconds = 0,
  groundHeight?: (x: number, z: number) => number,
  seed = 11,
): Promise<Match> {
  const lobby = await createLobby(n, options, seed);
  const room = lobby.host;
  room.setSettings({ ...room.settings, ...settings });
  for (let i = 0; i < 20; i++) {
    lobby.net.advance(10);
    await settle();
  }
  const owns = [0, 1, 2, 3].map(() => kestrel(groundHeight));
  const clients: ClientGame[] = [];
  lobby.clients.forEach((c) => {
    c.onStart(() => {
      clients.push(
        new ClientGame(
          c,
          { own: owns[c.localPlayerId] ?? kestrel(), countdownSeconds },
          () => lobby.net.now,
        ),
      );
    });
  });
  room.start();
  const host = new HostGame(
    room,
    { own: owns[0] ?? kestrel(), rng: seeded(seed + 7), countdownSeconds, groundHeight },
    () => lobby.net.now,
  );
  for (let i = 0; i < 30 && clients.length < n; i++) {
    lobby.net.advance(10);
    await settle();
  }
  if (clients.length < n) throw new Error('client games not started');
  clients.sort((a, b) => a.localId - b.localId);
  const events: EventMsg[][] = [[], [], [], []];
  const scores: (ScoreMsg | null)[] = [null, null, null, null];
  host.onEvent((e) => events[0]?.push({ ...e }));
  host.onScore((s) => (scores[0] = s));
  for (const c of clients) {
    c.onEvent((e) => events[c.localId]?.push({ ...e }));
    c.onScore((s) => (scores[c.localId] = s));
  }
  const controls = [0, 1, 2, 3].map(() => createControls());
  const combat = [0, 1, 2, 3].map(() => createLocalCombat());
  const rooms = [room, ...lobby.clients];
  let k = 0;
  const game = (id: number): NetGame | null =>
    id === 0 ? host : (clients.find((c) => c.localId === id) ?? null);
  const step = (skip: ReadonlySet<number> = new Set()): void => {
    lobby.net.advance(TICK_MS);
    for (const r of rooms) if (!r.ended && !skip.has(r.localPlayerId)) r.tick();
    for (let id = 0; id < 4; id++) {
      const g = game(id);
      const ctl = controls[id];
      const cmb = combat[id];
      if (!g || !ctl || !cmb || skip.has(id)) continue;
      if (id !== 0 && lobby.clients.find((c) => c.localPlayerId === id)?.ended) continue;
      g.step(ctl, cmb, DT);
      g.samples(0, lobby.net.now);
    }
  };
  const run = async (
    seconds: number,
    each?: (k: number) => void,
    skip?: ReadonlySet<number>,
  ): Promise<void> => {
    const end = k + Math.round(seconds * 60);
    while (k < end) {
      k++;
      for (const c of controls) Object.assign(c, createControls());
      for (const c of combat) Object.assign(c, createLocalCombat());
      each?.(k);
      step(skip);
      if (k % 10 === 0) await settle();
    }
  };
  return { lobby, host, clients, owns, controls, combat, events, scores, step, run, game };
}
