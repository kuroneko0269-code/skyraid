// 音（4-4）の数値。Web Audio API の合成だけ（音声ファイルは BGM の受け口だけ）。仕組みは src/audio/
// 周波数は Hz、時間は秒、音量（ゲイン）は 0〜1 の倍率、距離は m
import type { ExplosionScale } from './fx';
import { MISSILE_CONFIG } from './weapons';

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
  /**
   * 効果音のバスの末尾のリミッター（4-11）: DynamicsCompressor。knee 0（しきい値より下は素通し）。
   * Web Audio のコンプは自動でメイクアップゲインを足すので、後ろのゲインで打ち消す（src/audio/params.ts の limiterMakeupCompensation）
   */
  limiter: { thresholdDb: -3, ratio: 20, attackSeconds: 0.002, releaseSeconds: 0.08, kneeDb: 0 },
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

/**
 * 天候の環境音（7-5）。雨はフィルタ付きのノイズ（機内なので小さく、こもった音）。強風は風切り音を大きくし、
 * ゆっくりした突風の揺れを足す。夜は環境音（風切り・雨）を静かにする
 */
export const WEATHER_SOUND = {
  /** 雨（強さ 1）: バンドパスの中心・Q と音量。強さに比例 */
  rain: { cutoff: 1500, q: 0.6, gain: 0.045 },
  /** 強風（風 1）での風切り音の倍率と、突風の揺れ（周期の速さ Hz・深さ） */
  strongWindGain: 1.6,
  gust: { hz: 0.13, depth: 0.3 },
  /** 夜（夜らしさ 1）の環境音の倍率 */
  nightScale: 0.7,
} as const;

/** 低域のパルス（機銃の発射音の重さ・命中音のドン・被弾の衝撃）。hold 秒保ってから duration までに消える */
export interface ThumpSound {
  readonly startFreq: number;
  readonly endFreq: number;
  readonly duration: number;
  readonly hold: number;
  /** ローパス（三角波の倍音をどこまで通すか） */
  readonly cutoff: number;
  readonly gain: number;
  /**
   * 波形。三角波は 3 倍音（-19dB）が 200〜400Hz に乗り、低域の出ないスマホのスピーカーでも基音の高さが聞こえる
   * （4-12b。サイン波だとスマホでは消え、ノイズの「チュ」だけが残る）
   */
  readonly wave: OscillatorType;
}

/**
 * 機銃: 短いノイズのバースト（ローパス）+ 低域のクリック（サイン波の急な下降）+ 重さの低域パルス（4-12。4-12b で
 * 三角波 120 → 80Hz を 0.08 秒・保持 0.03 秒・音量 1.6 倍に。スマホで「チュチュ」と軽く聞こえたため。全体の音量は
 * 0.32 → 0.21 にして、命中音 (a) がピークで 6dB 以上大きくなるようにした）。連射で重ねる
 */
export const GUN_SOUND: {
  readonly duration: number;
  readonly noiseCutoff: number;
  readonly noiseQ: number;
  readonly clickFreq: number;
  readonly clickEndFreq: number;
  readonly gain: number;
  readonly thump: ThumpSound;
  readonly maxPerFrame: number;
  readonly enemyGain: number;
  readonly enemyInterval: number;
} = {
  duration: 0.07,
  noiseCutoff: 3200,
  noiseQ: 0.7,
  clickFreq: 140,
  clickEndFreq: 45,
  gain: 0.21,
  thump: {
    startFreq: 120,
    endFreq: 80,
    duration: 0.08,
    hold: 0.03,
    cutoff: 400,
    gain: 1.45,
    wave: 'triangle',
  },
  /** 1 描画フレームで鳴らす最大の発数（低 fps で一度にたくさん重ねない） */
  maxPerFrame: 2,
  /** 敵機の機銃（位置つき）。1 機あたりこの間隔より詰めて鳴らさない */
  enemyGain: 0.5,
  enemyInterval: 0.09,
};

