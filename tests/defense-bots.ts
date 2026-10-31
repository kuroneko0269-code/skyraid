// 防衛戦（7-2）のシミュレーション用のボット: 本番と同じ FlightSession + GamePlay（防衛戦）を、敵機と同じ AI（ai-sim の PilotBot）で戦わせる。
// 狙う順: 巡航ミサイル → 爆撃機 → 戦闘機（いちばん近いもの）。準備の間は基地の上を低く遅く通って補給し、補給したらスキップする
import { steerToward } from '../src/ai/steering';
import type { CombatTarget } from '../src/combat/target';
import { createRandom } from '../src/core/random';
import { STARTER_AIRCRAFT, findAircraftModel } from '../src/data/aircraft';
import { DEFENSE_CONFIG, findDefenseMap, type DefenseDifficulty } from '../src/data/defense';
import type { Vec3 } from '../src/flight/math';
import { ActiveMap } from '../src/missions/active-map';
import type { DefenseRunner } from '../src/missions/defense/runner';
import { FlightSession } from '../src/missions/flight-session';
import { GamePlay } from '../src/missions/game-play';
import { resolveLoadout } from '../src/progression/loadout';
import { FREE_FLIGHT_ENEMIES } from '../src/data/ai';
import { AVERAGE, PilotBot } from './ai-sim';

export const DT = 1 / 60;

export interface DefenseSim {
  readonly play: GamePlay;
  readonly defense: DefenseRunner;
  readonly bot: DefenseBot;
  readonly map: ActiveMap;
}

export interface DefenseSimOptions {
  readonly mapId?: string;
  readonly difficulty?: DefenseDifficulty;
  /** 強化の Lv（4 系統とも同じ。0 は未強化） */
  readonly level?: number;
  readonly seed?: number;
}

export function startDefenseSim(o: DefenseSimOptions = {}): DefenseSim {
  const map = new ActiveMap();
  const mapId = o.mapId ?? 'island';
  map.use(mapId);
  const seed = o.seed ?? 1;
  const session = new FlightSession({
    rng: createRandom(seed),
    groundHeight: map.ground,
    buildings: () => map.buildings,
    flightOptions: { autoLevel: false },
    enemies: { ...FREE_FLIGHT_ENEMIES, maxCount: DEFENSE_CONFIG.hostFighterPool },
  });
  const model = findAircraftModel(STARTER_AIRCRAFT.id);
  const lv = o.level ?? 0;
  if (model)
    session.applyLoadout(
      resolveLoadout(model, { engine: lv, airframe: lv, weapons: lv, avionics: lv }),
    );
  const play = new GamePlay(session);
  const defense = play.startDefense(
    findDefenseMap(mapId),
    o.difficulty ?? 'normal',
    createRandom(seed + 7),
  );
  const bot = new DefenseBot(play, defense, map, seed);
  return { play, defense, bot, map };
}

/** 狙う相手を選び、PilotBot に飛ばせる。準備中は補給へ向かう */
export class DefenseBot {
  readonly pilot: PilotBot;
  private readonly to: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly play: GamePlay,
    private readonly defense: DefenseRunner,
    private readonly map: ActiveMap,
    seed: number,
  ) {
    const s = play.session;
    this.pilot = new PilotBot(s, AVERAGE, createRandom(seed + 1000), () => this.pick(), map.ground);
  }

  pick(): CombatTarget | null {
    const s = this.play.session;
    const p = s.aircraft.state.position;
    const lists: readonly (readonly CombatTarget[])[] = [
      s.props.cruiseMissiles,
      s.props.bombers,
      s.enemies,
    ];
    for (const list of lists) {
      let best: CombatTarget | null = null;
      let bestD = Infinity;
      for (const t of list) {
        if (!t.active) continue;
        const d = Math.hypot(t.position.x - p.x, t.position.y - p.y, t.position.z - p.z);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (best) return best;
    }
    return null;
  }

  step(): void {
    const d = this.defense;
    const s = this.play.session;
    if (d.phase === 'intermission') {
      if (d.hasSupplied(0) || !s.player.active) {
        d.skip();
      } else {
        this.flyToBase();
        this.play.step(this.pilot.controls, this.pilot.input, DT);
        return;
      }
    }
    this.pilot.think(DT);
    // 相手が遠い（AI が見失う距離）ときは、まっすぐ相手へ向かう
    const t = this.pick();
    const a = s.aircraft.state;
    if (t && s.player.active) {
      const p = a.position;
      const to = this.to;
      to.x = t.position.x - p.x;
      to.y = t.position.y - p.y;
      to.z = t.position.z - p.z;
      const dist = Math.hypot(to.x, to.y, to.z);
      const agl = p.y - Math.max(0, this.map.ground(p.x, p.z));
      if (dist > 3500) {
        if (agl < 250) to.y = Math.max(to.y, dist * 0.2);
        const ctl = this.pilot.controls;
        ctl.throttleTarget = 1;
        ctl.afterburner = a.afterburnerGauge > 0.5;
        steerToward(ctl, a.orientation, a.angularRate, to, 1);
      }
    }
    this.play.step(this.pilot.controls, this.pilot.input, DT);
  }

  /** 基地の中心へ、地表 200m・速度 130 で向かう */
  private flyToBase(): void {
    const s = this.play.session;
    const a = s.aircraft.state;
    const c = this.defense.map.center;
    const p = a.position;
    const ground = Math.max(0, this.map.ground(p.x, p.z));
    const dist = Math.hypot(c.x - p.x, c.z - p.z);
    this.to.x = c.x - p.x;
    this.to.z = c.z - p.z;
    this.to.y = Math.max(-0.3 * dist, Math.min(0.3 * dist, ground + 200 - p.y));
    if (dist < 150) {
      // 真上を過ぎたら回り直す（水平に旋回）
      this.to.x = -this.to.z + this.to.x;
    }
    const ctl = this.pilot.controls;
    ctl.afterburner = false;
    ctl.throttleTarget = dist > 2500 ? 1 : a.speed > 135 ? 0 : 0.45;
    const inp = this.pilot.input;
    inp.trigger = inp.missile = inp.flare = false;
    steerToward(ctl, a.orientation, a.angularRate, this.to, 1);
  }
}

/** 終わるまで（または seconds 秒）飛ばす */
export function runDefense(sim: DefenseSim, seconds = 3600): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps && !sim.defense.finished; i++) sim.bot.step();
}
