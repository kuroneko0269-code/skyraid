// ミッションのテスト用の偽の世界（MissionWorld）。値を直接書き換えて状況を作る
import type { Vec3 } from '../src/flight/math';
import type { EscortState } from '../src/missions/mission-props';
import type { MissionEvents, MissionRunner } from '../src/missions/runner';
import type { DestroyableKind, MissionDef, SpawnDef } from '../src/missions/types';
import type { MissionWorld } from '../src/missions/world';

export class FakeWorld implements MissionWorld {
  playerPosition: Vec3 = { x: 0, y: 500, z: 0 };
  playerPrevPosition: Vec3 = { x: 0, y: 500, z: 0 };
  playerActive = true;
  playerDowns = 0;
  playerDamageTaken = 0;
  playerMaxHp = 200;
  escortLost = false;
  kaijuDamageRatio = 0;
  /** 護衛対象（グループ名 → 様子） */
  readonly escorts = new Map<string, EscortState>();
  readonly spawned: SpawnDef[] = [];
  readonly destroyed = new Map<string, number>();

  spawn(def: SpawnDef): void {
    this.spawned.push(def);
  }

  destroyedCount(kind: DestroyableKind, group?: string): number {
    return this.destroyed.get(group === undefined ? kind : `${kind}:${group}`) ?? 0;
  }

  escort(group: string): EscortState | null {
    return this.escorts.get(group) ?? null;
  }

  /** 撃墜を 1 つ足す */
  kill(kind: DestroyableKind, group?: string): void {
    for (const key of group === undefined ? [kind] : [kind, `${kind}:${group}`])
      this.destroyed.set(key, (this.destroyed.get(key) ?? 0) + 1);
  }

  /** 自機を動かす（前の位置を残す） */
  moveTo(x: number, y: number, z: number): void {
    this.playerPrevPosition = { ...this.playerPosition };
    this.playerPosition = { x, y, z };
  }
}

/** 最小のミッション（上書きして使う） */
export function missionDef(over: Partial<MissionDef> = {}): MissionDef {
  return {
    id: 'test',
    mapId: 'island',
    start: { x: 0, y: 500, z: 0, headingDeg: 0 },
    parTimeSeconds: 60,
    spawns: [],
    objectives: [],
    success: 'allRequiredObjectives',
    failConditions: ['playerDown', 'timeUp', 'outOfBounds', 'escortLost'],
    reward: { baseCredits: 1000 },
    ...over,
  };
}

export const DT = 1 / 60;

/** seconds 秒ぶん step を回す */
export function run(step: (dt: number) => void, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) step(DT);
}

/** ランナーのイベントを短い文字列で記録する */
export function record(runner: MissionRunner): string[] {
  const log: string[] = [];
  const types: (keyof MissionEvents)[] = [
    'objective:activate',
    'objective:progress',
    'objective:complete',
    'mission:end',
    'mission:reward',
    'mission:abort',
  ];
  for (const type of types) {
    runner.bus.on(type, (p) => {
      const o = p as { id?: string; current?: number; result?: { outcome: string } };
      log.push(
        type === 'objective:progress'
          ? `progress ${o.id}:${o.current}`
          : `${type} ${o.id ?? o.result?.outcome ?? ''}`.trim(),
      );
    });
  }
  return log;
}
