// 音（4-4）の組み立て: AudioEngine（最初のユーザー操作で作る）・ゲームの音・UI の音・ポーズメニューの音量のスライダー
import type { FlightSession } from '../missions/flight-session';
import type { SaveStore } from '../progression/save-store';
import type { FxEvents } from '../render/fx/fx-events';
import { createVolumeSettings } from '../ui/volume-settings';
import { AudioEngine, browserContextFactory } from './engine';
import { GameAudio } from './game-audio';

export function createGameAudio(
  session: FlightSession,
  events: FxEvents,
  groundHeight: (x: number, z: number) => number,
  settingsPanel: HTMLElement,
  save: SaveStore,
): GameAudio {
  const engine = new AudioEngine(browserContextFactory);
  engine.attach(window, document);
  const audio = new GameAudio(engine, events, session, groundHeight, import.meta.env.BASE_URL);
  audio.attachUi(document);
  createVolumeSettings(settingsPanel, save, (v) => {
    engine.setVolumes(v);
  });
  return audio;
}
