// 9-7: キャンペーン M6〜M8 の調整のボット。本番の飛行・戦闘・ミッションの判定を回す（startFromHeader → stepWorld。リプレイと同じ道）。
// 役は 9-6 のネフィルガのボットと同じ 4 つ（tests/kaiju2-bot-roles.ts: 熟練・平均的・初心者役・模擬の人）で、補助の組
// （かんたん / ふつう。src/data/assist.ts）の狙いの補助・自動射撃・速度合わせを使う（9-5d と同じく、組を渡すと模擬の人・初心者役は
// スロットル最大のまま）。
// - M6（敵機）: 9-1 の PilotBot（敵機の AI に役の腕前を渡す）がいちばん近い敵機を追う
// - M7（地上目標）: 地上目標を機銃で撃つボット（mission-bots.ts の StrikeBot と同じ進め方）に、役ごとの狙いのずれと撃つ角度を足したもの。
//   熟練は対空砲から先に、ほかはいちばん近い目標から
// - M8（ネフィルガ）: tests/kaiju2-raid-bots.ts の runKaiju2Bot（予兆を見て避ける・部位の狙い方）をキャンペーンのミッションで
import { steerToward } from '../src/ai/steering';
import { applyAimAssist, assistSpecFor } from '../src/combat/aim-assist';
import { autoFireReady } from '../src/combat/auto-fire';
import { createCombatInput } from '../src/combat/combat-input';
import { SpeedMatch } from '../src/combat/speed-match';
import type { CombatTarget } from '../src/combat/target';
import { createRandom } from '../src/core/random';
import {
  AIM_ASSIST_LEVEL_SPECS,
  ASSIST_PRESET_VALUES,
  type AssistPreset,
} from '../src/data/assist';
import { MISSIONS } from '../src/data/missions';
import { GUN_CONFIG } from '../src/data/weapons';
import type { AircraftControls } from '../src/entities/aircraft';
import type { GroundTarget } from '../src/entities/ground-target';
import { LOCAL_FORWARD } from '../src/flight/flight-model';
import { rotateVec3, type Vec3 } from '../src/flight/math';
import type { FlightSession } from '../src/missions/flight-session';
import { startFromHeader, stepWorld } from '../src/replay/sim';
import { DirectStick } from '../scripts/replay-analysis/direct';
import { DEFAULT_HANDS, Hands } from '../scripts/replay-analysis/hands';
import { PilotBot } from './ai-sim';
import { KAIJU2_ROLES, type Kaiju2Role } from './kaiju2-bot-roles';
import {
  campaignStart,
  createKaiju2World,
  runKaiju2Bot,
  type Kaiju2BotWorld,
} from './kaiju2-raid-bots';
import { BoundsGuard, ISLAND_CENTER_SKY, nearestActive } from './mission-bots';

const DT = 1 / 60;

export interface CampaignBotOptions {
  readonly missionId: string;
  readonly role: Kaiju2Role;
  readonly preset: AssistPreset;
  readonly seed: number;
}

export interface CampaignBotResult {
  readonly status: string;
  readonly reason: string | null;
  readonly seconds: number;
  /** 撃墜された（キャンペーンは残機が無いので、そのまま失敗） */
  readonly shotDown: boolean;
  /** 受けたダメージの合計 / 最大体力（墜落を除く） */
  readonly damageRatio: number;
}

/** 地上目標を撃つときの役ごとの狙い: 撃つ角度（機首からの度）・狙いのずれ（度） */
const STRIKE_SKILL: Readonly<Record<Kaiju2Role, { cone: number; aimError: number }>> = {
  skilled: { cone: 2, aimError: 0.4 },
  average: { cone: 3, aimError: 1 },
  beginner: { cone: 4, aimError: 1.6 },
  // 模擬の人の狙いのずれは人の手（hands.ts）が足すので、ここは初心者役と同じ
  human: { cone: 9, aimError: 1.6 },
};

