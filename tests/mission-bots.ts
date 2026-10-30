// ミッションのシミュレーション用のボット（2-5）。シード固定で本番と同じ FlightSession + MissionRunner を飛ばす
import { steerToward } from '../src/ai/steering';
import { createCombatInput, type CombatInput } from '../src/combat/combat-system';
import type { CombatTarget } from '../src/combat/target';
import { createRandom } from '../src/core/random';
import type { AircraftControls } from '../src/entities/aircraft';
import { LOCAL_FORWARD } from '../src/flight/flight-model';
import { rotateVec3, type Vec3 } from '../src/flight/math';
import { FlightSession } from '../src/missions/flight-session';
import { GamePlay } from '../src/missions/game-play';
import { getGroundHeight } from '../src/render/terrain-height';

export const DT = 1 / 60;

/** 本番と同じ地形・オートレベルなし（ボットがロールを操る）で GamePlay を作る */
export function newPlay(seed: number): GamePlay {
  return new GamePlay(
    new FlightSession({
      rng: createRandom(seed),
      groundHeight: getGroundHeight,
      flightOptions: { autoLevel: false },
    }),
  );
}

/** 地表（海の上は海面）の高さ */
export function floorAt(x: number, z: number): number {
  return Math.max(0, getGroundHeight(x, z));
}

/** from に最も近い、出ている対象（なければ null） */
export function nearestActive<T extends CombatTarget>(
  from: Readonly<Vec3>,
  list: readonly T[],
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const t of list) {
    if (!t.active) continue;
    const p = t.position;
    const d = Math.hypot(p.x - from.x, p.y - from.y, p.z - from.z);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

export function createControls(throttleTarget = 0.75): AircraftControls {
  return { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false, throttleTarget };
}

/** 点へ機首を向けて飛ぶボット（リングを順にくぐる・島の上を回る） */
export class WaypointBot {
  readonly controls = createControls();
  private readonly dir: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(private readonly session: FlightSession) {}

  fly(to: Readonly<Vec3>): void {
    const s = this.session.aircraft.state;
    this.dir.x = to.x - s.position.x;
    this.dir.y = to.y - s.position.y;
    this.dir.z = to.z - s.position.z;
    steerToward(this.controls, s.orientation, s.angularRate, this.dir, 1);
  }
}

/**
 * 地上目標を機銃で撃つボット（M4）: 目標の上空（地表から 600m 以上）へ近づき、水平距離 2km から降下して
 * 予測照準点へ機首を向けて撃つ。今の降下率のまま 2 秒後に地表から 150m を切るか、350m まで近づいたら
 * 4 秒引き起こして、やり直す
 */
export class StrikeBot {
  readonly controls = createControls();
  readonly input: CombatInput = createCombatInput();
  mode: 'approach' | 'dive' | 'recover' = 'approach';
  private timer = 0;
  private readonly dir: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly nose: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly session: FlightSession,
    private readonly targets: () => readonly CombatTarget[],
  ) {}

  think(dt: number): void {
    const s = this.session;
    const state = s.aircraft.state;
    const p = state.position;
    const target = nearestActive(p, this.targets());
    this.input.trigger = false;
    if (!target || !s.player.active) return;
    if (s.combat.targeting.selected !== target) s.combat.targeting.select(target);
    const t = target.position;
    const agl = p.y - floorAt(p.x, p.z);
    const horizontal = Math.hypot(t.x - p.x, t.z - p.z);
    const distance = Math.hypot(horizontal, t.y - p.y);
    const d = this.dir;
    if (this.mode === 'approach') {
      d.x = t.x - p.x;
      d.y = Math.max(t.y + 600, 1000) - p.y;
      d.z = t.z - p.z;
      if (horizontal < 2000) this.mode = 'dive';
    } else if (this.mode === 'dive') {
      const aim = s.combat.leadValid ? s.combat.lead : t;
      d.x = aim.x - p.x;
      d.y = aim.y - p.y;
      d.z = aim.z - p.z;
      const len = Math.hypot(d.x, d.y, d.z);
      const nose = rotateVec3(this.nose, state.orientation, LOCAL_FORWARD);
      const cos = (nose.x * d.x + nose.y * d.y + nose.z * d.z) / Math.max(1e-6, len);
      this.input.trigger = distance < 1100 && cos > Math.cos((2 * Math.PI) / 180);
      if (agl + s.player.velocity.y * 2 < 150 || distance < 350) {
        this.mode = 'recover';
        this.timer = 4;
      }
    } else {
      // 機首の水平方向 + 上向きへ引き起こす
      const nose = rotateVec3(this.nose, state.orientation, LOCAL_FORWARD);
      d.x = nose.x;
      d.y = 1;
      d.z = nose.z;
      this.timer -= dt;
      if (this.timer <= 0) this.mode = 'approach';
    }
    steerToward(this.controls, state.orientation, state.angularRate, d, 1);
  }
}

/** 何もしない（撃たない）で島の上空、半径 2000m・高度 1500m の円を回り続ける（「放置」の代わり。墜落もしない） */
export class LoiterBot {
  readonly input: CombatInput = createCombatInput();
  private readonly waypoint: WaypointBot;
  private readonly point: Vec3 = { x: 0, y: 1500, z: 0 };

  constructor(private readonly session: FlightSession) {
    this.waypoint = new WaypointBot(session);
  }

  get controls(): AircraftControls {
    return this.waypoint.controls;
  }

  think(): void {
    const p = this.session.aircraft.state.position;
    const a = Math.atan2(p.z, p.x) + 0.6;
    this.point.x = 2000 * Math.cos(a);
    this.point.z = 2000 * Math.sin(a);
    this.waypoint.fly(this.point);
  }
}
