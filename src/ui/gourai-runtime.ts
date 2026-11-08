// 10-4b: メカ怪獣ゴウライの遅延チャンク（読むのは src/ui/gourai-link.ts）: ソロのレイド（判定は missions/gourai-dev.ts）と協力の
// レイドの表示元（ホストの本体・クライアントの写し。差し込み口 net/gourai-coop.ts の attachView）を、形（render/gourai-model/）・
// HUD・ブリーフィングで出す。協力の差し込み口もここで登録する（ホストは開始の前にこのチャンクを読む）。
// ?dev=gourai のときだけ（10-4a）: フリーフライトにゴウライを出し、左に値の表示（タップ / クリックで畳む）。
// URL: ?grhp=<1〜100>（40 未満で後半）・?grbreak=gunL,podR,...・?grroute=bay（港湾都市の湾）。
// 10-7c: 見た目の段（画質）・登場の場面（湾から浮かび上がり目が光る。ソロのレイドだけ・タップで飛ばす）・段階 / 撃破 / 海に着いたときの
// 揺れ・撮影（?dev=kshot）
import './gourai-dev.css';
import type { PerspectiveCamera, Scene } from 'three';
import { parseDevFlags } from '../core/debug-flags';
import type { FlightFrame } from '../render/flight-frame';
import type { RenderPipeline } from '../render/pipeline';
import type { ScreenState } from '../core/game-state';
import type { AircraftDetail } from '../data/aircraft-model';
import { GOURAI_TARGET_SPHERES } from '../data/gourai';
import { GOURAI_RAID_CONFIG } from '../data/gourai-raid';
import { GOURAI_VISUAL } from '../data/gourai-visual';
import { kaijuTier } from '../data/kaiju-look';
import { grlist, grt } from '../data/gourai-text';
import type { MapDef } from '../data/maps';
import type { GouraiGround } from '../entities/gourai/gourai-body';
import { GouraiPartTarget } from '../entities/gourai/gourai-target';
import type { GamePlay } from '../missions/game-play';
import {
  attachGouraiDev,
  missilesOn,
  parseGouraiOptions,
  type GouraiDev,
} from '../missions/gourai-dev';
import { setGouraiBriefing } from '../missions/gourai-mission';
import type { GouraiRaid } from '../missions/gourai-raid';
import { registerRaidKaijuHooks } from '../missions/raid-kaiju-hooks';
import { GouraiCoopHost, GouraiCoopMirror, gouraiRaidPlugin } from '../net/gourai-coop';
import { registerRaidPlugin, type RaidPluginView } from '../net/raid-plugin';
import { GouraiObject } from '../render/gourai-model/gourai-object';
import { GouraiBriefing } from './gourai-briefing';
import { createGouraiCinema, gouraiEntrance } from './gourai-cinema';
import { gouraiPanelText } from './gourai-panel';
import { GouraiHud, type GouraiCoopFrame } from './gourai-hud';
import { showToast } from './toast';

export interface GouraiRuntimeParts {
  readonly play: GamePlay;
  readonly scene: Scene;
  readonly search: string;
  readonly ground: GouraiGround;
  readonly map: () => Pick<MapDef, 'center' | 'id'>;
  readonly state: () => ScreenState;
  readonly inFreeFlight: () => boolean;
  /** 画質の機体の細かさとブルーム（今の値をすぐと、変わるたび。10-7c の見た目の段） */
  readonly onDetail: (fn: (d: { aircraftDetail: AircraftDetail; bloom: boolean }) => void) => void;
  readonly onRender: (fn: (alpha: number) => void) => void;
  readonly hudVisible: () => boolean;
  /** ?dev=gourai: フリーフライトに出す・値の表示 */
  readonly devFree: boolean;
  /** 10-7c: 天候（雨の強さ）・カメラ・演出のカメラの口・描画（撮影）・画面の揺れ・画面の状態の移り */
  readonly weather: {
    set(id: string, instant?: boolean): void;
    readonly params: Readonly<{ rain: number }>;
  };
  readonly camera: PerspectiveCamera;
  readonly frame: FlightFrame;
  readonly pipeline: RenderPipeline;
  readonly shake: (strength: number) => void;
  readonly game: { transition(to: 'pause' | 'flight'): boolean };
}

export interface GouraiRuntime {
  readonly dev: GouraiDev;
}

/** 協力の表示元（ホストの本体・クライアントの写し） */
interface CoopSource {
  readonly raid: GouraiRaid;
  readonly view: RaidPluginView;
}

