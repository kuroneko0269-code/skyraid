// チュートリアルの章（9-5c）を通すボット: 「模擬の人」「初心者役」（9-1 の役。scripts/replay-analysis/flight.ts）が、操作の方式
// （方向へ倒す・傾き・ドラッグ・ピッチとロール・キーボード・パッド）ごとに、章の指示どおりに飛ぶ（段階ごとに向かう点・スロットル・
// ボタンを決める）。タッチの方式は本番の初期値（狙いの補助 標準・自動射撃 ON・速度合わせ ON）、キーボード・パッドは 4-12 の
// エイムアシストだけ。人の手（遅れ・ぶれ・デッドゾーン・カーブ）は hands.ts、「方向へ倒す」の組み立ては本番の DirectSteer
import { applyAimAssist } from '../src/combat/aim-assist';
import { autoFireReady } from '../src/combat/auto-fire';
import { createCombatInput, type CombatInput } from '../src/combat/combat-input';
import { SpeedMatch } from '../src/combat/speed-match';
import type { CombatTarget } from '../src/combat/target';
import { createRandom } from '../src/core/random';
import type { DifficultySpec } from '../src/data/ai';
import { AIM_ASSIST_CONFIG, AIM_ASSIST_LEVEL_SPECS } from '../src/data/assist';
import type { TutorialChapter } from '../src/data/tutorial';
import type { AircraftControls } from '../src/entities/aircraft';
import { LOCAL_FORWARD, LOCAL_UP } from '../src/flight/flight-model';
import { rotateVec3, type Vec3 } from '../src/flight/math';
import { RingPassObjective, TaskObjective } from '../src/missions/objectives';
import type { MissionRunner } from '../src/missions/runner';
import { getGroundHeight } from '../src/render/terrain-height';
import { DirectStick } from '../scripts/replay-analysis/direct';
import { BEGINNER_SKILL, HUMAN_SKILL } from '../scripts/replay-analysis/flight';
import { Hands } from '../scripts/replay-analysis/hands';
import { PilotBot } from './ai-sim';
import { Escape, handsFor, keyboardHands, manualThrottle } from './tutorial-bot-hands';
import { DT, WaypointBot, nearestActive, newPlay } from './mission-bots';

export const TUTORIAL_BOT_MODES = [
  'direct',
  'tilt',
  'drag',
  'classic',
  'keyboard',
  'gamepad',
] as const;
export type TutorialBotMode = (typeof TUTORIAL_BOT_MODES)[number];
export type TutorialBotRole = 'human' | 'beginner';

const ROLE_SKILL: Record<TutorialBotRole, DifficultySpec> = {
  human: HUMAN_SKILL,
  beginner: BEGINNER_SKILL,
};

const TOUCH: readonly TutorialBotMode[] = ['direct', 'tilt', 'drag', 'classic'];

export interface TutorialBotResult {
  readonly status: string;
  readonly seconds: number;
  /** 段階 id → 達成までの秒 */
  readonly steps: Readonly<Record<string, number>>;
  /** 出たヒントの数（種類ごと） */
  readonly hints: Readonly<Record<string, number>>;
}

const f: Vec3 = { x: 0, y: 0, z: 0 };
const u: Vec3 = { x: 0, y: 0, z: 0 };

