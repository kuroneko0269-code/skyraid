// セーブデータのスキーマ（3-1、Three.js・DOM 非依存）: 版番号つきの JSON。読み込むときは
// 古い版から SAVE_MIGRATIONS を順に通して今の版にし、normalizeSave で形と値を確かめる。
// 壊れていたら null（呼ぶ側で初期値に戻す）。書き込み・イベントは save-store.ts
import { DIFFICULTIES, FREE_FLIGHT_ENEMIES, type Difficulty } from '../data/ai';
import { STARTER_AIRCRAFT } from '../data/aircraft';
import { QUALITY_LEVELS, type QualityLevel } from '../data/quality';
import { RANKS, type Rank } from '../data/ranking';
import { SAVE_CONFIG, UPGRADE_KINDS, UPGRADE_LEVELS, type UpgradeKind } from '../data/save';
import { TOUCH_MODES, type TouchMode } from '../data/touch';

/** ミッションごとの記録 */
export interface MissionRecord {
  /** 選べるか（先頭のミッションは記録がなくても選べる） */
  unlocked: boolean;
  /** クリア済みの最高ランク（未クリアは null） */
  bestRank: Rank | null;
}

/** 所持機体ごとの強化レベル（3-3 で使う。今は初期機の Lv1 だけ） */
export type UpgradeLevels = Record<UpgradeKind, number>;

/** 設定（ポーズメニューの設定。1-6 / 2-3 の別キーから統合） */
export interface SaveSettings {
  /** 手動で選んだ画質（null は自動判定） */
  quality: QualityLevel | null;
  /** 自動ダウングレードで下げた画質（手動設定があれば使わない） */
  qualityAuto: QualityLevel | null;
  touchControls: TouchMode;
  /** フリーフライトの敵の有無と難易度 */
  enemies: boolean;
  difficulty: Difficulty;
  /** HUD の表示（H キー / 設定の HUD ON/OFF） */
  hud: boolean;
}

export interface SaveData {
  version: number;
  /** パイロット名（null は未入力 = 初回起動。タイトルの後に入力画面を出す） */
  pilotName: string | null;
  credits: number;
  missions: Record<string, MissionRecord>;
  aircraft: {
    selected: string;
    owned: Record<string, UpgradeLevels>;
  };
  settings: SaveSettings;
}

export function initialUpgrades(): UpgradeLevels {
  const min = UPGRADE_LEVELS.min;
  return { engine: min, airframe: min, weapons: min, avionics: min };
}

export function defaultSettings(): SaveSettings {
  return {
    quality: null,
    qualityAuto: null,
    touchControls: 'auto',
    enemies: true,
    difficulty: FREE_FLIGHT_ENEMIES.defaultDifficulty,
    hud: true,
  };
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
  };
}

type Json = Record<string, unknown>;

/**
 * 版ごとの移行: キーの版 → 次の版のデータを返す関数。今は v1 だけなので、実際に使われる移行はない。
 * v0 は仕組みの確認用のダミー（版番号がなく、ランクを { id: ランク } で持つ想定の形。tests/save.test.ts）
 */
export const SAVE_MIGRATIONS: Readonly<Record<number, (data: Json) => Json>> = {
  0: (d) => {
    const ranks = isObject(d.ranks) ? d.ranks : {};
    const missions: Record<string, MissionRecord> = {};
    for (const [id, rank] of Object.entries(ranks))
      missions[id] = { unlocked: true, bestRank: isRank(rank) ? rank : null };
    const base = createInitialSave();
    return { ...base, version: 1, credits: d.credits ?? 0, missions };
  },
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
    if (!isObject(levels)) continue;
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
  const s = d.settings;
  const set = save.settings;
  if (s.quality === null || isOneOf(QUALITY_LEVELS, s.quality)) set.quality = s.quality;
  if (s.qualityAuto === null || isOneOf(QUALITY_LEVELS, s.qualityAuto))
    set.qualityAuto = s.qualityAuto;
  if (isOneOf(TOUCH_MODES, s.touchControls)) set.touchControls = s.touchControls;
  if (typeof s.enemies === 'boolean') set.enemies = s.enemies;
  if (isOneOf(DIFFICULTIES, s.difficulty)) set.difficulty = s.difficulty;
  if (typeof s.hud === 'boolean') set.hud = s.hud;
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

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isRank(v: unknown): v is Rank {
  return isOneOf(RANKS, v);
}

function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}
