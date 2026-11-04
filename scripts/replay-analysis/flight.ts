// 9-1 操作の診断: ボット（平均的・初心者役・模擬の人）にキャンペーンのミッションを飛ばす。
// 記録するときは本番の飛行と同じ手順（操作 → エイムアシスト → 量子化して記録 → その値で判定）で .skyreplay を作る。
// 実験（experiments.ts）では、エイムアシストの強さ・自動射撃・スティックのカーブを差し替えて飛ばす（ゲームの数値は変えない）
import { applyAimAssist } from '../../src/combat/aim-assist';
import { autoFireReady } from '../../src/combat/auto-fire';
import { createCombatInput } from '../../src/combat/combat-input';
import { createRandom } from '../../src/core/random';
import type { DifficultySpec } from '../../src/data/ai';
import { AIRCRAFT_MODELS } from '../../src/data/aircraft';
import { AIM_ASSIST_CONFIG, type AimAssistSpec } from '../../src/data/assist';
import { MISSIONS } from '../../src/data/missions';
import type { AircraftControls } from '../../src/entities/aircraft';
import type { Vec3 } from '../../src/flight/math';
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
import { BoundsGuard, ISLAND_CENTER_SKY, WaypointBot } from '../../tests/mission-bots';
import { createWorld } from '../../tests/replay-helpers';
import { DirectStick } from './direct';
import { Hands, DEFAULT_HANDS, type HandsSpec } from './hands';
import type { ControlAnalyzer } from './metrics';
import type { GamePlay } from '../../src/missions/game-play';
import type { PracticeRunner } from '../../src/missions/practice/runner';
import { TEAM_PLAYER, type CombatTarget } from '../../src/combat/target';
import { isPracticeDrill } from '../../src/data/practice';
import { SpeedMatch } from '../../src/combat/speed-match';

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
  /**
   * 「方向へ倒す」方式（9-2。direct.ts。人の手が無い役では無視）。true は地平線を基準に向きを読む人、'screen' は画面（≒機体の向き）
   * の上の方向で読む人
   */
  readonly direct?: boolean | 'screen' | 'screen-comp';
  /** 腕前（省略は役の値） */
  readonly skill?: DifficultySpec;
  /**
   * 9-5b: スロットル。'ai'（省略）はボットの操縦の値（敵機の AI の速さの合わせ方）、'max' は実機の人と同じく最大のまま触らない
   */
  readonly throttle?: 'ai' | 'max';
  /** 9-5b: 速度合わせ（本番と同じ SpeedMatch。タッチの初期値 ON） */
  readonly speedMatch?: boolean;
}

/** 飛ばす課題: キャンペーンのミッション id か、練習場の課題（practice:moving など） */
const PRACTICE_PREFIX = 'practice:';

export interface FlightResult {
  readonly status: string;
  /** 失敗の理由（playerDown・timeUp・outOfBounds。成功・時間切れ前の打ち切りは null） */
  readonly reason: string | null;
  /** 飛んだ秒数 */
  readonly seconds: number;
  readonly data: ReplayData | null;
}

