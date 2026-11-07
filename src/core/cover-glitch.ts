// 10-1c: 幕のロゴのグリッチの計算（DOM 非依存。テストする）。強さの波（測り直しの試みで跳ね、合間は弱く、
// 移り始める前に一番強く、移る間に収まる）と、1 歩ごとの乱れ（小刻みな揺れ・色ずれ・横の帯ずれ・ちらつき / 欠け・ノイズの帯）。
// 描くのは cover-glitch-view.ts

export interface GlitchConfig {
  readonly stepMinMs: number;
  readonly stepMaxMs: number;
  readonly idle: number;
  readonly pulse: number;
  readonly pulseMs: number;
  readonly peak: number;
  readonly peakMs: number;
  readonly landEase: number;
  readonly jitterPx: number;
  readonly splitPx: number;
  readonly bands: number;
  readonly bandChance: number;
  readonly bandPx: number;
  readonly flickerChance: number;
  readonly flickerAlpha: number;
  readonly flickerGapMs: number;
  readonly scanline: number;
  readonly noise: number;
}

/** 強さを決める時刻（ms。performance.now() の値。無ければ null） */
export interface GlitchClock {
  /** 最後に測り直しを試みた時刻 */
  readonly pulseAt: number | null;
  /** 外すと決めて一番強い乱れを始めた時刻 */
  readonly peakAt: number | null;
  /** タイトルの文字へ移り始めた時刻（peakAt + peakMs） */
  readonly landAt: number | null;
  /** 移る時間（ms） */
  readonly landMs: number;
}

/** その時刻の乱れの強さ（0〜1） */
export function glitchLevel(now: number, k: GlitchClock, c: GlitchConfig): number {
  if (k.landAt !== null && now >= k.landAt) {
    const p = (now - k.landAt) / Math.max(1, k.landMs);
    return p >= 1 ? 0 : c.peak * Math.pow(1 - p, c.landEase);
  }
  if (k.peakAt !== null && now >= k.peakAt) return c.peak;
  if (k.pulseAt === null) return c.idle;
  const left = 1 - (now - k.pulseAt) / Math.max(1, c.pulseMs);
  return left <= 0 ? c.idle : c.idle + (c.pulse - c.idle) * Math.min(1, left);
}

/** 横の帯（ロゴの高さに対する割合 0〜1 の上端・下端と、左右のずれ px。hidden は一瞬の欠け） */
export interface GlitchBand {
  readonly top: number;
  readonly bottom: number;
  readonly offset: number;
  readonly hidden: boolean;
}

/** 1 歩の乱れ（強さ 0 ならすべて 0・帯なし・濃さ 1） */
export interface GlitchFrame {
  readonly level: number;
  readonly dx: number;
  readonly dy: number;
  /** 色ずれ（赤は +split、青緑は −split） */
  readonly split: number;
  /** ロゴの濃さ（ちらつき） */
  readonly alpha: number;
  /** 空なら帯に切らない */
  readonly bands: readonly GlitchBand[];
  /** ちらつき・欠けを起こした（光過敏への配慮で flickerGapMs の間をあける） */
  readonly flicker: boolean;
  /** 走査線・ノイズの帯の濃さと、ノイズの帯の位置（幕の高さに対する割合）と太さ（割合） */
  readonly scanline: number;
  readonly noise: number;
  readonly noiseY: number;
  readonly noiseH: number;
  /** 次の歩までの間（ms） */
  readonly nextMs: number;
}

export const CALM_FRAME: GlitchFrame = {
  level: 0,
  dx: 0,
  dy: 0,
  split: 0,
  alpha: 1,
  bands: [],
  flicker: false,
  scanline: 0,
  noise: 0,
  noiseY: 0,
  noiseH: 0,
  nextMs: 0,
};

/** −1〜1 */
const signed = (rand: () => number): number => rand() * 2 - 1;

/**
 * 1 歩の乱れを作る。rand は 0〜1 の乱数（テストでは決まった列）。lastFlickerAt は前にちらついた時刻（無ければ null）
 */
export function glitchFrame(
  level: number,
  now: number,
  lastFlickerAt: number | null,
  rand: () => number,
  c: GlitchConfig,
): GlitchFrame {
  const nextMs = c.stepMinMs + (c.stepMaxMs - c.stepMinMs) * rand();
  if (!(level > 0)) return { ...CALM_FRAME, nextMs };
  const canFlicker = lastFlickerAt === null || now - lastFlickerAt >= c.flickerGapMs;
  const flicker = canFlicker && rand() < level * c.flickerChance;
  const bands: GlitchBand[] = [];
  if (rand() < level * c.bandChance) {
    // 切れ目を不規則に（帯の高さはばらばら）。ずらすのは半分ほどの帯
    const cuts = [0, 1];
    for (let i = 1; i < c.bands; i++) cuts.push(rand());
    cuts.sort((a, b) => a - b);
    const hide = flicker ? Math.floor(rand() * (cuts.length - 1)) : -1;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const moved = rand() < 0.5;
      bands.push({
        top: cuts[i] ?? 0,
        bottom: cuts[i + 1] ?? 1,
        offset: moved ? signed(rand) * c.bandPx * level : 0,
        hidden: i === hide,
      });
    }
    if (!bands.some((b) => b.offset !== 0 || b.hidden)) bands.length = 0;
  }
  // 欠けた帯があれば全体は暗くしない（明滅を重ねない）
  const dims = flicker && !bands.some((b) => b.hidden);
  return {
    level,
    dx: signed(rand) * c.jitterPx * level,
    dy: signed(rand) * c.jitterPx * level * 0.5,
    split: (0.4 + 0.6 * rand()) * c.splitPx * level,
    alpha: dims ? c.flickerAlpha : 1,
    bands,
    flicker,
    scanline: c.scanline * level,
    noise: c.noise * level,
    noiseY: rand(),
    noiseH: 0.02 + 0.08 * rand() * level,
    nextMs,
  };
}
