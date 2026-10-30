// タイトル・モード選択・ポーズなど画面まわりの数値（1-6）。DOM は src/ui/screens/

export const SCREEN_CONFIG = {
  /** 画面遷移のフェード時間（秒）。CSS transition の長さ（CSS 変数 --screen-fade）になる */
  fadeSeconds: 0.3,
  /** 飛行中の ⏸ ボタン（右上）。タッチ操作中は右上のヨーボタンの左隣（間隔 gap）に置く */
  pauseButton: {
    /** 一辺（px）。ヨーボタン（56）より小さくして押し間違いを減らす。タップの最小目安 44 */
    size: 44,
    gap: 12,
  },
  /**
   * タイトル・モード選択の背景のデモカメラ。島の中心の周りを水平に周回し、島の中心を向く。
   * 半径は海岸線（平均 2900m）の外側。画質「低」の霧（4-1 から 2700m で消える。従来は 2100m）でも手前の海岸と山の裾が見える
   */
  demoCamera: {
    /** 周回の中心（島の中心） */
    centerX: 0,
    centerZ: 0,
    radius: 3600,
    /** カメラの高さ（海面基準） */
    height: 600,
    /** 注視点（島の中心）の高さ。山の中腹 */
    lookAtHeight: 200,
    /** 1 周の秒数。150 秒で約 2.4°/秒（ゆっくり）、水平速度は約 150 m/s */
    periodSeconds: 150,
    /** 開始角（度）。0 で起動位置と同じ島の南側（+Z）から */
    startAngleDeg: 0,
    /** 垂直画角（度）。追従カメラの巡航時と同じ */
    fov: 60,
  },
} as const;

export type DemoCameraConfig = typeof SCREEN_CONFIG.demoCamera;
