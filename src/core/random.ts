// シード付き乱数（Three.js 非依存）。地形のノイズ・AI・テストのシミュレーションで共通に使う

/** 32bit のシードから [0, 1) の乱数列を作る（mulberry32） */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 掛け直せるシード付き乱数（7-B のリプレイ）。分布は createRandom と同じ（mulberry32 の [0, 1)）。
 * 状態 state をプロパティに持つので、リプレイのキーフレーム（オブジェクトの写し）に入り、書き戻せば同じ列の続きになる。
 * 部品には next（this に縛った関数）を渡す
 */
export class SeededRandom {
  state: number;

  constructor(seed = 0) {
    this.state = seed >>> 0;
  }

  /** シードを掛け直す（飛行の始め） */
  reseed(seed: number): void {
    this.state = seed >>> 0;
  }

  readonly next = (): number => {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 新しい飛行のシード（32 bit）。シード自体は時刻・Math.random から作ってよい（記録に残すので再生は同じになる） */
export function freshSeed(): number {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
