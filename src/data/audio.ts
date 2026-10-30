// 音（4-4）の数値。Web Audio API の合成だけ（音声ファイルは BGM の受け口だけ）。仕組みは src/audio/
// 周波数は Hz、時間は秒、音量（ゲイン）は 0〜1 の倍率、距離は m
import type { ExplosionScale } from './fx';

export const AUDIO_CONFIG = {
  /**
   * 同時発音の上限。常時鳴る音（エンジン・風切り・ロックオン・警告）が loopVoices、
   * 残り（16 − 4 = 12）が単発の効果音のボイス（プールで使い回し、足りなければ一番早く終わるものを止めて使う）
   */
  maxVoices: 16,
  loopVoices: 4,
  /** ポーズ中はミュートせず、マスターをこの割合に */
  pausedVolume: 0.3,
  /** 音量の初期値（ポーズメニューのスライダー。セーブの settings.volume） */
  defaultVolumes: { master: 0.8, sfx: 0.8, bgm: 0.6 },
  /** 音量・音程の変化をなめらかにする時定数（setTargetAtTime） */
  smoothing: 0.06,
  /** 共有するホワイトノイズの長さ（ループして使う） */
  noiseSeconds: 2,
} as const;

/** エンジン: ノイズ（ローパス）+ 低域の鋸波（ローパス）。スロットルでピッチと音量、アフターバーナーで高域のノイズ */
export const ENGINE_SOUND = {
  /** 鋸波の周波数: スロットル 0 → 1 */
  sawFreq: { idle: 42, full: 88 },
  sawGain: { idle: 0.05, full: 0.1 },
  /** 鋸波のローパス（倍音を丸める） */
  sawCutoff: 380,
  /** ノイズのローパスの周波数と音量 */
  noiseCutoff: { idle: 320, full: 1200 },
  noiseGain: { idle: 0.07, full: 0.15 },
  /** アフターバーナー: ハイパスしたノイズを足し、鋸波の周波数を上げる */
  afterburner: { cutoff: 2400, gain: 0.11, pitch: 1.15 },
} as const;

/** 風切り音: 速度に応じたバンドパスのノイズ。高速で高く大きく、失速で低くこもって揺れる（バフェット） */
export const WIND_SOUND = {
  /** この速度の範囲で周波数・音量を補間（下で最小、上で最大） */
  speed: { low: 80, high: 460 },
  cutoff: { low: 260, high: 3000 },
  gain: { low: 0.015, high: 0.16 },
  q: 0.8,
  /** 失速（度合い 1）: 周波数をこの倍率に、Q を上げ、音量に足す */
  stall: { cutoffScale: 0.45, q: 5, gainAdd: 0.05 },
} as const;

/** 機銃: 短いノイズのバースト（ローパス）+ 低域のクリック（サイン波の急な下降）。連射で重ねる */
export const GUN_SOUND = {
  duration: 0.07,
  noiseCutoff: 3200,
  noiseQ: 0.7,
  clickFreq: 140,
  clickEndFreq: 45,
  gain: 0.32,
  /** 1 描画フレームで鳴らす最大の発数（低 fps で一度にたくさん重ねない） */
  maxPerFrame: 2,
  /** 敵機の機銃（位置つき）。1 機あたりこの間隔より詰めて鳴らさない */
  enemyGain: 0.5,
  enemyInterval: 0.09,
} as const;

/** ミサイル発射: ホワイトノイズのスイープ（ローパスの周波数を下げていく） */
export const MISSILE_SOUND = {
  duration: 1.2,
  startCutoff: 5200,
  endCutoff: 260,
  gain: 0.42,
} as const;

export interface ExplosionSound {
  /** 低域のインパルス（サイン波を start → end へ下げる） */
  readonly lowStart: number;
  readonly lowEnd: number;
  readonly lowDecay: number;
  /** フィルタ付きノイズ（ローパスの周波数を cutoff → cutoff × 0.15 へ）の減衰 */
  readonly cutoff: number;
  readonly noiseDecay: number;
  readonly gain: number;
}

