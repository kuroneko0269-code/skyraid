// ネフィルガの遅延チャンク（9-6c で ?dev=kaiju2 の確かめる場から一般のものにした。読むのは src/ui/kaiju2-link.ts）:
// ソロのレイド（判定は missions/kaiju2-dev.ts）と協力のレイドの表示元（ホストの本体・クライアントの写し。setCoop）を、
// 形（render/kaiju2-model/）・HUD・ブリーフィング・音で出す。
// ?dev=kaiju2 のときだけ（9-6a）: フリーフライトにネフィルガを出し、左に値の表示（状態・段階・次の攻撃・スタミナ・距離・部位・
// 当てた回数・三角形。タップ / クリックで畳む）。URL: ?k2hp=<1〜100>（体力の割合 → 段階）・?k2break=wingL,wingR,head,tail
import './kaiju2-dev.css';
import type { Scene } from 'three';
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
import { Kaiju2Hud, type Kaiju2CoopFrame } from './kaiju2-hud';

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
  /** 画質の機体の細かさ（今の値をすぐと、変わるたび） */
  readonly onDetail: (fn: (d: AircraftDetail) => void) => void;
  /** 描画フレームごと（補間の alpha） */
  readonly onRender: (fn: (alpha: number) => void) => void;
  /** 9-6b: HUD を出しているか（H キー）・音のエンジン・リスナー（カメラ）の位置 */
  readonly hudVisible: () => boolean;
  readonly audio: GameAudio;
  readonly listener: Readonly<{ x: number; y: number; z: number }>;
  /** ?dev=kaiju2: フリーフライトに出す・値の表示 */
  readonly devFree: boolean;
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
  p.onDetail((d) => {
    obj.setDetail(d);
  });
  const hud = new Kaiju2Hud(document.body);
  const briefing = new Kaiju2Briefing(document.body);
  const kit = new SfxKit(p.audio.engine, p.listener);
  const sounds = new Kaiju2SoundWatch(
    new Kaiju2Sounds(kit),
    new KaijuSounds(kit, new CombatSounds(kit)),
  );
  const panel = document.createElement('div');
  panel.className = 'kaiju2-dev';
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
  p.onRender((alpha) => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const state = p.state();
    const raid = coop?.raid ?? dev.raid;
    const active = coop !== null || dev.freeFlying || dev.raiding;
    const shown = active && SHOWN.includes(state) && raid.body.visible;
    obj.setVisible(shown);
    if (shown) obj.update(raid.body, alpha, dt, raid.flash / KAIJU2_RAID_CONFIG.flashSeconds);
    // レイドの HUD・ブリーフィング（協力のブリーフィングは開始前に協力の画面が出す）
    if ((coop || dev.raiding) && HUD_SHOWN.includes(state)) {
      const sel = p.play.session.combat.targeting.selected;
      const locked = sel instanceof Kaiju2PartTarget ? sel : null;
      hud.update(raid, p.hudVisible(), locked, coop ? coop.frame() : null);
      if (!coop && raid.elapsed < lastElapsed) briefing.show(raid.difficulty);
      lastElapsed = coop ? Infinity : raid.elapsed;
    } else {
      hud.hide();
      if (!dev.raiding) lastElapsed = Infinity;
    }
    briefing.update(dt, dev.raiding && state === 'flight');
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
