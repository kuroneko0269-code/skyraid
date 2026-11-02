// リプレイ（7-B）のテスト用: 本番と同じ部品（ActiveMap・FlightSession・GamePlay）で世界を作り、本番の飛行と同じ手順
// （src/replay/sim.ts）で入力を記録し、別の世界で再生する
import { createCombatInput } from '../src/combat/combat-input';
import { createRandom } from '../src/core/random';
import { DEFENSE_CONFIG } from '../src/data/defense';
import { FREE_FLIGHT_ENEMIES } from '../src/data/ai';
import { createControls, type AircraftControls } from '../src/entities/aircraft';
import { ActiveMap } from '../src/missions/active-map';
import { FlightSession } from '../src/missions/flight-session';
import { GamePlay } from '../src/missions/game-play';
import { ReplayPlayer } from '../src/replay/player';
import { ReplayRecorder } from '../src/replay/recorder';
import {
  applyCommand,
  applyFrame,
  captureFrame,
  simHash,
  simSkip,
  startFromHeader,
  stepWorld,
  type SimWorld,
} from '../src/replay/sim';
import { StateSnapshot } from '../src/replay/state-walk';
import type { ReplayCommand, ReplayData, ReplayStart } from '../src/replay/types';

export interface TestWorld extends SimWorld {
  readonly map: ActiveMap;
  readonly controls: AircraftControls;
}

/** 本番の main.ts と同じ形の世界（敵の入れ物は防衛戦の数）。起動直後の写しも撮る */
export function createWorld(): TestWorld {
  const map = new ActiveMap();
  const session = new FlightSession({
    groundHeight: map.ground,
    buildings: () => map.buildings,
    enemies: { ...FREE_FLIGHT_ENEMIES, maxCount: DEFENSE_CONFIG.hostFighterPool },
  });
  const play = new GamePlay(session);
  const base = {
    play,
    map,
    controls: createControls(),
    useMap: (id: string) => {
      map.use(id);
    },
    buildings: () => map.buildings,
  };
  return { ...base, pristine: StateSnapshot.take([play], simSkip(play)) };
}

export const BASE_START: ReplayStart = {
  mode: 'free',
  mapId: 'island',
  aircraftId: 'kestrel',
  upgrades: { engine: 1, airframe: 0, weapons: 2, avionics: 1 },
  enemies: { enabled: true, difficulty: 'normal', count: 2 },
  seed: 12345,
  weatherId: 'clear',
};

/** 人の操作に似せた入力（スティックはなめらかに動き、ボタンはときどき押す）。seed で決まる */
export class ScriptedPilot {
  private readonly rng: () => number;
  private targetPitch = 0;
  private targetRoll = 0;
  private hold = 0;
  readonly controls = createControls();
  readonly input = createCombatInput();

  constructor(
    seed: number,
    private readonly analog = true,
  ) {
    this.rng = createRandom(seed);
  }

  next(): void {
    const r = this.rng;
    const c = this.controls;
    if (--this.hold <= 0) {
      this.hold = 20 + Math.floor(r() * 90);
      this.targetPitch = r() * 1.4 - 0.5;
      this.targetRoll = r() * 2 - 1;
      c.afterburner = r() < 0.15;
      c.throttle = r() < 0.2 ? (r() < 0.5 ? -1 : 1) : 0;
    }
    if (this.analog) {
      c.pitch += (this.targetPitch - c.pitch) * 0.08;
      c.roll += (this.targetRoll - c.roll) * 0.08;
      c.yaw = Math.sin(this.hold * 0.05) * 0.2;
    } else {
      c.pitch = Math.abs(this.targetPitch) > 0.4 ? Math.sign(this.targetPitch) : 0;
      c.roll = Math.abs(this.targetRoll) > 0.5 ? Math.sign(this.targetRoll) : 0;
      c.yaw = 0;
    }
    c.throttleTarget = r() < 0.003 ? r() : null;
    const i = this.input;
    i.trigger = this.hold % 40 < 12;
    i.missile = r() < 0.01;
    i.flare = r() < 0.004;
    i.targetNext = r() < 0.01;
    i.rocket = r() < 0.005;
    i.bomb = r() < 0.003;
    i.bombHeld = false;
  }
}

export interface RecordOptions {
  readonly seconds: number;
  readonly pilotSeed?: number;
  readonly analog?: boolean;
  /** 外部の操作（step のステップの前に効かせる） */
  readonly commands?: readonly ReplayCommand[];
  /** 毎ステップの状態ハッシュを取る */
  readonly hashes?: boolean;
  /** 防衛戦の準備をすぐスキップする（ボットのように） */
  readonly autoSkip?: boolean;
}

/** 本番の飛行と同じ手順で記録する。hashes は各ステップの後の状態ハッシュ */
export function record(
  w: TestWorld,
  start: ReplayStart,
  o: RecordOptions,
): { data: ReplayData; hashes: string[] } {
  startFromHeader(w, start);
  const rec = new ReplayRecorder();
  rec.begin(start, {
    title: 't',
    pilotName: 'p',
    date: '2026-10-31T00:00:00Z',
    gameVersion: '1.0.0',
    startHash: simHash(w),
  });
  const pilot = new ScriptedPilot(o.pilotSeed ?? 7, o.analog ?? true);
  const steps = Math.round(o.seconds * 60);
  const hashes: string[] = [];
  const cmds = o.commands ?? [];
  for (let t = 0; t < steps; t++) {
    for (const c of cmds) {
      if (c.step !== t) continue;
      applyCommand(w.play, c);
      rec.command(c);
    }
    if (o.autoSkip && w.play.defense?.phase === 'intermission') {
      w.play.defense.skip();
      rec.command({ kind: 'skip' });
    }
    pilot.next();
    const f = captureFrame(rec.frame, pilot.controls, pilot.input, w.play.session);
    applyFrame(f, w.controls, pilot.input, w.play.session);
    rec.push(f);
    stepWorld(w.play, w.buildings(), w.controls, pilot.input, 1 / 60);
    if (o.hashes) hashes.push(simHash(w));
  }
  const data = rec.finish(null);
  if (!data) throw new Error('no data');
  return { data, hashes };
}

/** 再生して各ステップの状態ハッシュ（every ステップごと）を集める */
export function replay(
  w: TestWorld,
  data: ReplayData,
  every = 1,
): { player: ReplayPlayer; hashes: string[] } {
  const player = new ReplayPlayer(w, data, w.controls);
  const hashes: string[] = [];
  player.onStep = (t) => {
    if (t % every === 0) hashes.push(simHash(w));
  };
  player.begin();
  while (player.step());
  return { player, hashes };
}
