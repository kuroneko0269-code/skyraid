// チュートリアル（4-11）を通すボット: 段階ごとに操縦を切り替える。リングは WaypointBot、速度は AB で直進、
// 的は StrikeBot（上空から降下して機銃）、ドローン・敵機は PilotBot（機銃とミサイル。相手の選び方だけ変える）
import { createCombatInput, type CombatInput } from '../src/combat/combat-system';
import type { CombatTarget } from '../src/combat/target';
import { createRandom } from '../src/core/random';
import type { AircraftControls } from '../src/entities/aircraft';
import { LOCAL_FORWARD } from '../src/flight/flight-model';
import { rotateVec3, type Vec3 } from '../src/flight/math';
import type { GamePlay } from '../src/missions/game-play';
import { RingPassObjective } from '../src/missions/objectives';
import type { MissionRunner } from '../src/missions/runner';
import { getGroundHeight } from '../src/render/terrain-height';
import type { DifficultySpec } from '../src/data/ai';
import { AVERAGE, PilotBot } from './ai-sim';
import { StrikeBot, WaypointBot, nearestActive } from './mission-bots';

export class TutorialBot {
  private readonly waypoint: WaypointBot;
  private readonly pilot: PilotBot;
  private readonly strike: StrikeBot;
  private readonly noInput = createCombatInput();
  private readonly ahead: Vec3 = { x: 0, y: 0, z: 0 };
  controls: AircraftControls;
  input: CombatInput;

  constructor(
    private readonly play: GamePlay,
    private readonly runner: MissionRunner,
    skill: DifficultySpec = AVERAGE,
    seed = 1,
  ) {
    const s = play.session;
    this.waypoint = new WaypointBot(s);
    this.pilot = new PilotBot(
      s,
      skill,
      createRandom(700 + seed),
      () => this.pick(),
      getGroundHeight,
    );
    this.strike = new StrikeBot(s, () => s.combat.targets.balloons);
    this.controls = this.waypoint.controls;
    this.input = this.noInput;
  }

  /** 今の段階（進行中の目標の id） */
  get step(): string | null {
    return this.runner.objectives.find((o) => o.status === 'active')?.def.id ?? null;
  }

  think(dt: number): void {
    const step = this.step;
    const s = this.play.session;
    if (step === 'rings') {
      const rings = this.runner.objectives[0];
      const next = rings instanceof RingPassObjective ? rings.next : null;
      if (next) this.waypoint.fly(next.position);
      this.useWaypoint(false);
    } else if (step === 'speed') {
      // 機首の向きのまま水平に、スロットル最大 + AB
      const st = s.aircraft.state;
      const nose = rotateVec3(this.ahead, st.orientation, LOCAL_FORWARD);
      this.ahead.x = st.position.x + nose.x * 1000;
      this.ahead.y = st.position.y;
      this.ahead.z = st.position.z + nose.z * 1000;
      this.waypoint.fly(this.ahead);
      this.useWaypoint(true);
    } else if (step === 'targets') {
      // 低い的（地表から 200〜250m）は上空から降下して機銃で撃つ（ミサイルはドローン・敵機に残す）
      this.strike.think(dt);
      this.controls = this.strike.controls;
      this.input = this.strike.input;
    } else {
      this.pilot.think(dt);
      this.controls = this.pilot.controls;
      this.input = this.pilot.input;
    }
  }

  private useWaypoint(afterburner: boolean): void {
    this.controls = this.waypoint.controls;
    this.controls.afterburner = afterburner;
    this.controls.throttleTarget = afterburner ? 1 : 0.75;
    this.input = this.noInput;
  }

  private pick(): CombatTarget | null {
    const s = this.play.session;
    const p = s.aircraft.state.position;
    const step = this.step;
    if (step === 'drone') return nearestActive(p, s.combat.drones);
    return this.pilot.nearestEnemy();
  }
}
