// ネフィルガの遅延チャンク（9-6c で ?dev=kaiju2 の確かめる場から一般のものにした。読むのは src/ui/kaiju2-link.ts）:
// ソロのレイド（判定は missions/kaiju2-dev.ts）と協力のレイドの表示元（ホストの本体・クライアントの写し。setCoop）を、
// 形（render/kaiju2-model/）・HUD・ブリーフィング・音で出す。
// ?dev=kaiju2 のときだけ（9-6a）: フリーフライトにネフィルガを出し、左に値の表示（状態・段階・次の攻撃・スタミナ・距離・部位・
// 当てた回数・三角形。タップ / クリックで畳む）。URL: ?k2hp=<1〜100>（体力の割合 → 段階）・?k2break=wingL,wingR,head,tail
import './kaiju2-dev.css';
import type { PerspectiveCamera, Scene } from 'three';
import type { FlightFrame } from '../render/flight-frame';
import type { RenderPipeline } from '../render/pipeline';
import type { Kaiju2LinkParts } from './kaiju2-link';
import { parseDevFlags } from '../core/debug-flags';
import { attackCandidates, geometryTo } from '../ai/kaiju2-attacks';
import type { GameAudio } from '../audio/game-audio';
import { Kaiju2SoundWatch } from '../audio/kaiju2-watch';
import { CombatSounds } from '../audio/sfx/combat-sounds';
import { KaijuSounds } from '../audio/sfx/kaiju-sounds';
import { Kaiju2Sounds } from '../audio/sfx/kaiju2-sounds';
import { SfxKit } from '../audio/sfx/kit';
import type { ScreenState } from '../core/game-state';
import type { AircraftDetail } from '../data/aircraft-model';
import { KAIJU2_CONFIG, KAIJU2_PARTS } from '../data/kaiju2';
import { KAIJU2_RAID_CONFIG } from '../data/kaiju2-raid';
import type { MapDef } from '../data/maps';
import { Kaiju2PartTarget } from '../entities/kaiju2/kaiju2-target';
import type { GamePlay } from '../missions/game-play';
import { attachKaiju2Dev, parseKaiju2Options, type Kaiju2Dev } from '../missions/kaiju2-dev';
import { setNephirgaBriefing } from '../missions/kaiju2-mission';
import type { Kaiju2Raid } from '../missions/kaiju2-raid';
import { Kaiju2Object } from '../render/kaiju2-model/kaiju2-object';
import { k2list } from '../data/kaiju2-text';
import { Kaiju2Briefing } from './kaiju2-briefing';
import { Kaiju2Finale } from './kaiju2-finale';
import { Kaiju2Hud, type Kaiju2CoopFrame } from './kaiju2-hud';
import { Kaiju2Cinema } from './kaiju2-cinema';
import { kaijuTier } from '../data/kaiju-look';

/** 9-6c: 協力のレイドの表示元（ホストは本体、クライアントは state の写し）と、HUD の協力の印 */
export interface Kaiju2CoopSource {
  readonly raid: Kaiju2Raid;
  readonly frame: () => Kaiju2CoopFrame;
}

export interface Kaiju2Runtime {
  readonly dev: Kaiju2Dev;
  /** 協力のレイドの表示元を差す（null で外す） */
  setCoop(src: Kaiju2CoopSource | null): void;
}

export interface Kaiju2RuntimeParts {
  readonly play: GamePlay;
  readonly scene: Scene;
  readonly search: string;
  readonly ground: (x: number, z: number) => number;
  readonly map: () => Pick<MapDef, 'center'>;
  readonly state: () => ScreenState;
  /** 今フリーフライトを飛んでいる（読み込みが遅れたときに使う） */
  readonly inFreeFlight: () => boolean;
  /** 画質の機体の細かさとブルーム（今の値をすぐと、変わるたび。10-7a の見た目の段） */
  readonly onDetail: (fn: (d: { aircraftDetail: AircraftDetail; bloom: boolean }) => void) => void;
  /** 描画フレームごと（補間の alpha） */
  readonly onRender: (fn: (alpha: number) => void) => void;
  /** 9-6b: HUD を出しているか（H キー）・音のエンジン・リスナー（カメラ）の位置 */
  readonly hudVisible: () => boolean;
  readonly audio: GameAudio;
  readonly listener: Readonly<{ x: number; y: number; z: number }>;
  /** ?dev=kaiju2: フリーフライトに出す・値の表示 */
  readonly devFree: boolean;
  /** 9-7: 天候を移す（M8 の決戦の演出。3 秒で補間） */
  readonly setWeather: (id: string) => void;
  /** 10-7a: 天候（雨の強さ）・カメラ・演出のカメラの口・描画（撮影）・画面の揺れ・画面の状態の移り */
  readonly weather: Kaiju2LinkParts['weather'];
  readonly camera: PerspectiveCamera;
  readonly frame: FlightFrame;
  readonly pipeline: RenderPipeline;
  readonly shake: (strength: number) => void;
  readonly game: { transition(to: 'pause' | 'flight'): boolean };
}

