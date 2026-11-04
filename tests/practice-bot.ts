// 練習場（9-5）を飛ぶボット: 止まった的は StrikeBot（上空から降下して機銃）、動く的・模擬の敵は PilotBot（機銃。相手は一番近いもの）
import type { CombatInput } from '../src/combat/combat-system';
import type { CombatTarget } from '../src/combat/target';
import { createRandom } from '../src/core/random';
import type { DifficultySpec } from '../src/data/ai';
import type { PracticeDrill } from '../src/data/practice';
import type { AircraftControls } from '../src/entities/aircraft';
import type { GamePlay } from '../src/missions/game-play';
import { getGroundHeight } from '../src/render/terrain-height';
import { AVERAGE, PilotBot } from './ai-sim';
import { DT, StrikeBot, nearestActive } from './mission-bots';

export class PracticeBot {
  private readonly pilot: PilotBot;
  private readonly strike: StrikeBot;
  controls: AircraftControls;
  input: CombatInput;

  constructor(
    play: GamePlay,
    private readonly drill: PracticeDrill,
    skill: DifficultySpec = AVERAGE,
    seed = 1,
  ) {
    const s = play.session;
    const pool = (): readonly CombatTarget[] => (drill === 'moving' ? s.combat.drones : s.enemies);
    this.pilot = new PilotBot(
      s,
      skill,
      createRandom(900 + seed),
      () => nearestActive(s.aircraft.state.position, pool()),
      getGroundHeight,
    );
    this.strike = new StrikeBot(s, () => s.combat.targets.balloons);
    const use = drill === 'static' ? this.strike : this.pilot;
    this.controls = use.controls;
    this.input = use.input;
  }

  think(dt: number): void {
    if (this.drill === 'static') this.strike.think(dt);
    else this.pilot.think(dt);
  }
}

/** 練習場を 1 回、終わりまで（数え + 課題 + 結果の待ち）ボットで飛ぶ */
export function runPractice(
  play: GamePlay,
  drill: PracticeDrill,
  skill: DifficultySpec = AVERAGE,
  seed = 1,
  aspect = 2.16,
): ReturnType<GamePlay['startPractice']> {
  const p = play.startPractice(drill, aspect);
  const bot = new PracticeBot(play, drill, skill, seed);
  for (let i = 0; i < 60 * 100 && !p.readyForResult; i++) {
    bot.think(DT);
    play.step(bot.controls, bot.input, DT);
  }
  return p;
}
