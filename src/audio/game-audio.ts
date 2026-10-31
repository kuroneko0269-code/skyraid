// ゲームの音の窓口（4-4）: 飛行の状態（スロットル・速度・失速・ロック・警告）を描画フレームごとに読み、演出のきっかけ（FxEvents）で
// 単発の効果音を鳴らす。画面に合わせて BGM を切り替え、ポーズ中は音量を 30% に。UI のボタンでタップ音・決定音、購入で和音
import { isFrozenFlight, type ScreenState } from '../core/game-state';
import { GUN_SOUND, UI_SOUND_EVENTS } from '../data/audio';
import type { RaceSoundKind } from '../data/race';
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
  weatherSoundParams,
  windParams,
  type EngineParams,
  type WeatherSoundInput,
  type WeatherSoundParams,
  type WarningFlags,
  type WindParams,
} from './params';
import { KaijuSoundWatch } from './kaiju-watch';
import type { KaijuBodyView } from '../entities/kaiju-display';
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
  /** 天候（7-5。main.ts が入れる）。null は晴れの昼と同じ */
  weather: (() => Readonly<WeatherSoundInput>) | null = null;
  private readonly weatherState: WeatherSoundParams = { rainGain: 0, windScale: 1 };
  /** 怪獣の音（6-2）と、その表示元（null はミッションの怪獣。協力のクライアントは写しに差し替える） */
  private readonly kaijuWatch: KaijuSoundWatch;
  private kaijuSource: KaijuBodyView | null = null;

  constructor(
    readonly engine: AudioEngine,
    events: FxEvents,
    private readonly session: FlightSession,
    private readonly groundHeight: (x: number, z: number) => number,
    baseUrl: string,
  ) {
    this.shots = new OneShots(engine, this.listener);
    this.bgm = new BgmPlayer(engine, baseUrl);
    this.kaijuWatch = new KaijuSoundWatch(this.shots.kaiju);
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
      // 命中音（4-12）: 1 描画フレームに何発当たっても 1 回（音量はコンプで決める）
      playerGunHit: () => {
        s.gunHit();
      },
      playerKill: () => {
        s.kill();
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
        // フォトモード（7-A）の UI は無音（シャッター音だけ）
        if (!el || el.disabled || el.closest('[data-silent]')) return;
        this.playUi(el.classList.contains('is-primary') ? 'confirm' : 'tap');
      },
      { capture: true },
    );
    doc.addEventListener(UI_SOUND_EVENTS.purchase, () => {
      this.playUi('purchase');
    });
  }

  /** 怪獣の音の表示元を差し替える（協力のクライアント。null でミッションの怪獣） */
  setKaijuSource(body: KaijuBodyView | null): void {
    this.kaijuSource = body;
  }

  playUi(kind: UiSoundKind): void {
    this.shots.ui(kind);
  }

  /** リングレース（7-1）の音 */
  playRace(kind: RaceSoundKind): void {
    this.shots.race(kind);
  }

  /** フォトモード（7-A）のシャッター音 */
  playShutter(): void {
    this.shots.shutter();
  }

  /** 描画フレームごとに呼ぶ */
  frame(state: ScreenState, pose: Readonly<ListenerPose>): void {
    const engine = this.engine;
    // ポーズ・フォトモード（7-A）はマスター 30%（環境音は小さく続く）。フォトモードは効果音をシャッターだけに
    engine.setPaused(isFrozenFlight(state));
    this.shots.muted = state === 'photo';
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
    const s = this.session;
    this.kaijuWatch.update(state === 'flight' ? (this.kaijuSource ?? s.props.kaiju) : null, l);
    const loops = this.loops;
    if (!loops) return;
    const flying = state === 'flight' || isFrozenFlight(state);
    const alive = flying && s.player.active;
    const a = s.aircraft;
    engineParams(a.throttle, a.state.afterburnerActive, this.engineState);
    windParams(a.state.speed, a.state.stall, this.windState);
    // 7-5: 強風は風切り音を大きく（突風で揺らす）、雨は小さなノイズ、夜は環境音を静かに
    const sky = this.weather?.();
    if (sky) {
      weatherSoundParams(sky, engine.now, this.weatherState);
      this.windState.gain *= this.weatherState.windScale;
    }
    loops.updateFlight(this.engineState, this.windState, alive);
    loops.updateRain(sky ? this.weatherState.rainGain : 0, alive);
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