/** 怪獣を出している画面（ポーズ・フォトモード・結果の画面の後ろも見える） */
const SHOWN: readonly ScreenState[] = ['flight', 'pause', 'photo', 'result'];
/** レイドの HUD を出す画面 */
const HUD_SHOWN: readonly ScreenState[] = ['flight', 'pause'];

export function startKaiju2(p: Kaiju2RuntimeParts): Kaiju2Runtime {
  // 9-6c: ブリーフィングの文（結果の画面の題とブリーフィングの文は起動時に登録した NEPHIRGA_VARIANT が読む）
  setNephirgaBriefing(() => k2list('briefing'));
  const dev = attachKaiju2Dev(p.play, parseKaiju2Options(p.search), {
    ground: p.ground,
    map: p.map,
    freeFlight: p.devFree,
  });
  // 読み込みが遅れてフリーフライトがもう始まっていたら、その場で出す（この飛行のリプレイは怪獣なしの記録と合わない）
  if (p.devFree && p.state() === 'flight' && p.inFreeFlight()) dev.startLate();
  let coop: Kaiju2CoopSource | null = null;
  const obj = new Kaiju2Object('high');
  p.scene.add(...obj.objects);
  obj.attachLights(p.scene);
  p.onDetail((d) => {
    obj.setDetail(kaijuTier(d));
  });
  const hud = new Kaiju2Hud(document.body);
  const briefing = new Kaiju2Briefing(document.body);
  const kit = new SfxKit(p.audio.engine, p.listener);
  const k2sounds = new Kaiju2Sounds(kit);
  const sounds = new Kaiju2SoundWatch(k2sounds, new KaijuSounds(kit, new CombatSounds(kit)));
  // 9-7: M8（キャンペーン版）の登場・段階の変わり目・撃破の演出
  const finale = new Kaiju2Finale(document.body, {
    weather: p.setWeather,
    roar: () => {
      k2sounds.scream('shout', 1);
    },
  });
  // 10-7a: 登場の場面・段階の変わり目と撃破の揺れ・撃破の晴れ間（ソロのレイドだけ）
  const cinema = new Kaiju2Cinema({
    parent: document.body,
    frame: p.frame,
    camera: p.camera,
    shake: p.shake,
    roar: () => {
      k2sounds.scream('shout', 1);
    },
    setWeather: p.setWeather,
    rain: () => p.weather.params.rain,
  });
  let briefingPending = false;
  let fxElapsed = Infinity;
  const panel = document.createElement('div');
  panel.className = 'kaiju2-dev';
  panel.hidden = true;
  let collapsed = false;
  panel.addEventListener('click', () => {
    collapsed = !collapsed;
    panel.classList.toggle('is-collapsed', collapsed);
  });
  document.body.append(panel);
  // 10-7a: 撮影（?dev=kshot）: 止めている間も演出を進める秒数・怪獣を描くか・形を動かす時間
  let shotDt: number | null = null;
  let kaijuShown = true;
  const updateTimes: number[] = [];
  if (parseDevFlags(p.search).has('kshot'))
    void import('./kaiju2-shot').then((m) => {
      m.linkKaiju2Shot({
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
          if (v) obj.update((coop?.raid ?? dev.raid).body, 1, 0);
        },
        updateMs: () => {
          const t = [...updateTimes].sort((a, b) => a - b);
          return t[t.length >> 1] ?? 0;
        },
      });
    });
  let last = performance.now();
  let lastText = '';
  /** 今のレイドの経過（小さくなったら新しいレイド → ブリーフィング） */
  let lastElapsed = Infinity;
  p.onRender((alpha) => {
    const now = performance.now();
    const dt = shotDt ?? Math.min(0.1, (now - last) / 1000);
    last = now;
    const state = p.state();
    const raid = coop?.raid ?? dev.raid;
    const active = coop !== null || dev.freeFlying || dev.raiding;
    const shown = active && SHOWN.includes(state) && raid.body.visible && kaijuShown;
    obj.setVisible(shown);
    // 新しく始まった（やり直し・再生のシーク）: 破片・煙の残りを消す
    if (raid.elapsed < fxElapsed) obj.resetEffects(raid.body);
    fxElapsed = raid.elapsed;
    if (shown) {
      const t0 = performance.now();
      obj.update(raid.body, alpha, dt, raid.flash / KAIJU2_RAID_CONFIG.flashSeconds, {
        camera: p.camera.position,
        // 頭が追う相手: ソロは自機、協力は自分のカメラ（自機のすぐ後ろ）
        target: coop ? p.camera.position : dev.playerPosition,
        rain: p.weather.params.rain,
        dead: raid.dead,
        shout: raid.shout > 0,
        fxDt: shotDt ?? (state === 'flight' ? dt : 0),
      });
      updateTimes.push(performance.now() - t0);
      if (updateTimes.length > 120) updateTimes.shift();
    }
    cinema.update(
      !coop && dev.raiding && HUD_SHOWN.includes(state) && shotDt === null ? raid : null,
      state === 'flight',
      dt,
    );
    // レイドの HUD・ブリーフィング（協力のブリーフィングは開始前に協力の画面が出す）
    if ((coop || dev.raiding) && HUD_SHOWN.includes(state)) {
      const sel = p.play.session.combat.targeting.selected;
      const locked = sel instanceof Kaiju2PartTarget ? sel : null;
      hud.update(raid, p.hudVisible() && !cinema.active, locked, coop ? coop.frame() : null);
      // 9-7: キャンペーン版はブリーフィングの画面で読んだので出さない（登場の演出を出す）。
      // 10-7a: 登場の場面の後に出す
      if (!coop && !raid.campaign && raid.elapsed < lastElapsed) briefingPending = true;
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
    finale.update(
      !coop && dev.raiding && raid.campaign && HUD_SHOWN.includes(state) ? raid : null,
      state === 'flight',
      dt,
    );
    kit.muted = state === 'photo';
    sounds.update(active && state === 'flight' ? raid : null, p.listener);
    panel.hidden = !(p.devFree && !coop && active && state === 'flight');
    if (panel.hidden) return;
    const text = collapsed ? 'NEPHIRGA (dev) ▸' : panelText(dev, obj.triangles);
    if (text !== lastText) {
      panel.textContent = text;
      lastText = text;
    }
  });
  return {
    dev,
    setCoop(src) {
      coop = src;
      if (!src) hud.hide();
    },
  };
}