/** 章を 1 回、終わりまで（または maxSeconds）飛ぶ */
export function runTutorialChapter(
  chapter: TutorialChapter,
  mode: TutorialBotMode,
  role: TutorialBotRole,
  seed: number,
  maxSeconds = 240,
  /** 毎ステップの後（調べるとき） */
  onStep?: (
    play: ReturnType<typeof newPlay>,
    runner: MissionRunner,
    out: Readonly<AircraftControls>,
  ) => void,
): TutorialBotResult {
  const play = newPlay(seed);
  const started = play.startTutorial(chapter);
  if (!started) throw new Error(`Chapter has no flight: ${chapter}`);
  const runner: MissionRunner = started;
  const s = play.session;
  const coach = play.tutorial;
  const hints: Record<string, number> = {};
  coach?.bus.on('tutorial:hint', ({ hint }) => (hints[hint] = (hints[hint] ?? 0) + 1));
  const steps: Record<string, number> = {};
  runner.bus.on('objective:complete', ({ id }) => (steps[id] = runner.elapsed));
  const touch = TOUCH.includes(mode);
  const skill = ROLE_SKILL[role];
  const pilot = new PilotBot(s, skill, createRandom(500 + seed), () => pick(), getGroundHeight);
  const wp = new WaypointBot(s);
  const spec = handsFor(mode);
  const hands = spec ? new Hands(spec, createRandom(7000 + seed)) : null;
  const direct =
    hands && touch && mode !== 'classic'
      ? new DirectStick(hands, getGroundHeight, mode === 'drag' ? 'screen-comp' : 'horizon')
      : null;
  const speedMatch = touch ? new SpeedMatch() : null;
  // ピッチとロール・キーボード・パッド: 人の初期値どおりオートレベル ON（離すと水平に戻る）
  s.aircraft.flight.options.autoLevel = direct === null;
  const assist = touch ? AIM_ASSIST_LEVEL_SPECS.normal : AIM_ASSIST_CONFIG;
  const out: AircraftControls = { ...pilot.controls };
  const intent: AircraftControls = { ...pilot.controls };
  const input: CombatInput = createCombatInput();
  const goal: Vec3 = { x: 0, y: 0, z: 0 };
  let flareDelay = -1;
  let selectTimer = 0;
  let banked = false;
  const escape = new Escape();
  const keys = keyboardHands();
  let goAround = false;
  /** 宙返り: 上へ倒し続ける（方向へ倒す方式のスティックの値・ピッチとロールは引き続ける） */
  let stick: { x: number; y: number } | null;
  let release: boolean;
  let loopDone = false;
  let climbing = false;

  function activeTask(): string | null {
    const o = runner.objectives.find((x) => x.status === 'active');
    if (!o) return null;
    return o instanceof TaskObjective ? o.def.task : o.def.id;
  }

  function pick(): CombatTarget | null {
    const p = s.aircraft.state.position;
    const sel = s.combat.targeting.selected;
    if (sel?.active) return sel;
    return nearestActive(p, [...s.combat.drones, ...s.combat.targets.balloons]);
  }

  /** 機首の前方 ahead m・上へ up m の点 */
  function ahead(dist: number, up: number): Vec3 {
    const st = s.aircraft.state;
    rotateVec3(f, st.orientation, LOCAL_FORWARD);
    const h = Math.hypot(f.x, f.z) || 1;
    goal.x = st.position.x + (f.x / h) * dist;
    goal.y = st.position.y + up;
    goal.z = st.position.z + (f.z / h) * dist;
    return goal;
  }

  for (let i = 0; i < maxSeconds * 60 && runner.running; i++) {
    const st = s.aircraft.state;
    const task = activeTask();
    Object.assign(input, createCombatInput());
    let aim: Vec3 | null = null;
    let fight = false;
    stick = null;
    release = false;
    intent.throttleTarget = 0.75;
    intent.afterburner = false;
    rotateVec3(u, st.orientation, LOCAL_UP);
    rotateVec3(f, st.orientation, LOCAL_FORWARD);
    switch (task) {
      case 'rings': {
        const r = runner.objectives[0];
        const next = r instanceof RingPassObjective ? r.next : null;
        if (!next) break;
        // 外したら（横を過ぎた）、リングの手前 2km まで離れてから向かい直す（人のやり直し）
        const n = next.normal;
        const p = next.position;
        const back = { x: p.x - n.x * 2000, y: p.y, z: p.z - n.z * 2000 };
        const dx = p.x - st.position.x;
        const dz = p.z - st.position.z;
        const along = dx * n.x + dz * n.z;
        if (along < 150 && Math.hypot(dx, dz) < 2000) goAround = true;
        if (goAround && Math.hypot(back.x - st.position.x, back.z - st.position.z) < 500)
          goAround = false;
        aim = goAround ? Object.assign(goal, back) : p;
        break;
      }
      case 'level': {
        // 傾けてから離す: 右へ 60° の点へ曲がり、バンクが付いたら前の水平の点へ
        const right = Math.atan2(-rotateVec3(goal, st.orientation, { x: 1, y: 0, z: 0 }).y, u.y);
        if (Math.abs(right) < (35 * Math.PI) / 180 && !banked) {
          const h = Math.atan2(f.x, -f.z) + Math.PI / 3;
          goal.x = st.position.x + Math.sin(h) * 1500;
          goal.y = st.position.y;
          goal.z = st.position.z - Math.cos(h) * 1500;
          aim = goal;
        } else {
          // 離す（方向へ倒す方式は水平に戻る・ほかはオートレベル）
          banked = true;
          aim = null;
          release = true;
        }
        break;
      }
      case 'climb': {
        const o = runner.objectives.find((x) => x.status === 'active');
        aim = ahead(1500, (o?.current ?? 0) < 1 ? 700 : -700);
        break;
      }
      case 'slow':
        aim = direct ? null : ahead(2000, 0);
        intent.throttleTarget = 0;
        break;
      case 'ab':
        aim = direct ? null : ahead(2000, 0);
        intent.throttleTarget = 1;
        intent.afterburner = true;
        break;
      case 'follow': {
        const d = s.combat.drones[0];
        if (d?.active) aim = s.combat.leadValid ? s.combat.lead : d.position;
        // タッチは速度合わせに任せる（スロットル最大のまま）。キーボード・パッドは近いと下げる（指示どおり）
        if (touch) intent.throttleTarget = 1;
        else if (d) intent.throttleTarget = manualThrottle(st.position, d.position);
        break;
      }
      case 'flare':
        aim = direct ? null : ahead(2000, 0);
        if (s.combat.incomingMissiles(s.player) > 0) {
          if (flareDelay < 0) flareDelay = skill.reactionSeconds;
          flareDelay -= DT;
          if (flareDelay <= 0 && flareDelay > -DT) input.flare = true;
        } else flareDelay = -1;
        break;
      case 'loopTop':
      case 'reverse': {
        intent.throttleTarget = 1;
        intent.afterburner = st.speed < 300;
        // 上へ倒し続ける（ピッチとロールの方式は引き続ける）。頂点（背中が下・機首が水平に近い）で離して水平に戻す（reverse）
        const top = u.y < -0.3 && Math.abs(f.y) < 0.45;
        if (task === 'reverse' && (top || loopDone)) {
          loopDone = u.y < 0.95;
          stick = null;
          // 離す（ピッチとロールの方式はオートレベルで背中が上へ戻る）
          aim = null;
          release = true;
        } else if (!climbing && st.speed < 260) {
          // 遅い（NEED SPEED）: 水平のまま AB で加速してから
          intent.afterburner = true;
          aim = direct ? null : ahead(2000, 0);
        } else {
          climbing = f.y > 0.2 || st.speed >= 260;
          stick = { x: 0, y: 1 };
        }
        if (f.y < 0.2 && u.y > 0.9 && st.speed < 260) climbing = false;
        break;
      }
      case 'select': {
        aim = direct ? null : ahead(2000, 0);
        selectTimer += DT;
        if (selectTimer >= 1.5) {
          selectTimer = 0;
          if (mode === 'keyboard' || mode === 'gamepad') input.targetNext = true;
          else {
            // タッチ: 画面の別の的をタップ
            const t = s.combat.targeting;
            const other = t.candidates.find((c) => c !== t.selected && c.active);
            if (other) t.select(other);
          }
        }
        break;
      }
      case 'behind': {
        const d = s.combat.drones[0];
        if (d?.active) aim = d.position;
        break;
      }
      default:
        fight = true;
    }
    // オートレベル: 離して水平に戻す段階だけ（戦う段階のボットの AI はオートレベルなしで作ってある）
    s.aircraft.flight.options.autoLevel = direct === null && !fight;
    let base: Readonly<AircraftControls> = intent;
    if (fight) {
      pilot.think(DT);
      base = pilot.controls;
      Object.assign(input, pilot.input);
      const t = s.combat.targeting.selected;
      if (t?.active) aim = s.combat.leadValid ? s.combat.lead : t.position;
      // キーボード・パッド（速度合わせなし）: 教わったとおり、近づいたらスロットルを下げる
      if (!touch && t?.active) {
        Object.assign(intent, pilot.controls);
        intent.throttleTarget = manualThrottle(st.position, t.position);
        intent.afterburner = false;
        base = intent;
      }
      // 近すぎて回り込めない（横を回り続ける）: いったん離れてから向かい直す（人のやり直し）
      if (t?.active && escape.check(st, t.position)) {
        aim = escape.point;
        wp.fly(aim);
        Object.assign(intent, pilot.controls);
        intent.pitch = wp.controls.pitch;
        intent.roll = wp.controls.roll;
        intent.yaw = wp.controls.yaw;
        base = intent;
        input.trigger = false;
      }
      // 練習の章はミサイルの章だけミサイルを使う
      if (chapter !== 'missile') input.missile = false;
      if (chapter === 'missile') input.trigger = false;
    } else if (stick || release) {
      intent.pitch = stick ? 1 : 0;
      intent.roll = 0;
      intent.yaw = 0;
    } else if (aim) {
      wp.fly(aim);
      intent.pitch = wp.controls.pitch;
      intent.roll = wp.controls.roll;
      intent.yaw = wp.controls.yaw;
    } else {
      wp.fly(ahead(2000, 0));
      intent.pitch = wp.controls.pitch;
      intent.roll = wp.controls.roll;
      intent.yaw = 0;
    }
    if (direct && stick) direct.applyStick(s, stick.x, stick.y, base, out);
    else if (direct) direct.apply(s, aim, base, out);
    else if (hands) {
      hands.apply(base, out);
      // 指を離した（スティック・パッドは 0）
      if (release) out.pitch = out.roll = out.yaw = 0;
    } else keys(base, out);
    if (speedMatch) speedMatch.apply(out, s);
    if (
      touch &&
      autoFireReady(
        s.combat.targeting.selected,
        s.combat.lead,
        s.combat.leadValid,
        st.position,
        st.orientation,
        s.combat.gun.hitRadiusScale,
      ) &&
      chapter !== 'missile'
    )
      input.trigger = true;
    s.combat.gun.hitRadiusScale = assist.gunHitRadiusScale;
    const target = s.combat.targeting.selected;
    if (target && s.player.active) {
      const p = s.combat.leadValid ? s.combat.lead : target.position;
      applyAimAssist(out, st.position, st.orientation, p, false, assist);
    }
    play.step(out, input, DT);
    onStep?.(play, runner, out);
  }
  return { status: runner.status, seconds: runner.elapsed, steps, hints };
}