/** M7: 地上目標を機銃で撃つ（StrikeBot の進め方 + 役の狙いのずれ）。goal は人が見て向かう点（方向へ倒す方式の模擬） */
class RoleStrike {
  readonly controls: AircraftControls = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0,
    afterburner: false,
    throttleTarget: 0.75,
  };
  readonly input = createCombatInput();
  readonly goal: Vec3 = { x: 0, y: 0, z: 0 };
  private mode: 'approach' | 'dive' | 'recover' | 'extend' = 'approach';
  private timer = 0;
  private readonly dir: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly nose: Vec3 = { x: 0, y: 0, z: 0 };
  private wobbleX = 0;
  private wobbleY = 0;
  /** 離れる向き（水平の単位ベクトル。離れ始めたときの機首の向きで固定する） */
  private readonly away = { x: 0, z: -1 };

  constructor(
    private readonly s: FlightSession,
    private readonly role: Kaiju2Role,
    private readonly rng: () => number,
    private readonly floor: (x: number, z: number) => number,
  ) {}

  private current: GroundTarget | null = null;

  /** 狙う目標（壊すまで変えない。人は 1 つを狙って何度も入り直す） */
  private pick(): GroundTarget | null {
    if (this.current?.active) return this.current;
    this.current = this.nearest();
    return this.current;
  }

  private nearest(): GroundTarget | null {
    const p = this.s.aircraft.state.position;
    const all = this.s.props.groundTargets.filter((g) => g.active);
    if (this.role === 'skilled') {
      const aaa = nearestActive(
        p,
        all.filter((g) => g.type === 'aaa'),
      );
      if (aaa) return aaa;
    }
    return nearestActive(p, all);
  }

  /** 離れる: 今の機首の水平の向きを覚える */
  private extend(): void {
    const nose = rotateVec3(this.nose, this.s.aircraft.state.orientation, LOCAL_FORWARD);
    const l = Math.hypot(nose.x, nose.z) || 1;
    this.away.x = nose.x / l;
    this.away.z = nose.z / l;
    this.mode = 'extend';
  }

  think(dt: number): void {
    const s = this.s;
    const st = s.aircraft.state;
    const p = st.position;
    const target = this.pick();
    this.input.trigger = false;
    if (!target || !s.player.active) return;
    if (s.combat.targeting.selected !== target) s.combat.targeting.select(target);
    const k = STRIKE_SKILL[this.role];
    // 狙いのずれ: ゆっくり動く（OU 過程）
    const decay = Math.exp(-dt / 1.5);
    const kick = Math.sqrt(1 - decay * decay) * k.aimError;
    this.wobbleX = this.wobbleX * decay + (this.rng() * 2 - 1) * kick;
    this.wobbleY = this.wobbleY * decay + (this.rng() * 2 - 1) * kick;
    const t = target.position;
    const agl = p.y - this.floor(p.x, p.z);
    const horizontal = Math.hypot(t.x - p.x, t.z - p.z);
    const distance = Math.hypot(horizontal, t.y - p.y);
    const d = this.dir;
    if (this.mode === 'extend') {
      // 近すぎる（急降下の角度が足りない）: 離れ始めた向きへまっすぐ離れてから入り直す
      d.x = this.away.x * 1000;
      d.y = Math.max(t.y + 700, this.floor(p.x, p.z) + 600, 1000) - p.y;
      d.z = this.away.z * 1000;
      if (horizontal > 2300) this.mode = 'approach';
    } else if (this.mode === 'approach') {
      d.x = t.x - p.x;
      d.y = Math.max(t.y + 600, 1000) - p.y;
      d.z = t.z - p.z;
      if (horizontal < 2000)
        if (horizontal < 1000) this.extend();
        else this.mode = 'dive';
    } else if (this.mode === 'dive') {
      const aim = s.combat.leadValid ? s.combat.lead : t;
      const off = (distance * Math.PI) / 180;
      d.x = aim.x + this.wobbleX * off - p.x;
      d.y = aim.y + this.wobbleY * off - p.y;
      d.z = aim.z - p.z;
      // 撃つかは本当の照準点からの角度で決める（狙いのずれで機首がずれていれば撃たない = ボタンの人）
      const ax = aim.x - p.x;
      const ay = aim.y - p.y;
      const az = aim.z - p.z;
      const len = Math.hypot(ax, ay, az);
      const nose = rotateVec3(this.nose, st.orientation, LOCAL_FORWARD);
      const cos = (nose.x * ax + nose.y * ay + nose.z * az) / Math.max(1e-6, len);
      this.input.trigger = distance < GUN_CONFIG.range && cos > Math.cos((k.cone * Math.PI) / 180);
      if (agl + s.player.velocity.y * 2 < 150 || distance < 350) {
        this.mode = 'recover';
        this.timer = 4;
      } else if (horizontal < (p.y - t.y) * 0.55) {
        // 真上を越えた（60° より急）: 撃てないので離れて入り直す
        this.extend();
      }
    } else {
      const nose = rotateVec3(this.nose, st.orientation, LOCAL_FORWARD);
      d.x = nose.x;
      d.y = 1;
      d.z = nose.z;
      this.timer -= dt;
      if (this.timer <= 0) {
        if (horizontal < 1500) this.extend();
        else this.mode = 'approach';
      }
    }
    this.goal.x = p.x + d.x;
    this.goal.y = p.y + d.y;
    this.goal.z = p.z + d.z;
    steerToward(this.controls, st.orientation, st.angularRate, d, 1);
  }
}

