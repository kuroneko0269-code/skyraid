// 機体によらない飛行モデルのパラメータ。角度は 度、角速度は 度/秒
// docs/spec.md「4. 飛行モデル」に各数値の意味を書いている

export const FLIGHT_CONFIG = {
  /** 重力加速度（m/s²）。失速時の沈下には使わず、速度の増減にのみ使う */
  gravity: 9.8,
  /** 重力が速度に効く倍率。上昇で減速・降下で加速を誇張してアーケード感を出す */
  gravitySpeedScale: 3.5,
  /** 入力から実際の角速度が立ち上がる速さ（1/秒）。機体の「重さ」 */
  rateResponse: 9,
  stall: {
    /** 失速判定の幅。stall 速度からこの分だけ下で失速の効果が最大になる */
    range: 30,
    /** 失速の効果が最大のときの操舵の効き（0〜1） */
    minAuthority: 0.3,
    /** 失速の効果が最大のときに機首が下がる角速度 */
    noseDropRate: 55,
    /** 失速の効果が最大のときの沈下速度（m/s） */
    sinkSpeed: 18,
  },
  autoLevel: {
    /** バンク角に対する戻す速さ（1/秒）。角速度 = バンク角 × gain */
    gain: 1.2,
    /** 戻すときの最大ロール角速度 */
    maxRate: 50,
    /** 機首の上下（|前方.y|）がこれ以上のときは無効（宙返り中に勝手に回らないように） */
    maxNoseVertical: 0.85,
  },
  /** バンク 90° のときに自然に機首が横へ向く角速度（バンクだけでも少し曲がる） */
  bankTurnRate: 12,
  ceiling: {
    /** 押し戻しが始まる高度（m） */
    start: 3000,
    /** これ以上は上がれない高度（m）。押し戻しも最大 */
    end: 3500,
    /** 押し戻しが最大のときに機首を下げる角速度 */
    pushRate: 60,
  },
  /** 地形を渡さないときの地面の高度（m）。これ以下で衝突。1-3 以降のゲームでは地形の高さを使う */
  groundAltitude: 0,
  spawn: {
    /**
     * 既定の初期位置（m）。墜落リセット時は x/z に墜落地点、y に「その地点の地表 + この y」を使う。
     * ゲームの起動位置は src/data/terrain.ts の WORLD_CONFIG.start
     */
    position: { x: 0, y: 300, z: 0 },
  },
  /** Shift / Z でスロットルが変わる速さ（1/秒） */
  throttleRate: 0.6,
  /** 操作設定の既定値 */
  defaults: {
    autoLevel: true,
    /** false: W = 機首下げ（操縦桿の感覚）。true で反転 */
    invertPitch: false,
  },
} as const;