const f0 = (n: number): string => n.toFixed(0);
const f1 = (n: number): string => n.toFixed(1);

/** 値の表示の文（開発用なので英語だけ。遊ぶ人に出すときに i18n の表へ） */
function panelText(dev: Kaiju2Dev, triangles: number): string {
  const k = dev.body;
  const r = dev.raid;
  const target = dev.playerPosition;
  const g = geometryTo(k, target);
  const due = k.diveWait >= KAIJU2_CONFIG.attacks.dive.dueSeconds;
  const cands = attackCandidates(g, k.phase, k.broken, k.history, due);
  const act = k.attack ? `${k.attack} ${k.state}` : k.state;
  const next =
    k.state === 'cruise'
      ? `${cands[0] ?? '-'} in ${f1(Math.max(0, k.attackCooldown))}s [${cands.join(',') || 'none'}]`
      : '-';
  const broken = KAIJU2_PARTS.filter((x) => k.broken[x]).join(',') || 'none';
  const floor = k.floorAt(k.position.x, k.position.z);
  return [
    `NEPHIRGA (dev)${dev.raiding ? ` raid ${r.difficulty} ${f0(r.elapsed)}s` : ''}`,
    `state  ${act} ${f1(k.stateTime)}s`,
    `phase  ${String(k.phase)}  hp ${f0(r.hp)}/${f0(r.maxHp)} (${f0(k.hpRatio * 100)}%)`,
    `next   ${next}`,
    `stamina ${f0(Math.max(0, k.stamina))}s`,
    `dist ${f0(g.distance)}m  ang ${f0(g.angle)}°`,
    `alt ${f0(k.position.y)}m  agl ${f0(k.position.y - floor)}m  spd ${f0(k.speed)}`,
    `broken ${broken}`,
    `hits o${String(k.hits.orbs)} g${String(k.hits.gust)} d${String(k.hits.dive)} t${String(k.hits.tail)}`,
    `tris ${String(triangles)}  ${dev.lateStart ? 'LATE START (replay differs)' : ''}`,
  ].join('\n');
}
