// 10-5b: UFO ゼノリスの遅延チャンク（読むのは src/ui/xenolith-link.ts）: ソロのレイド（判定は missions/xenolith-dev.ts）と協力の
// レイドの表示元（ホストの本体・クライアントの写し。差し込み口 net/xenolith-coop.ts の attachView）を、形（render/xenolith-model/）・
// HUD・ブリーフィング・見失ったときの画面の端の印（画面の外のゼノリス = 水色、画面の外の瞬間移動の移る先 = 白く点滅）で出す。
// 溜め撃ちのロックは HUD の LOCK と警告音（PlayerVitals.extraLock）。協力の差し込み口もここで登録する（ホストは開始の前にこのチャンクを読む）。
// ?dev=xenolith のときだけ（10-5a）: フリーフライトにゼノリスを出し、左に値の表示（タップ / クリックで畳む）。
// URL: ?xnhp=<1〜100>・?xnbreak=gen0,emitter1,...
import './xenolith-dev.css';
import type { Camera, Scene } from 'three';
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
import { showToast } from './toast';
import { XenolithBriefing } from './xenolith-briefing';
import { XenolithEdges } from './xenolith-edge';
import { XenolithHud, xenolithLockedOn, type XenolithCoopFrame } from './xenolith-hud';
import { xenolithPanelText } from './xenolith-panel';

export interface XenolithRuntimeParts {
  readonly play: GamePlay;
  readonly scene: Scene;
  readonly camera: Camera;
  readonly search: string;
  readonly ground: XenolithGround;
  readonly map: () => Pick<MapDef, 'center' | 'id'>;
  readonly state: () => ScreenState;
  readonly inFreeFlight: () => boolean;
  readonly onDetail: (fn: (d: AircraftDetail) => void) => void;
  readonly onRender: (fn: (alpha: number) => void) => void;
  readonly hudVisible: () => boolean;
  /** ?dev=xenolith: フリーフライトに出す・値の表示 */
  readonly devFree: boolean;
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
  p.onDetail((d) => {
    obj.setDetail(d);
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
  p.onRender((alpha) => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const state = p.state();
    const raid = coop?.raid ?? dev.raid;
    const k = raid.kaiju;
    const active = coop !== null || dev.flying || dev.raiding;
    const shown = active && SHOWN.includes(state) && k.body.visible;
    obj.setVisible(shown);
    // 被弾の光（レイドは本体の flash、確かめる場は体力の減り）
    const hp = k.parts.hp;
    flash = raid.flash > 0 ? 1 : hp < lastHp ? 1 : Math.max(0, flash - dt * 12);
    lastHp = hp;
    if (shown) obj.update(k, alpha, dt, flash);
    if (dev.taken.body > lastBodyHits && !coop && state === 'flight')
      showToast(xnt('bodyHit'), { seconds: 2 });
    lastBodyHits = dev.taken.body;
    // 見失ったときの手がかり: 画面の外の本体と、画面の外の瞬間移動の移る先（飛行中だけ）
    if (shown && state === 'flight' && !raid.dead && p.hudVisible())
      edges.update(
        p.camera,
        obj.group.position,
        k.warp.phase === 'telegraph' ? k.warp.destination : null,
      );
    else edges.hide();
    if ((coop || dev.raiding) && HUD_SHOWN.includes(state)) {
      const sel = session.combat.targeting.selected;
      const locked = sel instanceof XenolithPartTarget ? sel : null;
      hud.update(raid, p.hudVisible(), locked, coop ? frameOf(coop) : null, me());
      if (!coop && raid.elapsed < lastElapsed) briefing.show(raid.difficulty);
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
