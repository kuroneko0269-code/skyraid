// セーブデータのスキーマ（3-1、Three.js・DOM 非依存）: 版番号つきの JSON。読み込むときは
// 古い版から SAVE_MIGRATIONS を順に通して今の版にし、normalizeSave で形と値を確かめる。
// 壊れていたら null（呼ぶ側で初期値に戻す）。書き込み・イベントは save-store.ts
import { STARTER_AIRCRAFT, findAircraftModel } from '../data/aircraft';
import { RANKS, type Rank } from '../data/ranking';
import { SAVE_CONFIG } from '../data/save';
import { UPGRADE_KINDS, UPGRADE_LEVELS, type UpgradeKind } from '../data/upgrades';
import { defaultControls } from '../core/control-settings';
import {
  defaultAssist,
  defaultSettings,
  defaultVolume,
  isObject,
  isOneOf,
  normalizeSettings,
  type SaveSettings,
} from './save-settings';
import { normalizeRaces, type RaceRecord } from './save-races';

export {
  defaultAssist,
  defaultSettings,
  defaultVolume,
  type AssistSettings,
  type SaveSettings,
  type VolumeSettings,
} from './save-settings';

/** ミッションごとの記録 */
export interface MissionRecord {
  /** 選べるか（先頭のミッションは記録がなくても選べる） */
  unlocked: boolean;
  /** クリア済みの最高ランク（未クリアは null） */
  bestRank: Rank | null;
}

/** 所持機体ごとの強化レベル（3-3。Lv0 が未強化。v1 までは Lv1 が未強化だった） */
export type UpgradeLevels = Record<UpgradeKind, number>;

/**
 * 一度だけの案内の記録（4-11。v5 から）。tutorialOffered: 初回の「チュートリアルを始めますか？」を出した /
 * tutorialDone: チュートリアルを完了した（報酬は初回だけ）/ hintsFree・hintsMission: タッチ操作のヒントを出した /
 * raidBriefing: 協力レイドのブリーフィングを一度見た（6-6。2 回目からスキップできる。版は上げない: 無い旗は false）
 */
export const SAVE_FLAGS = [
  'tutorialOffered',
  'tutorialDone',
  'hintsFree',
  'hintsMission',
  'raidBriefing',
] as const;
export type SaveFlag = (typeof SAVE_FLAGS)[number];
export type SaveFlags = Record<SaveFlag, boolean>;

export function defaultFlags(): SaveFlags {
  return {
    tutorialOffered: false,
    tutorialDone: false,
    hintsFree: false,
    hintsMission: false,
    raidBriefing: false,
  };
}

export interface SaveData {
  version: number;
  /** パイロット名（null は未入力 = 初回起動。タイトルの後に入力画面を出す） */
  pilotName: string | null;
  credits: number;
  missions: Record<string, MissionRecord>;
  /** 所持機体（3-3）: 選択中の機体 id と、所持している機体 id → 4 系統の強化 Lv。初期機は常に所持 */
  aircraft: {
    selected: string;
    owned: Record<string, UpgradeLevels>;
  };
  settings: SaveSettings;
  flags: SaveFlags;
  /** リングレースの記録（7-1。v6 から）: コース id → 最高ランク・ベスト 5・ゴースト */
  races: Record<string, RaceRecord>;
}

export function initialUpgrades(): UpgradeLevels {
  const min = UPGRADE_LEVELS.min;
  return { engine: min, airframe: min, weapons: min, avionics: min };
}

/** 初期値（初回起動・壊れていたとき・削除の後） */
export function createInitialSave(): SaveData {
  return {
    version: SAVE_CONFIG.version,
    pilotName: null,
    credits: 0,
    missions: {},
    aircraft: {
      selected: STARTER_AIRCRAFT.id,
      owned: { [STARTER_AIRCRAFT.id]: initialUpgrades() },
    },
    settings: defaultSettings(),
    flags: defaultFlags(),
    races: {},
  };
}

