// 10-4b: メカ怪獣ゴウライの遅延チャンク（読むのは src/ui/gourai-link.ts）: ソロのレイド（判定は missions/gourai-dev.ts）と協力の
// レイドの表示元（ホストの本体・クライアントの写し。差し込み口 net/gourai-coop.ts の attachView）を、形（render/gourai-model/）・
// HUD・ブリーフィングで出す。協力の差し込み口もここで登録する（ホストは開始の前にこのチャンクを読む）。
// ?dev=gourai のときだけ（10-4a）: フリーフライトにゴウライを出し、左に値の表示（タップ / クリックで畳む）。
// URL: ?grhp=<1〜100>（40 未満で後半）・?grbreak=gunL,podR,...・?grroute=bay（港湾都市の湾）
import './gourai-dev.css';
import type { Scene } from 'three';
import type { ScreenState } from '../core/game-state';
import type { AircraftDetail } from '../data/aircraft-model';
import { GOURAI_TARGET_SPHERES } from '../data/gourai';
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
  readonly onDetail: (fn: (d: AircraftDetail) => void) => void;
  readonly onRender: (fn: (alpha: number) => void) => void;
  readonly hudVisible: () => boolean;
  /** ?dev=gourai: フリーフライトに出す・値の表示 */
  readonly devFree: boolean;
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
  p.onDetail((d) => {
    obj.setDetail(d);
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
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const state = p.state();
    const raid = coop?.raid ?? dev.raid;
    const active = coop !== null || dev.flying || dev.raiding;
    const shown = active && SHOWN.includes(state) && raid.kaiju.body.visible;
    obj.setVisible(shown);
    // 被弾の光（レイドは本体の flash、確かめる場は体力の減り）
    const hp = raid.kaiju.parts.hp;
    flash = raid.flash > 0 ? 1 : hp < lastHp ? 1 : Math.max(0, flash - dt * 12);
    lastHp = hp;
    if (shown) obj.update(raid.kaiju, alpha, dt, p.play.session.aircraft.state.position, flash);
    if (dev.taken.body > lastBodyHits && !coop && state === 'flight')
      showToast(grt('bodyHit'), { seconds: 2 });
    lastBodyHits = dev.taken.body;
    if ((coop || dev.raiding) && HUD_SHOWN.includes(state)) {
      const sel = p.play.session.combat.targeting.selected;
      const locked = sel instanceof GouraiPartTarget ? sel : null;
      hud.update(raid, p.hudVisible(), locked, coop ? frameOf(coop) : null);
      if (!coop && raid.elapsed < lastElapsed) briefing.show(raid.difficulty);
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
