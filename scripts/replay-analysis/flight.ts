// 9-1 操作の診断: ボット（平均的・初心者役・模擬の人）にキャンペーンのミッションを飛ばす。
// 記録するときは本番の飛行と同じ手順（操作 → エイムアシスト → 量子化して記録 → その値で判定）で .skyreplay を作る。
// 実験（experiments.ts）では、エイムアシストの強さ・自動射撃・スティックのカーブを差し替えて飛ばす（ゲームの数値は変えない）
import { applyAimAssist } from '../../src/combat/aim-assist';
import { createCombatInput } from '../../src/combat/combat-input';
import { createRandom } from '../../src/core/random';
import type { DifficultySpec } from '../../src/data/ai';
import { AIRCRAFT_MODELS } from '../../src/data/aircraft';
import { AIM_ASSIST_CONFIG, type AimAssistSpec } from '../../src/data/assist';
import { MISSIONS } from '../../src/data/missions';
import { GUN_CONFIG } from '../../src/data/weapons';
import type { AircraftControls } from '../../src/entities/aircraft';
import { inverseRotateVec3, type Vec3 } from '../../src/flight/math';
import { initialUpgrades } from '../../src/progression/save';
import { ReplayRecorder } from '../../src/replay/recorder';
import {
  applyFrame,
  captureFrame,
  simHash,
  startFromHeader,
  stepWorld,
} from '../../src/replay/sim';
import type { ReplayData, ReplayStart } from '../../src/replay/types';
import { getGroundHeight } from '../../src/render/terrain-height';
import { AVERAGE, BEGINNER, PilotBot } from '../../tests/ai-sim';
import { BoundsGuard, WaypointBot } from '../../tests/mission-bots';
import { createWorld } from '../../tests/replay-helpers';
import { DirectStick } from './direct';
import { Hands, DEFAULT_HANDS, type HandsSpec } from './hands';
import type { ControlAnalyzer } from './metrics';
import type { GamePlay } from '../../src/missions/game-play';

const DT = 1 / 60;
const MAX_SECONDS = 480;
/** 人の撃ち方（8-6b〜8-6d のテストと同じ: 2 秒撃って 0.5 秒休む） */
const HUMAN_GUN = { gunBurstSeconds: 2, gunPauseSeconds: 0.5 } as const;

export interface Role {
  readonly id: string;
  readonly label: string;
  readonly skill: DifficultySpec;
  /** 人の手の模擬（無ければボットの操縦をそのまま） */
  readonly hands: HandsSpec | null;
}

/** 模擬の人: 初心者役に、狙いのずれ 4°・機首から 9° 以内なら撃つ・反応の遅れと指のぶれを足す（8-6d の「人に近い」と同じ考え） */
export const HUMAN_SKILL: DifficultySpec = {
  ...BEGINNER,
  ...HUMAN_GUN,
  aimErrorDeg: 4,
  gunConeDeg: 9,
};

export const BEGINNER_SKILL: DifficultySpec = { ...BEGINNER, ...HUMAN_GUN };

export const ROLES: readonly Role[] = [
  { id: 'average', label: '平均的', skill: { ...AVERAGE, ...HUMAN_GUN }, hands: null },
  { id: 'beginner', label: '初心者役', skill: BEGINNER_SKILL, hands: null },
  { id: 'human', label: '模擬の人', skill: HUMAN_SKILL, hands: DEFAULT_HANDS },
];

