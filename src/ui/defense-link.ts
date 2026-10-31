// 防衛戦（7-2。ソロ）と画面・HUD・音・セーブの配線: モード選択の「防衛戦」→ マップ・難易度 →「ソロで出撃」→ 飛行（準備 → 波 × 10）→
// 終わりで報酬をセーブに足す → リザルト（もう一度 / モード選択へ）。協力は PvP のロビー（ui/pvp-link.ts）
import type { Object3D, PerspectiveCamera } from 'three';
import type { GameAudio } from '../audio/game-audio';
import { usesDemoCamera, type GameState } from '../core/game-state';
import {
  DEFENSE_CONFIG,
  FACILITY_KINDS,
  findDefenseMap,
  type DefenseDifficulty,
} from '../data/defense';
import type { DefenseRunner } from '../missions/defense/runner';
import { defenseReward, FACILITY_TOTAL, type DefenseScore } from '../missions/defense/score';
import type { GamePlay } from '../missions/game-play';
import type { SaveStore } from '../progression/save-store';
import { DefenseHudLink } from '../render/defense-hud-link';
import { DefenseHud, type DefenseHudState } from './defense-hud';
import { DefenseResultScreen } from './defense-result';
import type { Screens } from './screens';

export interface DefenseLinkParts {
  readonly game: GameState;
  readonly screens: Screens;
  readonly play: GamePlay;
  readonly save: SaveStore;
  readonly audio: GameAudio;
  readonly camera: PerspectiveCamera;
  readonly aircraft: Object3D;
}

export interface DefenseSelection {
  readonly mapId: string;
  readonly difficulty: DefenseDifficulty;
}

export interface DefenseLink {
  /** 飛ぶ（飛んだばかりの）防衛戦（ソロ）。メニューへ戻ると null */
  readonly selection: DefenseSelection | null;
  /** 飛行の始めに呼ぶ（ui/flight-start.ts） */
  begin(): void;
  /** 描画フレームごと */
  render(width: number, height: number): void;
  /** 協力の飛行も同じ HUD を使う（net 側が値を入れる） */
  readonly hud: DefenseHud;
}

/** 施設が壊れたときの文 */
export const FACILITY_LOST_TEXT: Readonly<Record<(typeof FACILITY_KINDS)[number], string>> = {
  hq: '司令部が破壊された',
  radar: 'レーダー喪失 — 敵の予告が出なくなる',
  fuel: '燃料タンク喪失 — 補給が半分になる',
  aaa1: '対空砲 1 喪失 — 支援が減る',
  aaa2: '対空砲 2 喪失 — 支援が減る',
};

/** 終わってからリザルトを出すまでの秒数（大きな文字を見せる） */
const RESULT_DELAY_MS = 3000;

