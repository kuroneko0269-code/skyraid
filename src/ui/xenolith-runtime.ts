// 10-5b: UFO ゼノリスの遅延チャンク（読むのは src/ui/xenolith-link.ts）: ソロのレイド（判定は missions/xenolith-dev.ts）と協力の
// レイドの表示元（ホストの本体・クライアントの写し。差し込み口 net/xenolith-coop.ts の attachView）を、形（render/xenolith-model/）・
// HUD・ブリーフィング・見失ったときの画面の端の印（画面の外のゼノリス = 水色、画面の外の瞬間移動の移る先 = 白く点滅）で出す。
// 溜め撃ちのロックは HUD の LOCK と警告音（PlayerVitals.extraLock）。協力の差し込み口もここで登録する（ホストは開始の前にこのチャンクを読む）。
// ?dev=xenolith のときだけ（10-5a）: フリーフライトにゼノリスを出し、左に値の表示（タップ / クリックで畳む）。
// URL: ?xnhp=<1〜100>・?xnbreak=gen0,emitter1,...。
// 10-7d: 見た目の段（画質）・登場の場面（空から光の柱で降りてくる。ソロのレイドだけ・タップで飛ばす）・段階 / 撃破 / 海に着いたときの
// 揺れ・撮影（?dev=kshot）
import './xenolith-dev.css';
import type { PerspectiveCamera, Scene } from 'three';
import { parseDevFlags } from '../core/debug-flags';
import type { FlightFrame } from '../render/flight-frame';
import type { RenderPipeline } from '../render/pipeline';
import type { ScreenState } from '../core/game-state';
import type { AircraftDetail } from '../data/aircraft-model';
import type { MapDef } from '../data/maps';
import { XENOLITH_TARGET_SPHERES } from '../data/xenolith';
import { xnlist, xnt } from '../data/xenolith-text';
import type { XenolithGround } from '../entities/xenolith/xenolith-body';
import { XenolithPartTarget } from '../entities/xenolith/xenolith-target';
import type { GamePlay } from '../missions/game-play';
import { registerRaidKaijuHooks } from '../missions/raid-kaiju-hooks';
import {
  attachXenolithDev,
  parseXenolithOptions,
  type XenolithDev,
} from '../missions/xenolith-dev';
import { setXenolithBriefing } from '../missions/xenolith-mission';
import type { XenolithRaid } from '../missions/xenolith-raid';
import { registerRaidPlugin, type RaidPluginView } from '../net/raid-plugin';
import { XenolithCoopHost, XenolithCoopMirror, xenolithRaidPlugin } from '../net/xenolith-coop';
import { XenolithObject } from '../render/xenolith-model/xenolith-object';
import type { XenolithViewInput } from '../render/xenolith-model/xenolith-effects';
import { XENOLITH_RAID_CONFIG } from '../data/xenolith-raid';
import { XENOLITH_VISUAL } from '../data/xenolith-visual';
import { kaijuTier } from '../data/kaiju-look';
import { createXenolithCinema, xenolithDescend } from './xenolith-cinema';
import { showToast } from './toast';
import { XenolithBriefing } from './xenolith-briefing';
import { XenolithEdges } from './xenolith-edge';
import { XenolithHud, xenolithLockedOn, type XenolithCoopFrame } from './xenolith-hud';
import { xenolithPanelText } from './xenolith-panel';

export interface XenolithRuntimeParts {
  readonly play: GamePlay;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly search: string;
  readonly ground: XenolithGround;
  readonly map: () => Pick<MapDef, 'center' | 'id'>;
  readonly state: () => ScreenState;
  readonly inFreeFlight: () => boolean;
  /** 画質の機体の細かさとブルーム（今の値をすぐと、変わるたび。10-7d の見た目の段） */
  readonly onDetail: (fn: (d: { aircraftDetail: AircraftDetail; bloom: boolean }) => void) => void;
  readonly onRender: (fn: (alpha: number) => void) => void;
  readonly hudVisible: () => boolean;
  /** ?dev=xenolith: フリーフライトに出す・値の表示 */
  readonly devFree: boolean;
  /** 10-7d: 天候（雨の強さ）・演出のカメラの口・描画（撮影）・画面の揺れ・画面の状態の移り */
  readonly weather: {
    set(id: string, instant?: boolean): void;
    readonly params: Readonly<{ rain: number }>;
  };
  readonly frame: FlightFrame;
  readonly pipeline: RenderPipeline;
  readonly shake: (strength: number) => void;
  readonly game: { transition(to: 'pause' | 'flight'): boolean };
}

