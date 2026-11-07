// 10-2: ホストの協力レイドの怪獣の用意（host-game.ts から）と、怪獣ごとの差し込み口（net/raid-plugin.ts）の怪獣の持ち方。
// 設定の怪獣が差し込み口に登録されていれば PluginSlot（ヴォルガス・ネフィルガは登録しないので null。乱数も使わない: 今までと同じ）。
// Three.js 非依存
import type { PvpArena } from '../combat/pvp-arena';
import { raidKaijuOf } from '../data/raid-kaiju';
import type { GroundHeightFn } from '../entities/aircraft';
import type { BuildingField } from '../combat/buildings';
import {
  createKaiju2Host,
  createRaidHost,
  useRaidRespawn,
  type RaidScoreSource,
} from './host-raid';
import type { Kaiju2Host } from './kaiju2-host';
import type { EventMsg, GameSettings, RaidEventMsg, RaidExtraMsg } from './protocol';
import {
  RAID_EVENT_MAX_BYTES,
  RAID_EXTRA_MAX_BYTES,
  findRaidPlugin,
  type RaidPluginHost,
} from './raid-plugin';
import type { RaidHost } from './raid-host';

interface HostRoomLike {
  readonly players: readonly unknown[];
  readonly settings: GameSettings;
  broadcast(msg: RaidEventMsg, channel: 'reliable'): void;
}

interface HostDepsLike {
  readonly groundHeight?: GroundHeightFn;
  readonly kaijuGround?: (x: number, z: number) => number;
  readonly buildings?: BuildingField | null;
  readonly rng?: () => number;
}

/** 差し込み口の怪獣（ホストの本体 host を持ち、進める・配る・成績の口をまとめる） */
export class PluginSlot implements RaidScoreSource {
  constructor(
    readonly host: RaidPluginHost,
    private readonly room: HostRoomLike,
  ) {}

  get outcome(): number {
    return this.host.outcome;
  }

  get targetId(): number | null {
    return this.host.targetId;
  }

  get remaining(): number {
    return this.host.remaining;
  }

  fields(id: number): ReturnType<RaidPluginHost['fields']> {
    return this.host.fields(id);
  }

  /** 進め、溜まったできごとを確実な経路で全員へ（ホスト自身は本体を直接読む） */
  step(dt: number, tick: number): void {
    this.host.step(dt);
    const bytes = limit(this.host.takeEvents(), RAID_EVENT_MAX_BYTES, 'events');
    if (bytes)
      this.room.broadcast(
        { type: 'kx', kaiju: this.room.settings.raidKaiju, tick, bytes },
        'reliable',
      );
  }

  /** state に載せる欄 */
  extra(): RaidExtraMsg {
    const bytes = limit(this.host.state(), RAID_EXTRA_MAX_BYTES, 'state') ?? new Uint8Array(0);
    return { kaiju: this.room.settings.raidKaiju, bytes };
  }
}

/** 上限を超えた中身は送らない（怪獣のタスクの作りの誤り。console に出して気づけるように） */
function limit(bytes: Uint8Array | null, max: number, what: string): Uint8Array | null {
  if (!bytes || bytes.length <= max) return bytes;
  console.error(`raid plugin ${what}: ${String(bytes.length)} bytes > ${String(max)}`);
  return null;
}

/** 設定の怪獣が差し込み口に登録されていれば用意し、arena をレイドの復帰にする */
export function createPluginSlot(
  arena: PvpArena,
  room: HostRoomLike,
  deps: HostDepsLike,
): PluginSlot | null {
  const s = room.settings;
  const plugin = s.mode === 'raid' ? findRaidPlugin(raidKaijuOf(s.raidKaiju)) : null;
  if (!plugin) return null;
  useRaidRespawn(arena, s.hard);
  const rng = deps.rng ?? Math.random;
  const host = plugin.createHost({
    arena,
    players: room.players.length,
    settings: s,
    ...(deps.groundHeight ? { groundHeight: deps.groundHeight } : {}),
    ...(deps.kaijuGround ? { kaijuGround: deps.kaijuGround } : {}),
    seed: Math.floor(rng() * 0xffffffff),
  });
  return new PluginSlot(host, room);
}

/**
 * 協力レイドの怪獣を用意する（レイドでなければ全部 null）: ネフィルガ → 差し込み口の怪獣 → ヴォルガスの順に見て、どれか 1 つ。
 * 9-6c までと同じく、ネフィルガの種だけホストの乱数から取る（ヴォルガスは取らない）
 */
export function createRaidHosts(
  arena: PvpArena,
  room: HostRoomLike,
  deps: HostDepsLike,
  emit: (e: EventMsg) => void,
): [Kaiju2Host | null, PluginSlot | null, RaidHost | null] {
  if (room.settings.mode !== 'raid') return [null, null, null];
  const raid2 = createKaiju2Host(arena, room, deps, deps.rng ?? Math.random);
  if (raid2) return [raid2, null, null];
  const slot = createPluginSlot(arena, room, deps);
  if (slot) return [null, slot, null];
  return [null, null, createRaidHost(arena, room, deps, emit)];
}
