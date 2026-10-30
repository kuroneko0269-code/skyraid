// HUD に渡す 1 フレーム分の値の形。値を作るのは src/ui/hud-feed.ts、描くのは src/ui/hud.ts
import type { Quat } from '../flight/math';
import type { HudAssistFrame } from './hud-assist';
import type { HudOrdnanceFrame } from './hud-ordnance';
import type { HudRadarFrame } from './hud-radar';
import type { HudWeaponsFrame } from './hud-weapons';

/** HUD に渡す 1 フレーム分の値 */
export interface HudFrame {
  /** 速度（m/s 相当） */
  speed: number;
  /** スロットル位置（0〜1） */
  throttle: number;
  afterburnerGauge: number;
  afterburnerActive: boolean;
  afterburnerLocked: boolean;
  /** 位置（m）。y は海面基準の高度 */
  x: number;
  y: number;
  z: number;
  /** 地表（海の上は海面）からの高さ（m） */
  altitudeAboveGround: number;
  /** 失速の度合い（0〜1） */
  stall: number;
  orientation: Readonly<Quat>;
  /** 進行方向マーカーの画面座標（px、左上原点）。null なら隠す（カメラの後ろ） */
  flightPath: { x: number; y: number } | null;
  /** 機銃の熱（0〜1）とオーバーヒート中か（2-1） */
  gunHeat: number;
  gunOverheated: boolean;
  /** 命中直後でヒットマーカーを出すか */
  hitMarker: boolean;
  /** 撃墜数 */
  kills: number;
  /** 索敵・ロック・予測照準・残弾（2-2） */
  weapons: HudWeaponsFrame;
  /** HP（2-3） */
  hp: number;
  maxHp: number;
  /** 敵のミサイルに追われている（MISSILE の点滅） */
  missileWarning: boolean;
  /** レーダーの敵機・ミサイル */
  radar: HudRadarFrame;
  /** ロケット・爆弾・着弾予測点・AAA 警告（2-6） */
  ordnance: HudOrdnanceFrame;
  /** 角度差の矢印・接近 / 離脱・BEHIND（4-12） */
  assist: HudAssistFrame;
}
