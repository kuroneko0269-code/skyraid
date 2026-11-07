// 10-3b: 白鯨アルビオンの遅延チャンク（読むのは src/ui/albion-link.ts）: ソロのレイド（判定は missions/albion-dev.ts）と協力の
// レイドの表示元（ホストの本体・クライアントの写し。差し込み口 net/albion-coop.ts の attachView）を、形（render/albion-model/）・
// HUD・ブリーフィングで出す。協力の差し込み口もここで登録する（ホストは開始の前にこのチャンクを読む）。
// ?dev=albion のときだけ（10-3a）: フリーフライトにアルビオンを出し、左に値の表示（タップ / クリックで畳む）。
// URL: ?abhp=<1〜100>（体力の割合 → 段階）・?abbreak=nestFront,nestMid,nestRear,dorsal,tail,head・?abroute=bay（港湾都市の湾）
import './albion-dev.css';
import type { Scene } from 'three';
import { attackWeights, axisOffset, inCloud } from '../ai/albion-attacks';
import type { ScreenState } from '../core/game-state';
import type { AircraftDetail } from '../data/aircraft-model';
import { ALBION_PARTS, ALBION_TARGET_SPHERES } from '../data/albion';
import { ALBION_RAID_CONFIG } from '../data/albion-raid';
import { ablist, abt } from '../data/albion-text';
import type { MapDef } from '../data/maps';
import type { Vec3 } from '../flight/math';
import type { AlbionGround } from '../entities/albion/albion-body';
import { AlbionPartTarget, type AlbionMinionTarget } from '../entities/albion/albion-target';
import {
  CloudLock,
  attachAlbionDev,
  parseAlbionOptions,
  type AlbionDev,
} from '../missions/albion-dev';
import { setAlbionBriefing } from '../missions/albion-mission';
import type { AlbionRaid } from '../missions/albion-raid';
import type { GamePlay } from '../missions/game-play';
import { registerRaidKaijuHooks } from '../missions/raid-kaiju-hooks';
import { AlbionCoopHost, AlbionCoopMirror, albionRaidPlugin } from '../net/albion-coop';
import { registerRaidPlugin, type RaidPluginView } from '../net/raid-plugin';
import { AlbionObject } from '../render/albion-model/albion-object';
import { AlbionBriefing } from './albion-briefing';
import { AlbionHud, type AlbionCoopFrame } from './albion-hud';

export interface AlbionRuntimeParts {
  readonly play: GamePlay;
  readonly scene: Scene;
  readonly search: string;
  readonly ground: AlbionGround;
  readonly map: () => Pick<MapDef, 'center' | 'id'>;
  readonly state: () => ScreenState;
  readonly inFreeFlight: () => boolean;
  readonly onDetail: (fn: (d: AircraftDetail) => void) => void;
  readonly onRender: (fn: (alpha: number) => void) => void;
  readonly hudVisible: () => boolean;
  /** ?dev=albion: フリーフライトに出す・値の表示 */
  readonly devFree: boolean;
}

export interface AlbionRuntime {
  readonly dev: AlbionDev;
}

/** 協力の表示元（ホストの本体・クライアントの写し） */
interface CoopSource {
  readonly raid: AlbionRaid;
  readonly minions: readonly AlbionMinionTarget[];
  readonly view: RaidPluginView;
}

/** 怪獣を出している画面（ポーズ・フォトモード・結果の画面の後ろも見える） */
const SHOWN: readonly ScreenState[] = ['flight', 'pause', 'photo', 'result'];
/** レイドの HUD を出す画面 */
const HUD_SHOWN: readonly ScreenState[] = ['flight', 'pause'];