/** 怪獣を出している画面（ポーズ・フォトモード・結果の画面の後ろも見える） */
const SHOWN: readonly ScreenState[] = ['flight', 'pause', 'photo', 'result'];
/** レイドの HUD を出す画面 */
const HUD_SHOWN: readonly ScreenState[] = ['flight', 'pause'];

export function startGourai(p: GouraiRuntimeParts): GouraiRuntime {
  setGouraiBriefing(() => grlist('briefing'));
  // 結果の表の部位の列（協力の成績の partDamage の順: 胴・核・砲台・排気口）
  registerRaidKaijuHooks('gourai', {
    partLabels: () => [
      grt('part.hull'),
      grt('result.core'),
      grt('result.turrets'),
      grt('result.exhausts'),
    ],
  });
  const dev = attachGouraiDev(p.play, parseGouraiOptions(p.search), {
    ground: p.ground,
    map: p.map,
    freeFlight: p.devFree,
  });
  // 読み込みが遅れてフリーフライトがもう始まっていたら、その場で出す（この飛行のリプレイは怪獣なしの記録と合わない）
  if (p.devFree && p.state() === 'flight' && p.inFreeFlight()) dev.startLate();
  let coop: CoopSource | null = null;
  const session = p.play.session;
  registerRaidPlugin(
    gouraiRaidPlugin(
      (view) => {
        if (!view) {
          coop = null;
          hud.hide();
          session.player.extraIncoming = null;
          return;
        }
        const src = view.host instanceof GouraiCoopHost ? view.host : null;
        const mir = view.mirror instanceof GouraiCoopMirror ? view.mirror : null;
        const owner = src ?? mir;
        if (!owner) return;
        const raid = owner.raid;
        coop = { raid, view };
        view.setLockTargets(owner.parts, []);
        // 協力の自機を追ってくるミサイルを MISSILE の警告に数える
        session.player.extraIncoming = () =>
          missilesOn(raid.kaiju, view.localId(), session.aircraft.state.position);
      },
      () => ({ title: grt('briefingTitle'), lines: grlist('briefing') }),
    ),
  );
  const obj = new GouraiObject('high');
  p.scene.add(...obj.objects);
  obj.attachLights(p.scene);
  p.onDetail((d) => {
    obj.setDetail(kaijuTier(d));
  });
  // 10-7c: 登場の場面（湾から浮かび上がり目が光る）・段階と撃破の揺れ（ソロのレイドだけ）
  const { cinema, subject } = createGouraiCinema(p);
  let briefingPending = false;
  let fxElapsed = Infinity;
  let wasLanded = false;
  // 10-7c: 撮影（?dev=kshot）: 止めている間も演出を進める秒数・怪獣を描くか・形を動かす時間・登場の浮かび上がりと目
  let shotDt: number | null = null;
  let shotRise = 0;
  let shotEyes = 1;
  let kaijuShown = true;
  const updateTimes: number[] = [];
  if (parseDevFlags(p.search).has('kshot'))
    void import('./gourai-shot').then((m) => {
      m.linkGouraiShot({
        raid: () => coop?.raid ?? dev.raid,
        camera: p.camera,
        pipeline: p.pipeline,
        weather: p.weather,
        game: p.game,
        setFxClock: (d) => {
          shotDt = d;
        },
        setKaijuShown: (v) => {
          kaijuShown = v;
          obj.setVisible(v);
          const raid = coop?.raid ?? dev.raid;
          if (v) obj.update(raid.kaiju, 1, 0, p.play.session.aircraft.state.position, 0);
        },
        updateMs: () => {
          const t = [...updateTimes].sort((a, b) => a - b);
          return t[t.length >> 1] ?? 0;
        },
        cue: (scene) => {
          obj.clearParticles();
          // 登場の場面の中ほど（半分浮かび上がり、目が灯った瞬間）
          shotRise = scene === 'entrance' ? 0.42 : 0;
          shotEyes = scene === 'entrance' ? 0.45 : 1;
        },
      });
    });
  const hud = new GouraiHud(document.body);
  const briefing = new GouraiBriefing(document.body);
  const panel = document.createElement('div');
  panel.className = 'gourai-dev';
  panel.hidden = true;
  let collapsed = false;
  panel.addEventListener('click', () => {
    collapsed = !collapsed;
    panel.classList.toggle('is-collapsed', collapsed);
  });
  document.body.append(panel);
  let last = performance.now();
  let lastText = '';
  /** 今のレイドの経過（小さくなったら新しいレイド → ブリーフィング） */
  let lastElapsed = Infinity;
  /** 体への衝突の数（増えたらお知らせ。ソロ） */
  let lastBodyHits = 0;
  let lastHp = dev.kaiju.parts.hp;
  let flash = 0;
  const marks = new Map<string, string[]>();
  const coopFrame: { marks: ReadonlyMap<string, readonly string[]>; targeted: boolean } = {
    marks,
    targeted: false,
  };
  const frameOf = (src: CoopSource): GouraiCoopFrame => {
    marks.clear();
    for (const [index, colors] of src.view.lockMarks()) {
      const part = GOURAI_TARGET_SPHERES[index]?.part;
      if (!part) continue;
      marks.set(part, [...(marks.get(part) ?? []), ...colors]);
    }
    coopFrame.targeted = src.view.targeted();
    return coopFrame;
  };
  p.onRender((alpha) => {
    const now = performance.now();
    const dt = shotDt ?? Math.min(0.1, (now - last) / 1000);
    last = now;
    const state = p.state();
    const raid = coop?.raid ?? dev.raid;
    const active = coop !== null || dev.flying || dev.raiding;
    const shown = active && SHOWN.includes(state) && raid.kaiju.body.visible && kaijuShown;
    obj.setVisible(shown);
    // 被弾の光（レイドは本体の flash、確かめる場は体力の減り）
    const hp = raid.kaiju.parts.hp;
    flash = raid.flash > 0 ? 1 : hp < lastHp ? 1 : Math.max(0, flash - dt * 12);
    lastHp = hp;
    // 新しく始まった（やり直し・再生のシーク）: 破片・煙の残りを消す
    if (raid.elapsed < fxElapsed) obj.resetEffects(raid.kaiju);
    fxElapsed = raid.elapsed;
    const landed = raid.dead && raid.landedTime >= 0;
    if (landed && !wasLanded && active && state === 'flight' && shotDt === null)
      p.shake(GOURAI_VISUAL.splashShake);
    wasLanded = landed;
    if (shown) {
      const t0 = performance.now();
      const entrance = cinema.active ? gouraiEntrance(cinema.progress) : null;
      obj.update(raid.kaiju, alpha, dt, p.play.session.aircraft.state.position, flash, {
        camera: p.camera.position,
        rain: p.weather.params.rain,
        dead: raid.dead,
        landed,
        sink: landed ? Math.min(1, raid.landedTime / GOURAI_RAID_CONFIG.vanishSeconds) : 0,
        rise: entrance ? entrance.rise : shotRise,
        eyes: entrance ? entrance.eyes : shotEyes,
        fxDt: shotDt ?? (state === 'flight' ? dt : 0),
      });
      updateTimes.push(performance.now() - t0);
      if (updateTimes.length > 120) updateTimes.shift();
    }
    subject.raid = raid;
    cinema.update(
      !coop && dev.raiding && HUD_SHOWN.includes(state) && shotDt === null ? subject : null,
      state === 'flight',
      dt,
    );
    if (dev.taken.body > lastBodyHits && !coop && state === 'flight')
      showToast(grt('bodyHit'), { seconds: 2 });
    lastBodyHits = dev.taken.body;
    if ((coop || dev.raiding) && HUD_SHOWN.includes(state)) {
      const sel = p.play.session.combat.targeting.selected;
      const locked = sel instanceof GouraiPartTarget ? sel : null;
      hud.update(raid, p.hudVisible() && !cinema.active, locked, coop ? frameOf(coop) : null);
      // 10-7c: ブリーフィングは登場の場面の後に出す
      if (!coop && raid.elapsed < lastElapsed) briefingPending = true;
      if (briefingPending && !cinema.active) {
        briefingPending = false;
        briefing.show(raid.difficulty);
      }
      lastElapsed = coop ? Infinity : raid.elapsed;
    } else {
      hud.hide();
      if (!dev.raiding) lastElapsed = Infinity;
    }
    briefing.update(dt, dev.raiding && state === 'flight');
    panel.hidden = !(p.devFree && !coop && active && state === 'flight');
    if (panel.hidden) return;
    const text = collapsed ? 'GOURAI (dev) ▸' : gouraiPanelText(dev, obj);
    if (text !== lastText) {
      panel.textContent = text;
      lastText = text;
    }
  });
  return { dev };
}
