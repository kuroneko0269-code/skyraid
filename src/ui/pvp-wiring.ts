// PvP（5-1）・協力レイド（6-2）の入口の配線（main.ts から分けた。7-A の事前修正。挙動は変えていない）:
// 選んだとき・?room のときだけ通信の部分を読み込む。画質に合わせた機体モデルの細かさもここで配る
import type { PerspectiveCamera, Scene } from 'three';
import type { GameAudio } from '../audio/game-audio';
import type { GameState } from '../core/game-state';
import type { Input } from '../core/input';
import type { KaijuBodyView, KaijuEffectsView } from '../entities/kaiju-display';
import type { ActiveMap } from '../missions/active-map';
import type { FlightSession } from '../missions/flight-session';
import type { SaveStore } from '../progression/save-store';
import type { FlightViews } from '../render/flight-views';
import type { FxEvents } from '../render/fx/fx-events';
import type { KaijuHudLink } from '../render/kaiju-hud-link';
import type { PlayerView } from '../render/player-view';
import type { QualityLink } from '../render/quality-link';
import { PvpEntry } from './pvp-entry';
import { raidLinkDeps } from './raid-briefing';
import type { Screens } from './screens';

export interface PvpWiringParts {
  readonly screens: Screens;
  readonly search: string;
  readonly game: GameState;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly session: FlightSession;
  readonly playerView: PlayerView;
  readonly save: SaveStore;
  readonly audio: GameAudio;
  readonly groundHeight: (x: number, z: number) => number;
  readonly activeMap: ActiveMap;
  readonly input: Input;
  readonly fxEvents: FxEvents;
  readonly views: FlightViews;
  readonly kaijuHud: KaijuHudLink;
  readonly quality: QualityLink;
}

export interface PvpWiring {
  readonly pvp: PvpEntry;
  /** 協力のレイドの怪獣（写し）を使っているか。シングルは session の怪獣 */
  readonly coopKaiju: () => boolean;
}

export function createPvpWiring(p: PvpWiringParts): PvpWiring {
  const { save, audio, activeMap, session } = p;
  let coopKaiju: { body: KaijuBodyView; fx: KaijuEffectsView | null } | null = null;
  const pvp = new PvpEntry(p.screens, p.search, {
    game: p.game,
    scene: p.scene,
    camera: p.camera,
    session,
    playerView: p.playerView,
    pilotName: () => save.pilotName,
    needsPilotName: () => save.needsPilotName,
    // 5-4: カウントダウン・GO・残り時間の警告の音
    sound: (kind) => {
      audio.playUi(kind);
    },
    groundHeight: p.groundHeight,
    obstacles: (a, b) => activeMap.buildings?.collides(a, b) ?? false,
    protectedBuildings: () => session.protectedBuildings,
    // 6-6: 協力レイドの建物（ホストだけが壊して配る）・報酬・ブリーフィングを見たか
    ...raidLinkDeps(save, () => activeMap.buildings),
    // 5-3: スコアボードは Tab（ターゲット切替のキー）の長押し、他プレイヤーの機銃は敵機と同じ位置付きの音
    scoreKeyDown: () => p.input.isDown('targetNext'),
    otherGun: (x, y, z) => {
      p.fxEvents.otherGun(x, y, z);
    },
    // 6-2: レイドの協力の怪獣（ホストは本体、クライアントは state の写し）を描画・HUD・音に出す
    kaijuSource: (src) => {
      coopKaiju = src ? { body: src.body, fx: src.fx } : null;
      p.views.setKaijuSource(src?.body ?? null, src?.fx ?? null);
      p.kaijuHud.setSource(src ? src.hud : null);
      audio.setKaijuSource(src?.body ?? null);
    },
  });
  // 機体モデルの細かさ（4-3。画質「低」は LOD）と陽炎の屈折（4-4。「高」だけ）
  p.quality.onPreset((preset) => {
    p.playerView.setDetail(preset.aircraftDetail);
    p.views.setAircraftDetail(preset.aircraftDetail);
    p.playerView.setHazeRefraction(preset.heatHazeRefraction);
    pvp.setAircraftDetail(preset.aircraftDetail);
  });
  return { pvp, coopKaiju: () => coopKaiju !== null };
}