export function startAlbion(p: AlbionRuntimeParts): AlbionRuntime {
  setAlbionBriefing(() => ablist('briefing'));
  // 結果の表の部位の列（協力の成績の partDamage の順: 胴・巣・背びれ・尾・頭・子分）
  registerRaidKaijuHooks('albion', {
    partLabels: () => [
      abt('part.body'),
      abt('result.nests'),
      abt('part.dorsal'),
      abt('part.tail'),
      abt('part.head'),
      abt('result.minions'),
    ],
  });
  const dev = attachAlbionDev(p.play, parseAlbionOptions(p.search), {
    ground: p.ground,
    map: p.map,
    freeFlight: p.devFree,
  });
  // 読み込みが遅れてフリーフライトがもう始まっていたら、その場で出す（この飛行のリプレイは怪獣なしの記録と合わない）
  if (p.devFree && p.state() === 'flight' && p.inFreeFlight()) dev.startLate();
  let coop: CoopSource | null = null;
  registerRaidPlugin(
    albionRaidPlugin(
      (view) => {
        if (!view) {
          coop = null;
          hud.hide();
          coopCloud.restore(p.play.session.combat.targeting);
          return;
        }
        const src = view.host instanceof AlbionCoopHost ? view.host : null;
        const mir = view.mirror instanceof AlbionCoopMirror ? view.mirror : null;
        const owner = src ?? mir;
        if (!owner) return;
        coop = { raid: owner.raid, minions: owner.minions, view };
        view.setLockTargets(owner.parts, owner.minions);
      },
      () => ({ title: abt('briefingTitle'), lines: ablist('briefing') }),
    ),
  );
  const obj = new AlbionObject('high');
  p.scene.add(...obj.objects);
  p.onDetail((d) => {
    obj.setDetail(d);
  });
  const hud = new AlbionHud(document.body);
  const briefing = new AlbionBriefing(document.body);
  const panel = document.createElement('div');
  panel.className = 'albion-dev';
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
  const marks = new Map<string, string[]>();
  const coopFrame: { marks: ReadonlyMap<string, readonly string[]>; targeted: boolean } = {
    marks,
    targeted: false,
  };
  // 協力の自機の雲の中のロックの距離（ソロは AlbionDev が固定ステップで）
  const coopCloud = new CloudLock();
  const frameOf = (src: CoopSource): AlbionCoopFrame => {
    marks.clear();
    for (const [index, colors] of src.view.lockMarks()) {
      const part = ALBION_TARGET_SPHERES[index]?.part;
      if (!part) continue;
      marks.set(part, [...(marks.get(part) ?? []), ...colors]);
    }
    coopFrame.targeted = src.view.targeted();
    return coopFrame;
  };
  p.onRender((alpha) => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const state = p.state();
    const raid = coop?.raid ?? dev.raid;
    const minions = coop?.minions ?? dev.minionTargets;
    const active = coop !== null || dev.flying || dev.raiding;
    const shown = active && SHOWN.includes(state) && raid.kaiju.body.visible;
    obj.setVisible(shown);
    if (shown)
      obj.update(
        raid.kaiju,
        alpha,
        dt,
        (i) => minions[i]?.prevPosition ?? raid.kaiju.body.position,
        raid.flash / ALBION_RAID_CONFIG.flashSeconds,
      );
    const me = p.play.session.aircraft.state.position;
    if ((coop || dev.raiding) && HUD_SHOWN.includes(state)) {
      const sel = p.play.session.combat.targeting.selected;
      const locked = sel instanceof AlbionPartTarget ? sel : null;
      const cloud = coop ? raid.kaiju.cloudLeft > 0 && inCloud(raid.kaiju.body, me) : dev.inCloud;
      if (coop) coopCloud.apply(p.play.session.combat.targeting, cloud);
      hud.update(raid, p.hudVisible(), locked, cloud, coop ? frameOf(coop) : null);
      if (!coop && raid.elapsed < lastElapsed) briefing.show(raid.difficulty);
      lastElapsed = coop ? Infinity : raid.elapsed;
    } else {
      hud.hide();
      if (!dev.raiding) lastElapsed = Infinity;
    }
    briefing.update(dt, dev.raiding && state === 'flight');
    panel.hidden = !(p.devFree && !coop && active && state === 'flight');
    if (panel.hidden) return;
    const text = collapsed ? 'ALBION (dev) ▸' : panelText(dev, obj);
    if (text !== lastText) {
      panel.textContent = text;
      lastText = text;
    }
  });
  return { dev };
}

const f0 = (n: number): string => n.toFixed(0);
const f1 = (n: number): string => n.toFixed(1);

/** 値の表示の文（開発用なので英語だけ） */
function panelText(dev: AlbionDev, obj: AlbionObject): string {
  const k = dev.kaiju;
  const b = k.body;
  const pl: Readonly<Vec3> = dev.playerPosition;
  const sw = k.swarm;
  const act = k.attack ? `${k.attack} ${k.action}` : k.action;
  const cands = attackWeights(k, pl).map((c) => `${c.attack}×${f1(c.weight)}`);
  const next =
    k.action === 'idle'
      ? `in ${f1(Math.max(0, k.cooldown))}s [${cands.join(',') || 'none'}]`
      : `${act} ${f1(k.actionLeft)}s left`;
  const broken = ALBION_PARTS.filter((_, i) => k.parts.isBroken(i)).join(',') || 'none';
  const floor = b.floorAt(b.position.x, b.position.z);
  const dist = Math.hypot(pl.x - b.position.x, pl.y - b.position.y, pl.z - b.position.z);
  const o = axisOffset(b, pl);
  const hits = dev.partTargets.reduce((s, t) => s + t.hits, 0);
  const draws =
    1 + (obj.minions.mesh.visible ? 1 : 0) + obj.fx.objects.filter((m) => m.visible).length;
  const r = dev.raid;
  return [
    `ALBION (dev)${dev.raiding ? ` raid ${r.difficulty} ${f0(r.elapsed)}s` : ''}  ${f0(k.elapsed)}s  lap ${f1(b.laps)}`,
    `state  ${act} ${f1(k.actionTime)}s${b.turning ? '  (turning)' : ''}`,
    `phase  ${String(k.phase)}  hp ${f0(k.parts.hp)}/${f0(k.parts.maxHp)} (${f0(k.parts.ratio * 100)}%)`,
    `next   ${next}`,
    `cloud  ${k.cloudLeft > 0 ? `${f1(k.cloudLeft)}s` : '-'}${dev.inCloud ? '  PLAYER IN CLOUD' : ''}`,
    `minion ${String(sw.activeCount)}/${String(sw.limit)}  wave in ${f1(Math.max(0, sw.timer))}s`,
    `       spawned ${String(sw.spawned)} kills ${String(sw.kills)} gone ${String(sw.expired)} rams ${String(k.rams)}`,
    `dist ${f0(dist)}m  side ${f0(o.side)}m  above ${f0(o.above)}m`,
    `alt ${f0(b.position.y)}m  agl ${f0(b.position.y - floor)}m  spd ${f1(b.speed)}`,
    `broken ${broken}`,
    `hits on kaiju ${String(hits)}  taken s${String(dev.taken.spout)} t${String(dev.taken.slam)} r${String(dev.taken.ram)}`,
    `tris ${String(obj.triangles)} + minion ${String(obj.minions.triangles)}×n  draws ${String(draws)}`,
    dev.lateStart ? 'LATE START (replay differs)' : '',
  ]
    .filter((s) => s !== '')
    .join('\n');
}
