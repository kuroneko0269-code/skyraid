// 送る記録（7-4、Three.js・DOM・Supabase 非依存）: 形・キー・送信前の不正値チェック（SQL の check と同じ規則）。
// レース: key = コース id、value_ms = タイム（ペナルティ・ボーナス込み）。完走だけ
// レイド: key = 難易度、value_ms = 撃破までの時間。ソロのクリアだけ
// 防衛戦: key = マップ id:難易度、value_ms = 終わるまでの時間、detail.waves = クリアした波（0〜10）・detail.hq = 司令部の残り %。ソロだけ
import { AIRCRAFT_MODELS } from '../data/aircraft';
import { COURSES } from '../data/courses';
import { DEFENSE_DIFFICULTIES, DEFENSE_MAPS } from '../data/defense';
import { ONLINE_CONFIG, RECORD_KINDS, type RecordKind } from '../data/online';
import { RACE_CONFIG } from '../data/race';
import { RAID_DIFFICULTIES } from '../data/raid';
import { UPGRADE_LEVELS } from '../data/upgrades';
import { resolveLoadout } from '../progression/loadout';

export type RecordDetail = Readonly<Record<string, string | number | boolean>>;

/** records に insert する 1 行（user_id はサーバーの既定値 auth.uid()） */
export interface RecordInput {
  readonly kind: RecordKind;
  readonly key: string;
  readonly aircraftId: string;
  readonly valueMs: number;
  readonly detail: RecordDetail;
  readonly clientVersion: string;
}

export function isRecordKind(v: unknown): v is RecordKind {
  return typeof v === 'string' && (RECORD_KINDS as readonly string[]).includes(v);
}

/** 防衛戦の key */
export function defenseKey(mapId: string, difficulty: string): string {
  return `${mapId}:${difficulty}`;
}

/** 種類ごとに受け付ける key（SQL の check と同じ） */
export function validKeys(kind: RecordKind): readonly string[] {
  if (kind === 'race') return COURSES.map((c) => c.id);
  if (kind === 'raid') return RAID_DIFFICULTIES;
  return DEFENSE_MAPS.flatMap((m) => DEFENSE_DIFFICULTIES.map((d) => defenseKey(m.mapId, d)));
}

/** いちばん速い機体（全機体の強化 Lv 最大）の速度の絶対上限（m/s） */
export function fastestSpeedLimit(): number {
  const max = UPGRADE_LEVELS.max;
  const levels = { engine: max, airframe: max, weapons: max, avionics: max };
  return Math.max(...AIRCRAFT_MODELS.map((m) => resolveLoadout(m, levels).flight.speed.limit));
}

/**
 * コースの理論最短（ミリ秒）: スタート → 各リングの中心を結ぶ折れ線の長さを、いちばん速い機体の速度の上限で
 * 飛び続けたときの時間から、細いリングのボーナスを全部引いた値（下限 1 秒）。実際には届かない速さ
 */
export function raceTheoreticalMinMs(courseId: string): number | null {
  const c = COURSES.find((x) => x.id === courseId);
  if (!c) return null;
  let length = 0;
  let px = c.start.x;
  let py = c.start.y;
  let pz = c.start.z;
  for (const r of c.rings) {
    length += Math.hypot(r.x - px, r.y - py, r.z - pz);
    px = r.x;
    py = r.y;
    pz = r.z;
  }
  const thin = c.rings.filter((r) => r.kind === 'thin').length;
  const seconds = length / fastestSpeedLimit() - thin * RACE_CONFIG.thinBonusSeconds;
  return Math.floor(Math.max(1, seconds) * 1000);
}

/** レースで受け付ける最小のタイム（ミリ秒）: 理論最短 × 0.5（SQL に同じ値を書く） */
export function raceFloorMs(courseId: string): number | null {
  const min = raceTheoreticalMinMs(courseId);
  return min === null ? null : Math.floor(min * ONLINE_CONFIG.raceFloorRatio);
}

export type RecordProblem =
  'kind' | 'key' | 'aircraft' | 'value' | 'raceTooFast' | 'waves' | 'hq' | 'version';

/** 送る前の確認（サーバーの check と同じ規則）。問題がなければ null。問題があれば送らない */
export function checkRecord(r: RecordInput): RecordProblem | null {
  if (!isRecordKind(r.kind)) return 'kind';
  if (!validKeys(r.kind).includes(r.key)) return 'key';
  if (!/^[a-z0-9-]{1,32}$/.test(r.aircraftId)) return 'aircraft';
  if (!Number.isInteger(r.valueMs) || r.valueMs <= 0 || r.valueMs > ONLINE_CONFIG.valueMaxMs)
    return 'value';
  if (r.clientVersion.length < 1 || r.clientVersion.length > 32) return 'version';
  if (r.kind === 'race') {
    const floor = raceFloorMs(r.key);
    if (floor === null || r.valueMs < floor) return 'raceTooFast';
  }
  if (r.kind === 'defense') {
    const waves = r.detail.waves;
    if (typeof waves !== 'number' || !Number.isInteger(waves)) return 'waves';
    if (waves < 0 || waves > ONLINE_CONFIG.defenseMaxWaves) return 'waves';
    const hq = r.detail.hq;
    if (typeof hq !== 'number' || !Number.isInteger(hq) || hq < 0 || hq > 100) return 'hq';
  }
  return null;
}
