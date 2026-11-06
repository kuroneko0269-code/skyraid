// 通算の記録（9-10b。v11 から。Three.js・DOM 非依存）: 撃墜・出撃・成功・飛行時間・距離・機動・リング・協力・PvP などの数を
// 「キー → 数」の平たい表で持つ（キーの作り方は statKey と docs/spec.md の「勲章・実績」）。勲章の段階の数え（src/data/badges-catalog.ts）が
// このキーを読む。数えるのは 9-10b の版を入れた日から（それより前の分は 0 から）。リプレイの再生・チュートリアルは数えない。
// 足すのは飛行を出たとき（src/missions/badges/tally.ts）と協力・PvP の対戦の終わり（ui/badge-link.ts）だけ
import { isObject } from './save-settings';

export interface SaveStats {
  /** キー → 数（0 以上の有限の数。飛行時間は秒・距離は m） */
  counts: Record<string, number>;
  /** 数え始めた時刻（ミリ秒。0 はまだ） */
  since: number;
  /** 日替わりを最後に遊んだ日（日本時間の YYYY-MM-DD。遊んだ日数の数え） */
  lastDaily: string | null;
}

/** キーに使える文字（ほかは読み捨てる。中身の確かめ） */
const KEY_PATTERN = /^[a-zA-Z0-9._:-]{1,64}$/;
/** キーの数の上限（壊れた値で膨らまないように） */
const MAX_KEYS = 4000;

export function defaultStats(): SaveStats {
  return { counts: {}, since: 0, lastDaily: null };
}

/** 読み込んだ値を確かめる（知らない形・負の数・壊れたキーは捨てる） */
export function normalizeStats(raw: unknown): SaveStats {
  const out = defaultStats();
  if (!isObject(raw)) return out;
  if (typeof raw.since === 'number' && Number.isFinite(raw.since) && raw.since > 0)
    out.since = Math.round(raw.since);
  if (typeof raw.lastDaily === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastDaily))
    out.lastDaily = raw.lastDaily;
  if (!isObject(raw.counts)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw.counts)) {
    if (n >= MAX_KEYS) break;
    if (!KEY_PATTERN.test(k) || typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
    out.counts[k] = v;
    n++;
  }
  return out;
}

/** 数を足す（キーが正しくない・0 以下は無視） */
export function addStat(s: SaveStats, key: string, amount = 1): void {
  if (!(amount > 0) || !Number.isFinite(amount) || !KEY_PATTERN.test(key)) return;
  s.counts[key] = (s.counts[key] ?? 0) + amount;
}

/** 足す分の表（キー → 数）をまとめて足す。数え始めの時刻も（まだなら） */
export function addStats(s: SaveStats, add: Readonly<Record<string, number>>, at: number): void {
  if (s.since <= 0) s.since = Math.round(at);
  for (const [k, v] of Object.entries(add)) addStat(s, k, v);
}

/** 日替わりを遊んだ日（日本時間の YYYY-MM-DD）。前と違う日なら遊んだ日数を 1 つ足す */
export function addDailyDay(s: SaveStats, day: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || s.lastDaily === day) return;
  s.lastDaily = day;
  addStat(s, 'daily.days');
}

/** 今の数（無ければ 0） */
export function statOf(s: Readonly<SaveStats>, key: string): number {
  return s.counts[key] ?? 0;
}

/** いくつかのキーの合計 */
export function statSum(s: Readonly<SaveStats>, keys: readonly string[]): number {
  let sum = 0;
  for (const k of keys) sum += statOf(s, k);
  return sum;
}

/** キーの作り方（区切りは「.」。値は英数字の id） */
export const statKey = {
  /** 戦いの撃墜の合計（キャンペーン・レイド・防衛戦の敵機・爆撃機・巡航ミサイル・地上目標。的・怪獣の部位は除く） */
  kills: 'kill',
  killWeapon: (w: string) => `kill.w.${w}`,
  killType: (type: string) => `kill.t.${type}`,
  killMode: (mode: string) => `kill.m.${mode}`,
  killDifficulty: (d: string) => `kill.d.${d}`,
  sorties: 'sortie',
  sortieMode: (mode: string) => `sortie.m.${mode}`,
  /** 遊んだもの別（ミッション id・raid-怪獣・course-コース・defense-マップ・practice-課題・daily-種類。sortieTargetOf） */
  sortieOf: (id: string) => `sortie.of.${id}`,
  sortieDifficulty: (d: string) => `sortie.d.${d}`,
  sortieAssist: (a: string) => `sortie.a.${a}`,
  sortieAircraft: (id: string) => `sortie.ac.${id}`,
  wins: 'win',
  winMode: (mode: string) => `win.m.${mode}`,
  winOf: (id: string) => `win.of.${id}`,
  winDifficulty: (d: string) => `win.d.${d}`,
  winAssist: (a: string) => `win.a.${a}`,
  winAircraft: (id: string) => `win.ac.${id}`,
  /** 飛行時間（秒）・距離（m） */
  flightSeconds: 'time',
  flightMeters: 'dist',
  maneuver: (m: string) => `mv.${m}`,
  rings: 'ring',
  defenseWaves: 'waves',
  /** 被弾なし・撃墜されずにクリア（キャンペーン・レイド） */
  clearNoHit: 'clear.noHit',
  clearNoDown: 'clear.noDown',
  dailyDays: 'daily.days',
  coopPlays: (players: number) => `coop.play.${String(players)}`,
  coopClears: (players: number) => `coop.clear.${String(players)}`,
  pvpPlays: 'pvp.play',
  pvpWins: 'pvp.win',
  pvpKills: 'pvp.kill',
} as const;