export function createDefenseLink(p: DefenseLinkParts): DefenseLink {
  const { game, screens, play, save, audio } = p;
  let selection: DefenseSelection | null = null;
  let pending: { score: DefenseScore; at: number } | null = null;
  const hud = new DefenseHud(document.body);
  const soloSkip = (): void => {
    play.defense?.skip();
  };
  hud.onSkip = soloSkip;
  const hudLink = new DefenseHudLink(hud, p.camera, p.aircraft, play.session.props.cruiseMissiles);
  const result = new DefenseResultScreen(document.body, {
    onRetry: () => game.transition('flight'),
    onList: () => game.transition('mode_select'),
  });
  const state: { -readonly [K in keyof DefenseHudState]: DefenseHudState[K] } = {
    phase: 'intermission',
    wave: 1,
    remaining: 0,
    intermissionLeft: 0,
    hqHp: 0,
    hqMaxHp: 1,
    aliveBits: 0,
    forecast: null,
    supplied: false,
    skipped: false,
  };
  const link: DefenseLink = {
    get selection() {
      return selection;
    },
    hud,
    begin() {
      hud.onSkip = soloSkip;
      const s = selection;
      if (!s) return;
      play.startDefense(findDefenseMap(s.mapId), s.difficulty);
      screens.pause.setInMission(true, '防衛戦を中断');
    },
    render(width, height) {
      // 協力の防衛戦の HUD は ui/defense-flight.ts が出す（ここはソロだけ。メニューの間は CSS で隠れる）
      const d = play.defense;
      if (!d || game.state !== 'flight') return;
      hud.setShown(true);
      state.phase = d.phase;
      state.wave = d.wave;
      state.remaining = d.remaining;
      state.intermissionLeft = d.intermissionLeft;
      state.hqHp = d.base.hq.hp;
      state.hqMaxHp = d.base.hq.maxHp;
      state.aliveBits = d.base.aliveBits;
      state.forecast = d.forecast;
      state.supplied = d.hasSupplied(0);
      hud.update(state);
      hudLink.update(width, height);
      if (pending && performance.now() >= pending.at) showResult();
    },
  };
  screens.inDefense = () => selection !== null;
  screens.onDefense = (kind, mapId, difficulty) => {
    if (kind === 'coop') {
      screens.openDefenseCoop(mapId, difficulty === 'hard');
      return;
    }
    selection = { mapId, difficulty };
    screens.nextMission = null;
    game.transition('flight');
  };

  game.onChange(({ to }) => {
    result.setShown(to === 'result' && selection !== null);
    if (usesDemoCamera(to) || to === 'hangar' || to === 'lobby') {
      selection = null;
      pending = null;
    }
  });

  play.onDefenseChange((d) => {
    pending = null;
    if (!d) hud.setShown(false);
    if (d) bind(d);
  });

  const bind = (d: DefenseRunner): void => {
    bindDefenseFeedback(d, hud, audio, (id) => id === 0);
    d.bus.on('defense:end', ({ outcome }) => {
      const score: DefenseScore = {
        outcome,
        wavesCleared: d.wavesCleared,
        hqHp: d.base.hq.hp,
        hqMaxHp: d.base.hq.maxHp,
        facilitiesAlive: d.base.facilitiesAlive,
        facilitiesTotal: FACILITY_TOTAL,
        kills: play.session.combat.kills,
      };
      save.addCredits(defenseReward(score).total);
      pending = { score, at: performance.now() + RESULT_DELAY_MS };
    });
  };

  const showResult = (): void => {
    const s = selection;
    const r = pending;
    pending = null;
    if (!s || !r) return;
    result.show(r.score, defenseReward(r.score), {
      mapName: findDefenseMap(s.mapId).name,
      hard: s.difficulty === 'hard',
      balance: save.credits,
      pilotName: save.pilotName,
      players: [],
    });
    game.transition('result');
  };

  return link;
}

/** 波・補給・被弾・施設の喪失の大きな文字と音（ソロ・協力の共通。isSelf は補給した人が自分か） */
export function bindDefenseFeedback(
  d: Pick<DefenseRunner, 'bus'>,
  hud: DefenseHud,
  audio: Pick<GameAudio, 'playDefense'>,
  isSelf: (id: number) => boolean,
): void {
  const bus = d.bus;
  let lastHit = 0;
  bus.on('defense:wave', ({ wave }) => {
    audio.playDefense('horn');
    hud.flash(`WAVE ${wave}`, '敵襲', 'bad', 2);
  });
  bus.on('defense:waveClear', ({ wave }) => {
    audio.playDefense('clear');
    hud.flash(`WAVE ${wave} CLEAR`, '補給して次の波に備えよ', 'good', 2.5);
  });
  bus.on('defense:spawn', ({ kind }) => {
    if (kind === 'cruise') audio.playDefense('cruise');
  });
  bus.on('defense:hqHit', () => {
    const now = performance.now();
    if (now - lastHit < DEFENSE_CONFIG.hqHitSoundInterval * 1000) return;
    lastHit = now;
    audio.playDefense('hqHit');
  });
  bus.on('defense:facilityLost', ({ index }) => {
    const k = FACILITY_KINDS[index];
    if (k && k !== 'hq') hud.flash('施設喪失', FACILITY_LOST_TEXT[k], 'bad', 2.5);
  });
  bus.on('defense:supply', ({ id, fraction }) => {
    if (isSelf(id))
      hud.flash('補給完了', fraction < 1 ? '燃料タンク喪失のため半分' : '', 'good', 1.8);
  });
  bus.on('defense:end', ({ outcome }) => {
    hud.flash(
      outcome === 'cleared' ? '防衛成功' : '基地陥落',
      '',
      outcome === 'cleared' ? 'good' : 'bad',
      3,
    );
  });
}