export interface XenolithRuntime {
  readonly dev: XenolithDev;
}

/** 協力の表示元（ホストの本体・クライアントの写し） */
interface CoopSource {
  readonly raid: XenolithRaid;
  readonly view: RaidPluginView;
}

/** 怪獣を出している画面（ポーズ・フォトモード・結果の画面の後ろも見える） */
const SHOWN: readonly ScreenState[] = ['flight', 'pause', 'photo', 'result'];
/** レイドの HUD を出す画面 */
const HUD_SHOWN: readonly ScreenState[] = ['flight', 'pause'];

export function startXenolith(p: XenolithRuntimeParts): XenolithRuntime {
  setXenolithBriefing(() => xnlist('briefing'));
  // 結果の表の部位の列（協力の成績の partDamage の順: 胴・ドーム・砲口・発光体・発生器）
  registerRaidKaijuHooks('xenolith', {
    partLabels: () => [
      xnt('part.hull'),
      xnt('result.dome'),
      xnt('result.cannon'),
      xnt('result.emitters'),
      xnt('result.gens'),
    ],
  });
  const dev = attachXenolithDev(p.play, parseXenolithOptions(p.search), {
    ground: p.ground,
    map: p.map,
    freeFlight: p.devFree,
  });
  // 読み込みが遅れてフリーフライトがもう始まっていたら、その場で出す（この飛行のリプレイは怪獣なしの記録と合わない）
  if (p.devFree && p.state() === 'flight' && p.inFreeFlight()) dev.startLate();
  let coop: CoopSource | null = null;
  const session = p.play.session;
  /** 自分のプレイヤー ID（ソロは 0） */
  const me = (): number => coop?.view.localId() ?? 0;
  const lockOn = (): boolean => {
    const raid = coop?.raid ?? (dev.active ? dev.raid : null);
    return raid !== null && p.state() === 'flight' && xenolithLockedOn(raid, me());
  };
  session.player.extraLock = lockOn;
  registerRaidPlugin(
    xenolithRaidPlugin(
      (view) => {
        if (!view) {
          coop = null;
          hud.hide();
          return;
        }
        const src = view.host instanceof XenolithCoopHost ? view.host : null;
        const mir = view.mirror instanceof XenolithCoopMirror ? view.mirror : null;
        const owner = src ?? mir;
        if (!owner) return;
        coop = { raid: owner.raid, view };
        view.setLockTargets(owner.parts, []);
        session.player.extraLock = lockOn;
      },
      () => ({ title: xnt('briefingTitle'), lines: xnlist('briefing') }),
    ),
  );
  const obj = new XenolithObject('high');
  p.scene.add(...obj.objects);
  obj.attachLights(p.scene);
  p.onDetail((d) => {
    obj.setDetail(kaijuTier(d));
  });
  // 10-7d: 登場の場面（空から光の柱で降りてくる）・段階と撃破の揺れ（ソロのレイドだけ）
  const { cinema, subject } = createXenolithCinema(p);
  let briefingPending = false;
  let fxElapsed = Infinity;
  let wasLanded = false;
  // 10-7d: 撮影（?dev=kshot）: 止めている間も演出を進める秒数・怪獣を描くか・形を動かす時間
  let shotDt: number | null = null;
  let kaijuShown = true;
  let shotDescend = 0;
  const updateTimes: number[] = [];
  if (parseDevFlags(p.search).has('kshot'))
    void import('./xenolith-shot').then((m) => {
      m.linkXenolithShot({
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
          if (v) obj.update(raid.kaiju, 1, 0, 0, view(raid, 0));
        },
        updateMs: () => {
          const t = [...updateTimes].sort((a, b) => a - b);
          return t[t.length >> 1] ?? 0;
        },
        cue: (scene) => {
          obj.clearParticles();
          // 登場の場面の中ほど（光の柱の中を降りてくる途中）
          shotDescend = scene === 'entrance' ? 0.3 : 0;
        },
      });
    });
  const hud = new XenolithHud(document.body);
  const briefing = new XenolithBriefing(document.body);
  const edges = new XenolithEdges(document.body);
  const panel = document.createElement('div');
  panel.className = 'xenolith-dev';
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
  const frameOf = (src: CoopSource): XenolithCoopFrame => {
    marks.clear();
    for (const [index, colors] of src.view.lockMarks()) {
      const part = XENOLITH_TARGET_SPHERES[index]?.part;
      if (!part) continue;
      marks.set(part, [...(marks.get(part) ?? []), ...colors]);
    }
    coopFrame.targeted = src.view.targeted();
    return coopFrame;
  };
  /** 10-7d: 演出の入力（カメラ・雨・撃破・海に着いた・沈む・登場の高さ・演出の秒数） */
  const view = (raid: XenolithRaid, fxDt: number, descend = shotDescend): XenolithViewInput => {
    const landed = raid.dead && raid.landedTime >= 0;
    return {
      camera: p.camera.position,
      rain: p.weather.params.rain,
      dead: raid.dead,
      landed,
      sink: landed ? Math.min(1, raid.landedTime / XENOLITH_RAID_CONFIG.vanishSeconds) : 0,
      descend,
      fxDt,
    };
  };
  p.onRender((alpha) => {
    const now = performance.now();
    const dt = shotDt ?? Math.min(0.1, (now - last) / 1000);
    last = now;
    const state = p.state();
    const raid = coop?.raid ?? dev.raid;
    const k = raid.kaiju;
    const active = coop !== null || dev.flying || dev.raiding;
    const shown = active && SHOWN.includes(state) && k.body.visible && kaijuShown;
    obj.setVisible(shown);
    // 被弾の光（レイドは本体の flash、確かめる場は体力の減り）
    const hp = k.parts.hp;
    flash = raid.flash > 0 ? 1 : hp < lastHp ? 1 : Math.max(0, flash - dt * 12);
    lastHp = hp;
    // 新しく始まった（やり直し・再生のシーク）: 粒・光の残りを消す
    if (raid.elapsed < fxElapsed) obj.resetEffects(k);
    fxElapsed = raid.elapsed;
    const landed = raid.dead && raid.landedTime >= 0;
    if (landed && !wasLanded && active && state === 'flight' && shotDt === null)
      p.shake(XENOLITH_VISUAL.splashShake);
    wasLanded = landed;
    if (shown) {
      const t0 = performance.now();
      const fxDt = shotDt ?? (state === 'flight' ? dt : 0);
      obj.update(
        k,
        alpha,
        dt,
        flash,
        view(raid, fxDt, cinema.active ? xenolithDescend(cinema.progress) : shotDescend),
      );
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
      showToast(xnt('bodyHit'), { seconds: 2 });
    lastBodyHits = dev.taken.body;
    // 見失ったときの手がかり: 画面の外の本体と、画面の外の瞬間移動の移る先（飛行中だけ）
    if (shown && state === 'flight' && !raid.dead && p.hudVisible() && !cinema.active)
      edges.update(
        p.camera,
        obj.group.position,
        k.warp.phase === 'telegraph' ? k.warp.destination : null,
      );
    else edges.hide();
    if ((coop || dev.raiding) && HUD_SHOWN.includes(state)) {
      const sel = session.combat.targeting.selected;
      const locked = sel instanceof XenolithPartTarget ? sel : null;
      hud.update(raid, p.hudVisible() && !cinema.active, locked, coop ? frameOf(coop) : null, me());
      // 10-7d: ブリーフィングは登場の場面の後に出す
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
    const text = collapsed ? 'XENOLITH (dev) ▸' : xenolithPanelText(dev, obj);
    if (text !== lastText) {
      panel.textContent = text;
      lastText = text;
    }
  });
  return { dev };
}