/**
 * 機銃の命中音 (a)（4-12。自機の弾が敵・目標に当たったとき。定位なしの手応え）: 金属の衝撃（200〜400Hz の部分音 3 つ +
 * 300Hz のバンドパスのノイズ）+ 高域のクラック（ハイパス 3500Hz のノイズ 18ms）+ 低域のドン（三角波 110 → 55Hz）。
 * 4-12b: ピークを発射音より 6dB 以上大きく（ドンを保持つきで長く、金属のノイズの Q を下げて太く）。
 * 連続ヒットはソフトのコンプ: 直近のヒットの量（1 発ごとに +1、時定数 compressTau 秒で減る）を n として
 * 音量を max(minGain, 1 / √(1 + n)) にする（連射中も重さを残す）
 */
export const GUN_HIT_SOUND: {
  readonly gain: number;
  readonly metal: {
    readonly partials: readonly number[];
    readonly partialGain: number;
    readonly noiseFreq: number;
    readonly noiseQ: number;
    readonly noiseGain: number;
    readonly decay: number;
  };
  readonly crack: { readonly cutoff: number; readonly duration: number; readonly gain: number };
  readonly thump: ThumpSound;
  readonly compressTau: number;
  readonly minGain: number;
  readonly minInterval: number;
} = {
  gain: 0.68,
  metal: {
    partials: [230, 310, 385],
    partialGain: 0.6,
    noiseFreq: 300,
    noiseQ: 5,
    noiseGain: 2.6,
    decay: 0.16,
  },
  crack: { cutoff: 3500, duration: 0.018, gain: 0.5 },
  thump: {
    startFreq: 110,
    endFreq: 55,
    duration: 0.13,
    hold: 0.035,
    cutoff: 400,
    gain: 1.5,
    wave: 'triangle',
  },
  compressTau: 0.25,
  /** コンプの下限（4-12b。1/√(1+n) は 15 発/秒で 0.44 まで下がり、連射中に軽くなった） */
  minGain: 0.6,
  /** これより詰めて鳴らさない（1 描画フレームに何発当たっても 1 回） */
  minInterval: 0.03,
};

/**
 * ミサイル発射（4-12 で 3 層に）: 点火のクラック（ハイパス 1500Hz のノイズ 30ms）→ 低域のうなり（鋸波 80 → 50Hz・ローパス 220Hz、
 * 0.8 秒で減衰）→ 離れていくシュー（ノイズのローパスを 6000 → 300Hz へ閉じながら 1.6 秒）。うなりとシューの周波数には
 * ドップラーの倍率（音速 / (音速 + 遠ざかる速さ)。遠ざかる速さは発射機に対して thrust で加速し maxRecede で頭打ち）を掛ける。
 * 自機は定位なし、敵機は位置つき
 */
export const MISSILE_SOUND = {
  duration: 1.6,
  gain: 0.42,
  crack: { cutoff: 1500, duration: 0.03, gain: 1 },
  rumble: { startFreq: 80, endFreq: 50, decay: 0.8, cutoff: 220, gain: 0.8 },
  whoosh: { startCutoff: 6000, endCutoff: 300, q: 1.2, attack: 0.06, gain: 0.7 },
  doppler: {
    soundSpeed: 343,
    thrust: MISSILE_CONFIG.thrust,
    /** 最高速 700 − 巡航 250（ミサイルの初速は母機の速度なので、母機から見た遠ざかる速さの上限） */
    maxRecede: MISSILE_CONFIG.maxSpeed - 250,
    /** スイープを折れ線で近似する点の数 */
    points: 8,
  },
} as const;

/**
 * 撃墜（4-12。自機が敵側を落としたとき、爆発に重ねる。定位なし）: 金属が裂ける音 = バンドパスのノイズ（Q 6）を 2600 → 700Hz へ
 * 下げ、37Hz の矩形波で音量を刻む（裂け目のざらつき）+ 鋸波 2 本（520・733Hz の不協和）を 260・366Hz へ 0.35 秒で下げる
 */
