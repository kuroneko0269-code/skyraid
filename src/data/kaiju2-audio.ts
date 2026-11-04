// 9-6b: ネフィルガの効果音の数値（合成。ネフィルガの遅延チャンクだけが読む）。鳴らし方は src/audio/sfx/kaiju2-sounds.ts。
// 巨大なので定位なしで鳴らし、音量は距離で下げる（ヴォルガスの KAIJU_SOUND.distance と同じ考え）
export const KAIJU2_SOUND = {
  distance: { refDistance: 800, minGain: 0.12 },
  /** 羽ばたき（打ち下ろしごと）: 低い風の塊。maxDistance より遠いと鳴らさない */
  flap: { gain: 0.55, cutoff: 170, duration: 0.55, maxDistance: 1600 },
  /** 雷球の予兆: 上がっていく唸り + ぱちぱちの高域 */
  orbCharge: { gain: 0.5, from: 80, to: 420, cutoff: 1800, crackle: 5200, crackleGain: 0.35 },
  /** 雷球を放つ: 高い音が落ちる電撃 + ノイズ */
  orbLaunch: { gain: 0.7, from: 1100, to: 160, duration: 0.45, noiseGain: 0.5 },
  /** 突風: 翼を掲げる間の風の高まりと、放つときの大きな風の音 */
  gustCharge: { gain: 0.45, from: 250, to: 1100 },
  gust: { gain: 0.9, from: 1400, to: 300, q: 0.8, duration: 1.1 },
  /** 急降下: 上昇の終わりの甲高い叫び（降下の始め） */
  dive: { gain: 0.75, freqs: [1250, 1630] as readonly number[], end: 0.55, duration: 1.8, q: 4 },
  /** 尾の打ち払い: 鞭の音 */
  tail: { gain: 0.8, cutoff: 2500, duration: 0.25 },
  /** 段階が変わる・倒れる: 叫び（2 本の鋸歯波を下げる） */
  shout: { gain: 0.8, freqs: [390, 530] as readonly number[], end: 0.6, duration: 2.0, q: 2.5 },
} as const;
