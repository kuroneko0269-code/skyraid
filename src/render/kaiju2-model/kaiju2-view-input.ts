// 10-7a: ネフィルガの描画へ runtime が渡す値（演出の入力）
/** 描画の側から渡す値（runtime が作る） */
export interface Kaiju2ViewInput {
  /** カメラの位置（ワールド） */
  readonly camera: Readonly<{ x: number; y: number; z: number }>;
  /** 頭が追う相手（ソロは自機。null は追わない） */
  readonly target: Readonly<{ x: number; y: number; z: number }> | null;
  /** 天候の雨（0〜1） */
  readonly rain: number;
  /** 倒した（レイドの撃破）・咆哮中（段階の変わり目） */
  readonly dead: boolean;
  readonly shout: boolean;
  /** 演出を進める秒数（止めている間は 0） */
  readonly fxDt: number;
}