export const KILL_SOUND = {
  duration: 0.45,
  gain: 0.38,
  tear: { startFreq: 2600, endFreq: 700, q: 6, gain: 1.2, ratchetHz: 37, ratchetDepth: 0.6 },
  screech: { freqs: [520, 733], endRatio: 0.5, glide: 0.35, cutoff: 1400, gain: 0.12 },
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

/**
 * 被弾 (b)（敵の弾が自機に当たったとき。定位なし）: コックピットの中で聞く近い衝撃。強い低域（三角波 80 → 38Hz）+
 * 機体の共鳴（170Hz の狭いバンドパスのノイズ）+ 短いこもったノイズ（ローパス 650Hz）。高域は入れない。
 * 4-12b で作り直した（4-4 の矩形波 2300 → 900Hz のクリックは「チュ」と軽く、命中音 (a) とも区別がつかなかった）。
 * 命中音 (a) より大きく、低い
 */
export const PLAYER_HIT_SOUND = {
  gain: 0.7,
  duration: 0.2,
  impact: {
    startFreq: 80,
    endFreq: 38,
    duration: 0.2,
    hold: 0.045,
    cutoff: 260,
    gain: 1.6,
    wave: 'triangle',
  } satisfies ThumpSound,
  hull: { freq: 170, q: 4, gain: 2.4, decay: 0.16 },
  muffle: { cutoff: 650, duration: 0.07, hold: 0.012, gain: 1.3 },
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
  /** PvP（5-4）: 開始前のカウントダウンの 3・2・1 と GO、残り時間の警告（30 秒・10 秒。上がる 2 音の矩形波） */
  countdown: { freq: 660, duration: 0.14 },
  go: { freqs: [990, 1320], step: 0.05, duration: 0.3 },
  alert: { freqs: [1480, 1975], step: 0.12, duration: 0.32 },
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

/**
 * 怪獣の音（6-2。src/audio/sfx/kaiju-sounds.ts）。巨大なので 3D の距離減衰（refDistance 120m）は使わず定位なしで鳴らし、
 * 音量だけを距離で下げる（refDistance まで 1、その先は refDistance / 距離。minGain で下げ止める）
 */
export const KAIJU_SOUND = {
  distance: { refDistance: 700, minGain: 0.12 },
  /** 足音: 低い三角波の落ち込み + 地鳴りのノイズ（ローパス） */
  footstep: {
    gain: 0.9,
    thump: {
      startFreq: 58,
      endFreq: 28,
      duration: 1.4,
      hold: 0.25,
      cutoff: 260,
      gain: 1,
      wave: 'triangle',
    },
    rumble: { cutoff: 140, gain: 0.55, duration: 1.6 },
  },
  /** 咆哮: 低いうなり（鋸歯波 2 本のうなり + ローパス）+ 高域のきしみ（バンドパスのノイズと矩形波の揺れ） */
  roar: {
    gain: 0.8,
    duration: 2.4,
    growl: { freqs: [62, 66.5], endScale: 0.75, cutoff: 520, gain: 0.7 },
    screech: { freq: 2600, q: 5, gain: 0.35, tone: 1150, toneGain: 0.06, vibrato: 7 },
  },
  /** 熱線: 予兆の高まる音と、照射中の持続ノイズ（バンドパスの唸り + 高域のジリジリ） */
  beam: {
    gain: 0.65,
    charge: { from: 180, to: 900, gain: 0.25 },
    hum: { freq: 140, cutoff: 900, gain: 0.5 },
    hiss: { freq: 3200, q: 0.8, gain: 0.35 },
  },
  /** 部位破壊: 砕ける音（低いドン + 広いノイズの破裂 + 結晶なら高い響き） */
  partBreak: {
    gain: 0.9,
    thump: {
      startFreq: 90,
      endFreq: 35,
      duration: 0.9,
      hold: 0.1,
      cutoff: 400,
      gain: 1,
      wave: 'triangle',
    },
    crunch: { cutoff: 1800, gain: 0.7, duration: 0.7 },
  },
  /** ブレイク: 明るい 3 和音の合図（定位なし） */
  breakChime: { gain: 0.35, freqs: [880, 1320, 1760], duration: 0.6 },
} as const;
