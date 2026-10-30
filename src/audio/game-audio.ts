// ゲームの音の窓口（4-4）: 飛行の状態（スロットル・速度・失速・ロック・警告）を描画フレームごとに読み、演出のきっかけ（FxEvents）で
// 単発の効果音を鳴らす。画面に合わせて BGM を切り替え、ポーズ中は音量を 30% に。UI のボタンでタップ音・決定音、購入で和音
import type { ScreenState } from '../core/game-state';
import { GUN_SOUND, UI_SOUND_EVENTS } from '../data/audio';
import { HUD_CONFIG } from '../data/hud';
import type { FlightSession } from '../missions/flight-session';
import type { FxEvents } from '../render/fx/fx-events';
import { BgmPlayer } from './bgm';
import type { AudioEngine } from './engine';
import {
  bgmTrackFor,
  engineParams,
  lockTone,
  pickWarning,
  warningTone,
  windParams,
  type EngineParams,
  type WarningFlags,
  type WindParams,
} from './params';
import { FlightLoops } from './sfx/loops';
import { OneShots, type UiSoundKind } from './sfx/oneshots';

/** リスナー（カメラ）の位置と、前方・上方向の単位ベクトル */
export interface ListenerPose {
  x: number;
  y: number;
  z: number;
  fx: number;
  fy: number;
  fz: number;
  ux: number;
  uy: number;
  uz: number;
}

export class GameAudio {
  private loops: FlightLoops | null = null;
  private readonly shots: OneShots;
  private readonly bgm: BgmPlayer;
  private readonly listener = { x: 0, y: 0, z: 0 };
  private readonly engineState: EngineParams = engineParams(0, false);
  private readonly windState: WindParams = windParams(0, 0);
  private readonly warnings: { -readonly [K in keyof WarningFlags]: boolean } = {
    missile: false,
    pullUp: false,
    aaa: false,
    stall: false,
  };
  private lastEnemyGun = -1;

  constructor(
    readonly engine: AudioEngine,
    events: FxEvents,
    private readonly session: FlightSession,
    private readonly groundHeight: (x: number, z: number) => number,
    baseUrl: string,
  ) {
    this.shots = new OneShots(engine, this.listener);
    this.bgm = new BgmPlayer(engine, baseUrl);
    engine.onReady(() => {
      this.loops = new FlightLoops(engine);
    });
    const s = this.shots;
    events.add({
      explosion: (x, y, z, scale) => {
        s.explosion(scale, { x, y, z });
      },
      splash: (x, y, z) => {
        s.explosion('small', { x, y, z });
      },
      playerHit: () => {
        s.hit();
      },
      missileLaunch: (x, y, z, _dx, _dy, _dz, byPlayer) => {
        s.missileLaunch(byPlayer ? null : { x, y, z });
      },
      flak: (x, y, z) => {
        s.flak({ x, y, z });
      },
      playerGun: (n) => {
        for (let i = 0; i < Math.min(n, GUN_SOUND.maxPerFrame); i++) s.gun();
      },
      enemyGun: (x, y, z) => {
        // 敵機の機銃はまとめて enemyInterval より詰めて鳴らさない（15 発/秒 × 機数でボイスを埋めない）
        const now = engine.now;
        if (now - this.lastEnemyGun < GUN_SOUND.enemyInterval) return;
        this.lastEnemyGun = now;
        s.enemyGun({ x, y, z });
      },
      aaaFire: (x, y, z) => {
        s.aaaFire({ x, y, z });
      },
    });
  }

  /** UI の音: ボタンを押すとタップ音（決定・出撃のボタンは決定音）、ハンガーの購入・強化で和音 */
  attachUi(doc: Document): void {
    doc.addEventListener(
      'click',
      (e) => {
        const el = e.target instanceof Element ? e.target.closest('button') : null;
        if (!el || el.disabled) return;
        this.playUi(el.classList.contains('is-primary') ? 'confirm' : 'tap');
      },
      { capture: true },
    );
    doc.addEventListener(UI_SOUND_EVENTS.purchase, () => {
      this.playUi('purchase');
    });
  }

  playUi(kind: UiSoundKind): void {
    this.shots.ui(kind);
  }

  /** 描画フレームごとに呼ぶ */
  frame(state: ScreenState, pose: Readonly<ListenerPose>): void {
    const engine = this.engine;
    engine.setPaused(state === 'pause');
    this.bgm.play(bgmTrackFor(state));
    if (!engine.ready) return;
    const l = this.listener;
    l.x = pose.x;
    l.y = pose.y;
    l.z = pose.z;
    engine.setListener(
      pose.x,
      pose.y,
      pose.z,
      pose.fx,
      pose.fy,
      pose.fz,
      pose.ux,
      pose.uy,
      pose.uz,
    );
    const loops = this.loops;
    if (!loops) return;
    const s = this.session;
    const flying = state === 'flight' || state === 'pause';
    const alive = flying && s.player.active;
    const a = s.aircraft;
    engineParams(a.throttle, a.state.afterburnerActive, this.engineState);
    windParams(a.state.speed, a.state.stall, this.windState);
    loops.updateFlight(this.engineState, this.windState, alive);
    if (state !== 'flight' || !alive) {
      loops.updateTones(null, null);
      return;
    }
    const t = engine.now;
    const tg = s.combat.targeting;
    const lock = tg.selected ? lockTone(tg.lockProgress, tg.locked, t) : null;
    const w = this.warnings;
    const p = a.state.position;
    w.missile = s.incomingMissiles > 0;
    w.pullUp = p.y - this.groundHeight(p.x, p.z) < HUD_CONFIG.groundWarningAgl;
    w.aaa = s.props.aaa.warning;
    w.stall = a.state.stall > HUD_CONFIG.stallThreshold;
    const kind = pickWarning(w);
    loops.updateTones(lock, kind ? warningTone(kind, t) : null);
  }
}