type Json = Record<string, unknown>;
/** v1 までの初期機の id（v2 で kestrel に改名） */
const V1_STARTER_ID = 'starter';

/**
 * 版ごとの移行: キーの版 → 次の版のデータを返す関数。
 * - v0 → v1: 仕組みの確認用のダミー（版番号がなく、ランクを { id: ランク } で持つ想定の形。tests/save.test.ts）
 * - v1 → v2（3-3）: 強化 Lv を 1 つ下げる（v1 は Lv1〜5 で Lv1 が未強化、v2 は Lv0〜5）。初期機の id を starter → kestrel
 * - v2 → v3（4-4）: 設定に音量（settings.volume）を足す（初期値）
 * - v3 → v4（4-12）: 設定に操作補助（settings.assist）を足す（初期値）
 * - v4 → v5（4-11）: 設定に操作（settings.controls）、案内の記録（flags）を足す（初期値。どれもまだ出していない扱い）
 * - v5 → v6（7-1）: リングレースの記録（races）を空で足す
 * 難易度の一度だけの normal → easy（4-11 の事前修正）は版によらず normalizeSettings で（印 settings.difficultyEased）
 */
export const SAVE_MIGRATIONS: Readonly<Record<number, (data: Json) => Json>> = {
  0: (d) => {
    const ranks = isObject(d.ranks) ? d.ranks : {};
    const missions: Record<string, MissionRecord> = {};
    for (const [id, rank] of Object.entries(ranks))
      missions[id] = { unlocked: true, bestRank: isRank(rank) ? rank : null };
    const base = createInitialSave();
    const v1Levels = { engine: 1, airframe: 1, weapons: 1, avionics: 1 };
    return {
      ...base,
      version: 1,
      credits: d.credits ?? 0,
      missions,
      aircraft: { selected: V1_STARTER_ID, owned: { [V1_STARTER_ID]: v1Levels } },
    };
  },
  1: (d) => {
    if (!isObject(d.aircraft)) return d;
    const rename = (id: string): string => (id === V1_STARTER_ID ? STARTER_AIRCRAFT.id : id);
    const owned: Json = {};
    const oldOwned = isObject(d.aircraft.owned) ? d.aircraft.owned : {};
    for (const [id, levels] of Object.entries(oldOwned)) {
      if (!isObject(levels)) continue;
      const next: Json = {};
      for (const k of UPGRADE_KINDS) {
        const v = levels[k];
        next[k] = typeof v === 'number' ? v - 1 : v;
      }
      owned[rename(id)] = next;
    }
    const selected = d.aircraft.selected;
    return {
      ...d,
      version: 2,
      aircraft: { selected: typeof selected === 'string' ? rename(selected) : selected, owned },
    };
  },
  2: (d) => {
    if (!isObject(d.settings)) return d;
    return { ...d, version: 3, settings: { ...d.settings, volume: defaultVolume() } };
  },
  3: (d) => {
    if (!isObject(d.settings)) return d;
    return { ...d, version: 4, settings: { ...d.settings, assist: defaultAssist() } };
  },
  4: (d) => {
    if (!isObject(d.settings)) return d;
    return {
      ...d,
      version: 5,
      settings: { ...d.settings, controls: defaultControls() },
      flags: defaultFlags(),
    };
  },
  5: (d) => ({ ...d, version: 6, races: {} }),
};

/**
 * 読み込んだ値（JSON.parse の結果）を今の版に移行して確かめる。壊れている・未知の（新しい）版なら null。
 * 版番号がなければ 0 とみなす
 */
export function migrateSave(
  raw: unknown,
  migrations: Readonly<Record<number, (data: Json) => Json>> = SAVE_MIGRATIONS,
  current: number = SAVE_CONFIG.version,
): SaveData | null {
  if (!isObject(raw)) return null;
  let data: Json = raw;
  let version = data.version === undefined ? 0 : data.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version > current) return null;
  while (version < current) {
    const step = migrations[version];
    if (!step) return null;
    data = step(data);
    version += 1;
    data.version = version;
  }
  return normalizeSave(data);
}