export function findRole(id: string): Role {
  const r = ROLES.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown role: ${id}`);
  return r;
}

/** 実験で差し替えるもの */
export interface FlightTweaks {
  /** エイムアシスト（省略は今の値） */
  readonly assist?: AimAssistSpec;
  /** 自動射撃: 予測照準点が「当たる範囲 × この倍率」に入り、射程内なら撃つ（省略・0 は無し） */
  readonly autoFireScale?: number;
  /** 人の手（省略は役の値。null は無し = ボットの操縦をそのまま） */
  readonly hands?: HandsSpec | null;
  /** 9-2 の案「画面の上の方向へ倒す」スティック（direct.ts。人の手が無い役では無視） */
  readonly direct?: boolean;
  /** 腕前（省略は役の値） */
  readonly skill?: DifficultySpec;
}

export interface FlightResult {
  readonly status: string;
  readonly data: ReplayData | null;
}

const local: Vec3 = { x: 0, y: 0, z: 0 };

/** 自動射撃の判定（実験用）: 選択中の対象の予測照準点が当たる範囲 × scale の中か */
function autoFire(play: GamePlay, scale: number): boolean {
  const s = play.session;
  const target = s.combat.targeting.selected;
  if (!target?.active || !s.combat.leadValid) return false;
  const st = s.aircraft.state;
  const a = s.combat.lead;
  local.x = a.x - st.position.x;
  local.y = a.y - st.position.y;
  local.z = a.z - st.position.z;
  inverseRotateVec3(local, st.orientation, local);
  const d = Math.hypot(local.x, local.y, local.z);
  if (-local.z <= 0 || d > GUN_CONFIG.range) return false;
  const angle = Math.atan2(Math.hypot(local.x, local.y), -local.z);
  const r = target.hitRadius * s.combat.gun.hitRadiusScale;
  return angle <= Math.atan2(r, d) * scale;
}

/**
 * ミッションを 1 回飛ばす。record なら .skyreplay の形で返す。analyzer を渡せば毎ステップ集計する（記録の値で）
 */
export function flyMission(
  missionId: string,
  seed: number,
  role: Role,
  opts: {
    readonly record?: boolean;
    readonly tweaks?: FlightTweaks;
    readonly analyzer?: (play: GamePlay) => ControlAnalyzer;
  } = {},
): FlightResult {
  const def = MISSIONS.find((m) => m.id === missionId);
  if (!def) throw new Error(`Mission not found: ${missionId}`);
  const model = AIRCRAFT_MODELS[0];
  if (!model) throw new Error('No aircraft');
  const start: ReplayStart = {
    mode: 'mission',
    mapId: def.mapId,
    missionId: def.id,
    aircraftId: model.id,
    upgrades: initialUpgrades(),
    enemies: { enabled: false, difficulty: 'normal', count: 0 },
    seed: 9100 + seed,
    weatherId: 'clear',
  };
  const w = createWorld();
  startFromHeader(w, start);
  const play = w.play;
  const s = play.session;
  // ボットはロールを自分で操る（テストと同じ）。人の初期値はオートレベル ON
  s.aircraft.flight.options.autoLevel = false;
  const runner = play.runner;
  if (!runner) throw new Error('No runner');
  const rec = opts.record ? new ReplayRecorder() : null;
  rec?.begin(start, {
    title: def.id,
    pilotName: role.id,
    date: '2026-11-03T00:00:00Z',
    gameVersion: '1.0.1',
    startHash: simHash(w),
  });
  const pilot = new PilotBot(
    s,
    opts.tweaks?.skill ?? role.skill,
    createRandom(500 + seed),
    undefined,
    getGroundHeight,
  );
  const wp = new WaypointBot(s);
  const guard = new BoundsGuard(s, runner.boundary);
  const idle = createCombatInput();
  const handsSpec = opts.tweaks?.hands === undefined ? role.hands : opts.tweaks.hands;
  const hands = handsSpec ? new Hands(handsSpec, createRandom(7000 + seed)) : null;
  const direct = hands && opts.tweaks?.direct ? new DirectStick(hands) : null;
  const assist = opts.tweaks?.assist ?? AIM_ASSIST_CONFIG;
  const autoScale = opts.tweaks?.autoFireScale ?? 0;
  const out: AircraftControls = { ...pilot.controls };
  const input = createCombatInput();
  const analyzer = opts.analyzer?.(play) ?? null;
  const step = { controls: w.controls, input, assist: true };
  let lastSel = s.combat.targeting.selected;
  for (let i = 0; i < MAX_SECONDS * 60 && runner.running; i++) {
    const ring = runner.activeRings?.next;
    let intent: Readonly<AircraftControls>;
    let combat = idle;
    /**
     * 人が見て向かう点（「画面の上の方向へ倒す」スティックの模擬。戦闘中だけ。リング・戦域外から戻る区間は
     * 模擬に地面の回避が無く低空のリングで落ちるので、今のスティックの模擬のまま）
     */
    let goal: Readonly<Vec3> | null = null;
    if (ring) {
      wp.fly(ring.position);
      intent = wp.controls;
    } else {
      pilot.think(DT);
      if (guard.check()) {
        intent = guard.controls;
      } else {
        intent = pilot.controls;
        combat = pilot.input;
        const t = s.combat.targeting.selected;
        if (t?.active) goal = s.combat.leadValid ? s.combat.lead : t.position;
      }
    }
    // 選択の変更（ボットは直接選ぶ）は HUD のタップと同じ「外部の操作」として記録する
    const sel = s.combat.targeting.selected;
    if (sel !== lastSel)
      rec?.command({ kind: 'select', target: sel ? s.combat.allTargets.indexOf(sel) : -1 });
    if (direct && goal) direct.apply(s, goal, intent, out);
    else if (hands) hands.apply(intent, out);
    else Object.assign(out, intent);
    Object.assign(input, combat);
    if (autoScale > 0 && autoFire(play, autoScale)) input.trigger = true;
    // エイムアシスト（AssistControl と同じ手順。タッチで ON の前提）
    s.combat.gun.hitRadiusScale = assist.gunHitRadiusScale;
    const target = s.combat.targeting.selected;
    if (target && s.player.active) {
      const aim = s.combat.leadValid ? s.combat.lead : target.position;
      const st = s.aircraft.state;
      applyAimAssist(out, st.position, st.orientation, aim, false, assist);
    }
    if (rec) {
      const f = captureFrame(rec.frame, out, input, s);
      applyFrame(f, w.controls, input, s);
      s.combat.gun.hitRadiusScale = assist.gunHitRadiusScale;
      rec.push(f);
    } else Object.assign(w.controls, out);
    analyzer?.before(step);
    stepWorld(play, w.buildings(), w.controls, input, DT);
    analyzer?.after();
    lastSel = s.combat.targeting.selected;
  }
  const status = runner.status;
  const data = rec?.finish({ label: status, success: status === 'success' }) ?? null;
  return { status, data };
}
