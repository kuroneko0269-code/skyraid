// 10-7e: ヴォルガスの描画へ渡す値（演出の入力）と、描画の口（ミッションの出現物の描画 mission-props-view.ts が読む）。
// 判定の値は読むだけ。入力を作るのは遅延チャンクの src/ui/vorgas-runtime.ts（無ければ決まった値で描く）
import type { KaijuTier } from '../../data/kaiju-look';
import type { KaijuBodyView } from '../../entities/kaiju-display';

type P3 = Readonly<{ x: number; y: number; z: number }>;

export interface VorgasViewInput {
  /** カメラの位置（ワールド） */
  readonly camera: P3;
  /** 頭が追う相手（ソロは自機・協力は自分のカメラ。null は追わない） */
  readonly target: P3 | null;
  /** 足元の床の高さ（海は 0。上陸の水の線・足が水の中か） */
  readonly floor: number;
  /** 倒してからの秒数（生きていれば −1。崩れ落ちる動き） */
  readonly deadTime: number;
  /** 登場の場面の進み（0〜1。出していなければ −1） */
  readonly entrance: number;
  /** 演出（粒・身じろぎ）を進める秒数（止めている間は 0） */
  readonly fxDt: number;
}

/** 描画の口: 見た目の段・描くか・止めている間も進める秒数・入力・足が着いた知らせ（揺れ） */
export interface VorgasLook {
  readonly tier: KaijuTier;
  /** 怪獣を描くか（撮影の計測で隠す） */
  readonly shown: boolean;
  /** 止めている間も演出を進める 1 フレームの秒数（撮影。null で普段どおり） */
  readonly clock: number | null;
  input(body: KaijuBodyView, dt: number): VorgasViewInput;
  /** 粒・濡れ・身じろぎの残りを消すか（撮影の場面を置き直したとき。一度 true を返したら false に戻る） */
  takeReset(): boolean;
  /** 形を動かした時間（ms。撮影の計測） */
  measured(ms: number): void;
  /** 描画の側から、怪獣をすぐ出す / 隠す口を渡す（撮影の計測は描画のループを通らずに描く） */
  bind(apply: (shown: boolean) => void): void;
  /** 足が着いた・膝をついた・倒れた（強さ 0〜1 と位置。カメラの揺れ） */
  impact(strength: number, at: P3): void;
}