/** 自動射撃の判定（9-3 から本番と同じ autoFireReady）: 選択中の対象の予測照準点が当たる範囲 × scale の中か */
function autoFire(play: GamePlay, scale: number): boolean {
  const s = play.session;
  const c = s.combat;
  const st = s.aircraft.state;
  return autoFireReady(
    c.targeting.selected,
    c.lead,
    c.leadValid,
    st.position,
    st.orientation,
    c.gun.hitRadiusScale,
    scale,
  );
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
  const drill = missionId.startsWith(PRACTICE_PREFIX)
    ? missionId.slice(PRACTICE_PREFIX.length)
    : null;
  const def = drill ? null : MISSIONS.find((m) => m.id === missionId);
  if (!drill && !def) throw new Error(`Mission not found: ${missionId}`);
  if (drill && !isPracticeDrill(drill)) throw new Error(`Drill not found: ${drill}`);
  const model = AIRCRAFT_MODELS[0];
  if (!model) throw new Error('No aircraft');
  const base = {
    aircraftId: model.id,
    upgrades: initialUpgrades(),
    enemies: { enabled: false, difficulty: 'normal', count: 0 },
    seed: 9100 + seed,
    weatherId: 'clear',
  } as const;
  const start: ReplayStart =
    drill && isPracticeDrill(drill)
      ? {
          ...base,
          mode: 'practice',
          mapId: 'island',
          practiceDrill: drill,
          // 画面の縦横比（狙いの指標の「画面の外」。2.16 は iPhone の横画面）
          practiceAspect: 2.16,
        }
      : { ...base, mode: 'mission', mapId: def?.mapId ?? 'island', missionId: def?.id };
  // 本番と同じく、起動のときの敵の設定を入れた世界（analyze.ts と同じ）
  const w = createWorld({ enemies: start.enemies });
  startFromHeader(w, start);
  const play = w.play;
  const s = play.session;
  // ボットはロールを自分で操る（テストと同じ）。人の初期値はオートレベル ON
  s.aircraft.flight.options.autoLevel = false;
  const practice = play.practice;
  const runner = play.runner ?? (practice ? practiceRunnerShim(practice) : null);
  if (!runner) throw new Error('No runner');
  const rec = opts.record ? new ReplayRecorder() : null;
  rec?.begin(start, {
    title: missionId,
    pilotName: role.id,
    date: '2026-11-03T00:00:00Z',
    gameVersion: '1.0.1',
    startHash: simHash(w),
  });
  const pilot = new PilotBot(
    s,
    opts.tweaks?.skill ?? role.skill,
    createRandom(500 + seed),
    practice ? () => nearestTarget(s) : undefined,
    getGroundHeight,
  );
  const speedMatch = opts.tweaks?.speedMatch ? new SpeedMatch() : null;
  const throttleMax = opts.tweaks?.throttle === 'max';
  const wp = new WaypointBot(s);
  const guard = new BoundsGuard(s, runner.boundary);
  const idle = createCombatInput();
  const handsSpec = opts.tweaks?.hands === undefined ? role.hands : opts.tweaks.hands;
  const hands = handsSpec ? new Hands(handsSpec, createRandom(7000 + seed)) : null;
  const direct =
    hands && opts.tweaks?.direct
      ? new DirectStick(
          hands,
          w.map.ground,
          opts.tweaks.direct === true ? 'horizon' : opts.tweaks.direct,
        )
      : null;
  const assist = opts.tweaks?.assist ?? AIM_ASSIST_CONFIG;
  const autoScale = opts.tweaks?.autoFireScale ?? 0;
  const out: AircraftControls = { ...pilot.controls };
  const input = createCombatInput();
  const analyzer = opts.analyzer?.(play) ?? null;
  const step = { controls: w.controls, input, assist: true, stick: direct?.stick ?? null };
  let lastSel = s.combat.targeting.selected;
  let steps = 0;
  for (let i = 0; i < MAX_SECONDS * 60 && runner.running; i++) {
    steps++;
    const ring = runner.activeRings?.next;
    let intent: Readonly<AircraftControls>;
    let combat = idle;
    /**
     * 人が見て向かう点（「方向へ倒す」方式の模擬）: リング・戦域の中央（戦域外から戻る）・戦闘中は選んだ敵（射程内は予測照準点）。
     * 9-2 で低空の安全を入れたので、9-1 の実験と違ってリング・戻る区間もこの方式で飛ぶ
     */
    let goal: Readonly<Vec3> | null = null;
    if (ring) {
      wp.fly(ring.position);
      intent = wp.controls;
      goal = ring.position;
    } else {
      pilot.think(DT);
      if (guard.check()) {
        intent = guard.controls;
        goal = ISLAND_CENTER_SKY;
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
    if (direct) direct.apply(s, goal, intent, out);
    else if (hands) hands.apply(intent, out);
    else Object.assign(out, intent);
    if (throttleMax) {
      // 人: 始めに最大へ上げて、あとは触らない（AB も使わない）
      out.throttleTarget = steps === 1 ? 1 : null;
      out.throttle = 0;
      out.afterburner = false;
    }
    if (speedMatch) speedMatch.apply(out, s);
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
  const status = practice ? 'success' : runner.status;
  const data = rec?.finish({ label: status, success: status === 'success' }) ?? null;
  return { status, data, reason: runner.failReason ?? null, seconds: steps / 60 };
}

/** 練習場（9-5b の比較）: ミッションの runner の代わり（時間切れまで飛ぶ。戦域外では終わらないので戻らない） */
function practiceRunnerShim(p: PracticeRunner): {
  readonly running: boolean;
  readonly status: string;
  readonly failReason: string | null;
  readonly activeRings: null;
  readonly boundary: {
    readonly outside: boolean;
    readonly map: { readonly radius: number };
    distance(x: number, z: number): number;
  };
} {
  return {
    get running() {
      return p.phase !== 'finished';
    },
    status: 'success',
    failReason: null,
    activeRings: null,
    boundary: { outside: false, map: { radius: 1e9 }, distance: () => 0 },
  };
}

/** 練習場の的（風船・ドローン・模擬の敵）のうち、いちばん近いもの */
function nearestTarget(s: GamePlay['session']): CombatTarget | null {
  const p = s.aircraft.state.position;
  let best: CombatTarget | null = null;
  let bestD = Infinity;
  for (const t of s.combat.allTargets) {
    if (!t.active || t.team === TEAM_PLAYER) continue;
    const d = Math.hypot(t.position.x - p.x, t.position.y - p.y, t.position.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}
