// ゲームループ（固定ステップの更新）と、画面の遷移で飛行を始める・止める配線（main.ts から分けた。7-A の事前修正。挙動は変えていない）
import type { AircraftControls } from '../entities/aircraft';
import type { CombatInput } from '../combat/combat-system';
import { applyKaijuToCity } from '../combat/city-damage';
import type { CommonKeys } from '../core/common-keys';
import type { GamepadInput } from '../core/gamepad';
import { readFlightControls } from '../core/flight-input';
import {
  isFrozenFlight,
  isResume,
  syncLoopWithState,
  usesDemoCamera,
  type GameState,
} from '../core/game-state';
import type { GameLoop } from '../core/loop';
import type { Input } from '../core/input';
import type { AssistControl } from '../core/assist-control';
import type { WeaponInput } from '../core/weapon-input';
import type { MissionDef } from '../missions/types';
import type { ActiveMap } from '../missions/active-map';
import type { FlightSession } from '../missions/flight-session';
import type { GamePlay } from '../missions/game-play';
import type { ChaseCamera } from '../render/chase-camera';
import type { HangarStage } from '../render/hangar-stage';
import type { PvpEntry } from './pvp-entry';
import type { Screens } from './screens';
import type { TouchLink } from './touch-link';
import type { TutorialLink } from './tutorial-link';

export interface FlightLoopParts {
  readonly game: GameState;
  readonly input: Input;
  readonly gamepad: GamepadInput;
  readonly keys: CommonKeys;
  readonly controls: AircraftControls;
  readonly combatInput: CombatInput;
  readonly weaponInput: WeaponInput;
  readonly assist: AssistControl;
  readonly pvp: PvpEntry;
  readonly play: GamePlay;
  readonly session: FlightSession;
  readonly activeMap: ActiveMap;
  readonly chaseCamera: ChaseCamera;
  readonly screens: Screens;
  readonly tutorial: TutorialLink;
  /** 協力のレイドの怪獣（写し）を使っているか（建物の破壊はホストの RaidHost が配る） */
  readonly coopKaiju: () => boolean;
  readonly touch: TouchLink;
  readonly hangarStage: HangarStage;
  readonly aircraftMesh: { visible: boolean };
  readonly startFlight: (def: MissionDef | null, net: boolean) => void;
}

/**
 * ゲームループと画面の遷移をつなぐ: 固定ステップは飛行中だけ（ポーズ・メニュー中は GameLoop ごと止める）。
 * 戻り値の simulate は入力を読まずにゲームの判定だけを 1 ステップ進める（フォトモード（7-A）のコマ送り）
 */
export function linkFlightLoop(
  loop: GameLoop,
  p: FlightLoopParts,
): { simulate: (dt: number) => void } {
  syncLoopWithState(p.game, loop);
  linkScreenChanges(p);
  const { simulate, update } = createFlightUpdate(p);
  loop.onUpdate(update);
  return { simulate };
}

/** 固定ステップ 1 回分の更新（update は GameLoop.onUpdate に渡す。simulate はその中のゲームの判定の部分） */
function createFlightUpdate(p: FlightLoopParts): {
  update: (dt: number) => void;
  simulate: (dt: number) => void;
} {
  const { input, game, pvp, play, session } = p;
  const simulate = (dt: number): void => {
    if (pvp.flying) pvp.step(p.controls, p.combatInput, dt);
    else play.step(p.controls, p.combatInput, dt);
    // 6-4: 街の建物が崩れる時間と、怪獣（歩行・薙ぎ払い・熱線）が壊す建物
    const buildings = p.activeMap.buildings;
    if (buildings) {
      buildings.step(dt);
      // 協力（6-6）はホストの RaidHost だけが壊して番号を配り、クライアントは受け取って壊す（ここでは判定しない）
      if (!p.coopKaiju()) applyKaijuToCity(buildings, session.props.kaiju, session.props.kaijuAi);
    }
  };
  const update = (dt: number): void => {
    p.gamepad.poll();
    // PvP の飛行中はゲームを止めず、Esc で PvP のメニュー
    if (input.wasPressed('pause') && !pvp.togglePause()) {
      input.endStep();
      game.transition('pause');
      return;
    }
    readFlightControls(input, p.controls);
    p.assist.apply(p.controls);
    p.weaponInput.read(input, p.combatInput, dt);
    simulate(dt);
    if (input.wasPressed('cameraToggle')) p.chaseCamera.toggleMode();
    p.keys.handle();
    // ミッションが終わり、大きな文字を出し終えたらリザルトへ（固定更新もここで止まる）
    const runner = play.runner;
    if (runner?.readyForResult && runner.result) {
      p.screens.showResult(runner.result, p.tutorial.paid);
      game.transition('result');
    }
  };
  return { update, simulate };
}

/** 画面の遷移: 飛行の始め・ポーズ・再開・機体と展示の表示・タッチ操作・チュートリアル */
function linkScreenChanges(p: FlightLoopParts): void {
  const { game, play, screens } = p;
  game.onChange(({ from, to }) => {
    // 6-4: タイトルの背景（デモカメラ）は島
    if (to === 'title') p.activeMap.use('island');
    if (to === 'flight' && !isResume(from)) p.startFlight(screens.nextMission, from === 'lobby');
    if (isFrozenFlight(to)) play.runner?.pause();
    else if (to === 'flight') play.runner?.resume();
    // 止めている間に押されたキー（再開に使った Esc など）を飛行に持ち込まない
    if (to === 'flight') {
      p.input.endStep();
      p.weaponInput.reset();
    }
    // 撃墜されたまま（ミッション失敗）のリザルトでは機体を隠す。ハンガーでは展示の機体だけ
    p.aircraftMesh.visible = !usesDemoCamera(to) && to !== 'hangar' && p.session.player.active;
    p.hangarStage.setShown(to === 'hangar');
    p.touch.refresh();
    if (to === 'flight' && !isResume(from))
      p.tutorial.onFlightStart(screens.inTutorial ? 'tutorial' : play.runner ? 'mission' : 'free');
  });
}
