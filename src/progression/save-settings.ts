// セーブデータの設定の部分（ポーズメニューの設定。Three.js・DOM 非依存）: 型・初期値・読み込んだ値の確認。
// save.ts が 300 行を超えたので分けた（4-11 の事前修正）
import { defaultControls, normalizeControls, type ControlSettings } from '../core/control-settings';
import { DIFFICULTIES, FREE_FLIGHT_ENEMIES, type Difficulty } from '../data/ai';
import { ASSIST_SETTINGS, type AssistKind } from '../data/assist';
import { AUDIO_CONFIG } from '../data/audio';
import { QUALITY_LEVELS, type QualityLevel } from '../data/quality';
import { TOUCH_MODES, type TouchMode } from '../data/touch';

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
  /**
   * 難易度を一度だけ normal → easy にしたか（4-11 の事前修正）。4-12 でフリーフライトの初期値を easy にしたが、
   * それまでに遊んだ端末のセーブは normal のままだったので、読み込みで 1 回だけ直す。以後は触らない
   */
  difficultyEased: boolean;
  /** HUD の表示（H キー / 設定の HUD ON/OFF） */
  hud: boolean;
  /** 夜は HUD の明るさを少し落とす（7-5。設定で無効にできる。版は上げず、ない項目は既定値） */
  nightHudDim: boolean;
  /** フォトモード（7-A）の保存画像の透かし「SkyRaid」（版は上げず、ない項目は既定値の ON） */
  photoWatermark: boolean;
  /** 音量（4-4。v3 から）: マスター / 効果音 / BGM。0〜1 */
  volume: VolumeSettings;
  /** 操作補助（4-12。v4 から）: エイムアシスト / ターゲットカメラ / HUD 補助 */
  assist: AssistSettings;
  /** 操作（4-11。v5 から）: 感度・デッドゾーン・反転・オートレベル・左右入替・振動・ボタンの大きさ・キー割当 */
  controls: ControlSettings;
}

export type AssistSettings = Record<AssistKind, boolean>;

export const ASSIST_KINDS: readonly AssistKind[] = ['aim', 'camera', 'hud'];

export function defaultAssist(): AssistSettings {
  return {
    aim: ASSIST_SETTINGS.aim.defaultOn,
    camera: ASSIST_SETTINGS.camera.defaultOn,
    hud: ASSIST_SETTINGS.hud.defaultOn,
  };
}

export interface VolumeSettings {
  master: number;
  sfx: number;
  bgm: number;
}

export function defaultVolume(): VolumeSettings {
  return { ...AUDIO_CONFIG.defaultVolumes };
}

export function defaultSettings(): SaveSettings {
  return {
    quality: null,
    qualityAuto: null,
    touchControls: 'auto',
    enemies: true,
    difficulty: FREE_FLIGHT_ENEMIES.defaultDifficulty,
    // 新しいセーブは初めから easy なので直す必要がない
    difficultyEased: true,
    hud: true,
    nightHudDim: true,
    photoWatermark: true,
    volume: defaultVolume(),
    assist: defaultAssist(),
    controls: defaultControls(),
  };
}

type Json = Record<string, unknown>;

/** 読み込んだ設定（今の版）を確かめる。不正な項目は既定値のまま */
export function normalizeSettings(s: Json): SaveSettings {
  const set = defaultSettings();
  if (s.quality === null || isOneOf(QUALITY_LEVELS, s.quality)) set.quality = s.quality;
  if (s.qualityAuto === null || isOneOf(QUALITY_LEVELS, s.qualityAuto))
    set.qualityAuto = s.qualityAuto;
  if (isOneOf(TOUCH_MODES, s.touchControls)) set.touchControls = s.touchControls;
  if (typeof s.enemies === 'boolean') set.enemies = s.enemies;
  if (isOneOf(DIFFICULTIES, s.difficulty)) set.difficulty = s.difficulty;
  // 一度だけ normal → easy（印がなければまだ直していない）
  if (s.difficultyEased !== true && set.difficulty === 'normal') set.difficulty = 'easy';
  set.difficultyEased = true;
  if (typeof s.hud === 'boolean') set.hud = s.hud;
  if (typeof s.nightHudDim === 'boolean') set.nightHudDim = s.nightHudDim;
  if (typeof s.photoWatermark === 'boolean') set.photoWatermark = s.photoWatermark;
  if (isObject(s.volume)) {
    const v = s.volume;
    const d = set.volume;
    set.volume = {
      master: volumeOr(v.master, d.master),
      sfx: volumeOr(v.sfx, d.sfx),
      bgm: volumeOr(v.bgm, d.bgm),
    };
  }
  if (isObject(s.assist)) {
    const a = s.assist;
    for (const k of ASSIST_KINDS) {
      const v = a[k];
      if (typeof v === 'boolean') set.assist[k] = v;
    }
  }
  set.controls = normalizeControls(s.controls);
  return set;
}

/** 音量（0〜1 に収める。数でなければ既定値） */
function volumeOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

export function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}