/** 爆発: 規模 4 段階（small = 着弾、機体 / 地上目標 / 燃料タンク）。大きいほど低く長く大きい */
export const EXPLOSION_SOUNDS: Readonly<Record<ExplosionScale, ExplosionSound>> = {
  small: { lowStart: 120, lowEnd: 50, lowDecay: 0.35, cutoff: 2600, noiseDecay: 0.6, gain: 0.5 },
  aircraft: { lowStart: 95, lowEnd: 38, lowDecay: 0.6, cutoff: 1900, noiseDecay: 1.2, gain: 0.75 },
  ground: { lowStart: 80, lowEnd: 32, lowDecay: 0.8, cutoff: 1500, noiseDecay: 1.8, gain: 0.9 },
  fuel: { lowStart: 65, lowEnd: 26, lowDecay: 1.2, cutoff: 1100, noiseDecay: 2.8, gain: 1 },
};

/** ロックオン: 進行中は 2Hz のビープ、完了で連続音 */
export const LOCK_SOUND = {
  freq: 1000,
  beepHz: 2,
  duty: 0.45,
  lockedFreq: 1500,
  gain: 0.05,
} as const;

export const WARNING_KINDS = ['missile', 'pullUp', 'aaa', 'stall'] as const;
export type WarningKind = (typeof WARNING_KINDS)[number];

/** 警告: 矩形波のビープ。同時に複数なら WARNING_KINDS の順（先が優先）で 1 つだけ鳴らす */
export const WARNING_SOUND: {
  readonly gain: number;
  readonly duty: number;
  readonly tones: Readonly<Record<WarningKind, { readonly freq: number; readonly beepHz: number }>>;
} = {
  gain: 0.045,
  duty: 0.5,
  tones: {
    missile: { freq: 1250, beepHz: 6 },
    pullUp: { freq: 620, beepHz: 3 },
    aaa: { freq: 880, beepHz: 4 },
    stall: { freq: 420, beepHz: 2.5 },
  },
};

/** 被弾（自機）: 金属的なクリック（矩形波の短い下降）+ 短いハイパスのノイズ */
export const HIT_SOUND = {
  clickFreq: 2300,
  clickEndFreq: 900,
  clickDuration: 0.04,
  noiseCutoff: 2600,
  noiseDuration: 0.09,
  gain: 0.45,
} as const;

/** 対空砲（位置つき）: 砲声とフラックの破裂。爆発の small より軽い */
export const AAA_SOUND = {
  fire: { lowStart: 160, lowEnd: 60, decay: 0.18, cutoff: 1400, gain: 0.5 },
  flak: { lowStart: 110, lowEnd: 45, decay: 0.3, cutoff: 2000, gain: 0.6 },
} as const;

/** UI: タップ・決定・購入（短い和音） */
export const UI_SOUND = {
  gain: 0.22,
  tap: { freq: 1900, duration: 0.035 },
  confirm: { freqs: [880, 1320], step: 0.06, duration: 0.12 },
  purchase: { freqs: [523.25, 659.25, 783.99, 1046.5], step: 0.04, duration: 0.45 },
} as const;

/** 3D 配置（敵機・爆発・対空砲）: PannerNode。自機の音は定位なし */
export const SPATIAL_CONFIG = {
  /** 距離減衰（inverse）: refDistance までは減らさない */
  refDistance: 120,
  rolloffFactor: 1,
  maxDistance: 10000,
  /** これより遠い音は鳴らさない（ボイスを使わない） */
  cullDistance: 6000,
} as const;

/** BGM の受け口: public/audio/bgm/ にあれば再生（ループ、画面遷移で crossfade 秒のクロスフェード）。無ければ無音 */
export const BGM_CONFIG = {
  tracks: {
    title: 'audio/bgm/title.mp3',
    flight: 'audio/bgm/flight.mp3',
    result: 'audio/bgm/result.mp3',
  },
  crossfade: 1,
} as const;

export type BgmTrack = keyof typeof BGM_CONFIG.tracks;

/** UI から音へ知らせる DOM のイベント名（document に投げる）。購入はハンガーの購入・強化が成功したとき */
export const UI_SOUND_EVENTS = {
  purchase: 'skyraid:purchase',
} as const;