/**
 * 今の版のデータの形と値を確かめる。骨組み（版・クレジット・ミッション・機体・設定）が違えば null。
 * 中身の細かい値（不明なランク・範囲外の強化レベル・不正な設定）は既定値に直して読む
 */
export function normalizeSave(d: Json): SaveData | null {
  if (d.version !== SAVE_CONFIG.version) return null;
  if (typeof d.credits !== 'number' || !Number.isFinite(d.credits)) return null;
  if (!isObject(d.missions) || !isObject(d.aircraft) || !isObject(d.settings)) return null;
  if (d.pilotName !== null && typeof d.pilotName !== 'string') return null;
  const save = createInitialSave();
  save.pilotName = d.pilotName === null ? null : sanitizePilotName(d.pilotName);
  save.credits = clampCredits(d.credits);
  for (const [id, m] of Object.entries(d.missions)) {
    if (!isObject(m)) continue;
    save.missions[id] = {
      unlocked: m.unlocked === true,
      bestRank: isRank(m.bestRank) ? m.bestRank : null,
    };
  }
  const owned = isObject(d.aircraft.owned) ? d.aircraft.owned : {};
  for (const [id, levels] of Object.entries(owned)) {
    // 知らない機体（データから消えた機体など）は捨てる。初期機は createInitialSave で必ず持っている
    if (!isObject(levels) || !findAircraftModel(id)) continue;
    const up = initialUpgrades();
    for (const k of UPGRADE_KINDS) {
      const v = levels[k];
      if (typeof v === 'number' && Number.isInteger(v))
        up[k] = Math.min(UPGRADE_LEVELS.max, Math.max(UPGRADE_LEVELS.min, v));
    }
    save.aircraft.owned[id] = up;
  }
  const selected = d.aircraft.selected;
  if (typeof selected === 'string' && selected in save.aircraft.owned)
    save.aircraft.selected = selected;
  save.settings = normalizeSettings(d.settings);
  if (isObject(d.flags)) {
    for (const k of SAVE_FLAGS) if (d.flags[k] === true) save.flags[k] = true;
  }
  save.races = normalizeRaces(d.races);
  return save;
}

/** パイロット名を整える: 制御文字を除き、前後の空白を落とし、最大文字数（見た目の文字）で切る。空なら既定の名前 */
export function sanitizePilotName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const result = truncateChars(cleaned, SAVE_CONFIG.pilotNameMaxLength).trim();
  return result === '' ? SAVE_CONFIG.defaultPilotName : result;
}

/**
 * 見た目の文字（書記素。絵文字の異体字セレクタ・結合文字も 1 文字）で max 文字に切る。
 * Intl.Segmenter がない環境ではコードポイント単位
 */
export function truncateChars(text: string, max: number): string {
  const chars =
    typeof Intl.Segmenter === 'function'
      ? Array.from(
          new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
          (s) => s.segment,
        )
      : Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('');
}

export function clampCredits(credits: number): number {
  if (!Number.isFinite(credits)) return 0;
  return Math.min(SAVE_CONFIG.maxCredits, Math.max(0, Math.round(credits)));
}

/** JSON 文字列から読む。壊れていれば null */
export function parseSave(text: string): SaveData | null {
  try {
    return migrateSave(JSON.parse(text));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- エクスポート / インポート
// 端末を変えるとき用の文字列: JSON を UTF-8 にして base64（パイロット名に日本語が入っても壊れない）

export function encodeSave(data: SaveData): string {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** エクスポートした文字列を読む。前後・途中の空白と改行は無視する。読めなければ null */
export function decodeSave(text: string): SaveData | null {
  try {
    const binary = atob(text.replace(/\s+/g, ''));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return parseSave(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function isRank(v: unknown): v is Rank {
  return isOneOf(RANKS, v);
}