let shared: Kaiju2BotWorld | null = null;

/** ミッションを 1 回飛ばす（世界は使い回す） */
export function runCampaignBot(o: CampaignBotOptions): CampaignBotResult {
  shared ??= createKaiju2World();
  const world = shared;
  if (o.missionId === 'finale') {
    const r = runKaiju2Bot(
      { role: o.role, seed: o.seed, missionId: o.missionId, preset: o.preset },
      world,
    );
    return {
      status: r.status,
      reason: r.reason,
      seconds: r.seconds,
      shotDown: r.reason === 'playerDown',
      damageRatio: r.damageRatio,
    };
  }
  const role = KAIJU2_ROLES[o.role];
  const def = MISSIONS.find((m) => m.id === o.missionId);
  if (!def) throw new Error(`Mission not found: ${o.missionId}`);
  const { w } = world;
  startFromHeader(w, campaignStart(o.missionId, o.seed, role.weapons));
  const s = w.play.session;
  s.aircraft.flight.options.autoLevel = false;
  const runner = w.play.runner;
  if (!runner) throw new Error('No runner');
  const floor = (x: number, z: number): number => Math.max(0, w.map.ground(x, z));
  const ground = s.props.groundTargets.some((g) => g.deployed);
  const pilot = new PilotBot(s, role.skill, createRandom(500 + o.seed), undefined, w.map.ground);
  const strike = ground ? new RoleStrike(s, o.role, createRandom(900 + o.seed), floor) : null;
  const guard = new BoundsGuard(s, runner.boundary);
  const v = ASSIST_PRESET_VALUES[o.preset];
  const assist = AIM_ASSIST_LEVEL_SPECS[v.aimAssist];
  const throttleMax = o.role === 'human' || o.role === 'beginner';
  const speedMatch = throttleMax && v.speedMatch ? new SpeedMatch() : null;
  const hands = role.touch
    ? new Hands({ ...DEFAULT_HANDS, curve: 1.5 }, createRandom(7000 + o.seed))
    : null;
  const direct = hands ? new DirectStick(hands, w.map.ground, 'horizon') : null;
  const out: AircraftControls = { ...pilot.controls };
  const input = createCombatInput();
  const max = (def.timeLimitSeconds ?? 600) + 10;
  let steps = 0;
  while (runner.running && steps < max * 60) {
    steps++;
    let intent: Readonly<AircraftControls>;
    let goal: Readonly<Vec3> | null = null;
    let fight = false;
    if (strike) strike.think(DT);
    else pilot.think(DT);
    if (guard.check()) {
      intent = guard.controls;
      goal = ISLAND_CENTER_SKY;
    } else if (strike) {
      intent = strike.controls;
      goal = strike.goal;
      fight = true;
    } else {
      intent = pilot.controls;
      fight = true;
      const t = s.combat.targeting.selected;
      if (t?.active) goal = s.combat.leadValid ? s.combat.lead : t.position;
    }
    if (direct) direct.apply(s, goal, intent, out);
    else if (hands) hands.apply(intent, out);
    else Object.assign(out, intent);
    if (throttleMax) {
      out.throttleTarget = steps === 1 ? 1 : null;
      out.throttle = 0;
      out.afterburner = false;
    }
    if (speedMatch) speedMatch.apply(out, s);
    Object.assign(input, fight ? (strike ? strike.input : pilot.input) : createCombatInput());
    s.combat.gun.hitRadiusScale = assist.gunHitRadiusScale;
    const target: CombatTarget | null = s.combat.targeting.selected;
    if (fight && v.autoFire) {
      const c = s.combat;
      const st = s.aircraft.state;
      if (
        autoFireReady(
          target,
          c.lead,
          c.leadValid,
          st.position,
          st.orientation,
          c.gun.hitRadiusScale,
          1,
        )
      )
        input.trigger = true;
    }
    if (target && s.player.active) {
      const aim = s.combat.leadValid ? s.combat.lead : target.position;
      const st = s.aircraft.state;
      applyAimAssist(out, st.position, st.orientation, aim, false, assistSpecFor(assist, target));
    }
    Object.assign(w.controls, out);
    stepWorld(w.play, w.buildings(), w.controls, input, DT);
  }
  return {
    status: runner.status,
    reason: runner.failReason,
    seconds: runner.elapsed,
    shotDown: runner.failReason === 'playerDown',
    damageRatio: s.player.damageTaken / s.player.maxHp,
  };
}
