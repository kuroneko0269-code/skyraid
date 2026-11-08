// 10-3b: 白鯨アルビオンのソロのレイドの調整のボット（ネフィルガの kaiju2-raid-bots.ts と同じ形）。本番の飛行・戦闘・アルビオンの
// 判定をそのまま回す（startFromHeader → stepWorld。リプレイと同じ道）。役はネフィルガと同じ（kaiju2-bot-roles.ts）:
// - skilled（熟練）: 巣 → 尾 → 頭 → 背びれ → 胴の順に壊す・寄ってきた子分は先に落とす・予兆を見て 0.25 秒で避ける
// - average / beginner / human: ロックした部位（初めは近い所）を撃つ。予兆は半分 / 3 回に 1 回避ける
// 手応えの指標（9-6d）: 1 分あたりの攻撃（予兆に入った回数）と子分の体当たり・攻撃 1 回あたりの被弾率・クリア時の体力の減り・
// 撃墜（攻撃 / 体当たり / 墜落）
import { applyAimAssist, assistSpecFor } from '../src/combat/aim-assist';
import { autoFireReady } from '../src/combat/auto-fire';
import { createCombatInput } from '../src/combat/combat-input';
import { createRandom } from '../src/core/random';
import { attackTimes } from '../src/ai/albion-attacks';
import { ALBION_RAID_CONFIG } from '../src/data/albion-raid';
import type { AircraftControls } from '../src/entities/aircraft';
import type { Vec3 } from '../src/flight/math';
import { ReplayRecorder } from '../src/replay/recorder';
import { applyFrame, captureFrame, simHash, startFromHeader, stepWorld } from '../src/replay/sim';
import { PilotBot } from './ai-sim';
import {
  HULL_LOOKAHEAD,
  albionDodgePoint,
  albionHullAvoid,
  albionStart,
  createAlbionWorld,
  type AlbionBotWorld,
} from './albion-bot-parts';
import { bodyLocal } from '../src/ai/albion-aimed';
import { assistFor } from './campaign-start';
import { KAIJU2_ROLES } from './kaiju2-bot-roles';
import { BoundsGuard, ISLAND_CENTER_SKY, WaypointBot } from './mission-bots';
import { DirectStick } from '../scripts/replay-analysis/direct';
import {
  focusPicker,
  gunOnBody,
  type AlbionBotOptions,
  type AlbionBotResult,
} from './albion-bot-types';
import { DEFAULT_HANDS, Hands } from '../scripts/replay-analysis/hands';

const DT = 1 / 60;
/** 10-4c: 近づきすぎない避け方の見越し（役ごとの見越しの倍率）と体の面からの余裕（m） */
const RAM_LOOKAHEAD = 0.4;
const RAM_PAD = 300;

export {
  ALBION_FOCUS,
  albionStart,
  createAlbionWorld,
  type AlbionBotWorld,
} from './albion-bot-parts';

export type { AlbionBotOptions, AlbionBotResult } from './albion-bot-types';

/** 攻撃の当たり（子分のふだんの体当たり・体への衝突を除く） */
const ATTACK_KINDS = ['spout', 'slam', 'geyser', 'sonar', 'roll', 'call'] as const;

export function runAlbionBot(o: AlbionBotOptions, world?: AlbionBotWorld): AlbionBotResult {
  const role = KAIJU2_ROLES[o.role];
  const difficulty = o.difficulty ?? 'normal';
  const { w, dev } = world ?? createAlbionWorld();
  const start = albionStart(o.seed, difficulty, role.weapons);
  const limit = ALBION_RAID_CONFIG.totalSeconds[difficulty] + 10;
  startFromHeader(w, start);
  const play = w.play;
  const rec = o.record ? new ReplayRecorder() : null;
  rec?.begin(start, {
    title: 'albion',
    pilotName: o.role,
    date: '2026-11-07T00:00:00Z',
    gameVersion: '1.1.5',
    startHash: simHash(w),
  });
  const s = play.session;
  s.aircraft.flight.options.autoLevel = false;
  const runner = play.runner;
  if (!runner) throw new Error('No runner');
  const raid = dev.raid;
  const k = raid.kaiju;
  const rng = createRandom(4300 + o.seed);
  const react = o.dodge?.react ?? role.react;
  const dodgeChance = o.dodge?.chance ?? role.dodgeChance;
  const parts = dev.partTargets;
  const minions = dev.minionTargets;
  const pick = focusPicker(s, role.focus, parts, minions);
  const pilot = new PilotBot(s, role.skill, createRandom(500 + o.seed), pick, w.map.ground);
  const wp = new WaypointBot(s);
  const guard = new BoundsGuard(s, runner.boundary);
  const hands = role.touch
    ? new Hands({ ...DEFAULT_HANDS, curve: 1.5 }, createRandom(7000 + o.seed))
    : null;
  const direct = hands ? new DirectStick(hands, w.map.ground, 'horizon') : null;
  const { assist, autoFire, throttleMax, speedMatch } = assistFor(o.role, role.touch, o.preset);
  const out: AircraftControls = { ...pilot.controls };
  const input = createCombatInput();
  const dodgePoint: Vec3 = { x: 0, y: 0, z: 0 };
  const avoidPoint: Vec3 = { x: 0, y: 0, z: 0 };
  let avoid = 0;
  /** 時間の内訳（戦域の端から戻る / 体を避ける / 予兆を避ける / 戦う）のステップ数 */
  const modes = [0, 0, 0, 0];
  let dodge = 0;
  let decided = -1;
  let willDodge = false;
  const vel: Vec3 = { x: 0, y: 0, z: 0 };
  let attacks = 0;
  let hitAttacks = 0;
  let attackCounted = false;
  let lastAction = k.action;
  let attackDowns = 0;
  let ramDowns = 0;
  let bodyDowns = 0;
  let lastBody = 0;
  let lastDowns = s.playerDowns;
  let lastAttackHits = 0;
  let lastRams = 0;
  let maxHit = 0;
  let curHit = 0;
  let lastHp = s.player.hp;
  const attackKinds: Record<string, number> = {};
  const hitKinds: Record<string, number> = {};
  const taken = dev.taken as Record<string, number>;
  let kindAtStart = 0;
  let speedSum = 0;
  let fireSteps = 0;
  let closeSteps = 0;
  let aliveSteps = 0;
  const dists: number[] = [];
  let steps = 0;
  let lastSel = s.combat.targeting.selected;
  const max = o.maxSeconds ?? limit;
  while (runner.running && steps < max * 60) {
    steps++;
    const me = s.aircraft.state.position;
    const ap = s.aircraft.prevPosition;
    vel.x = (me.x - ap.x) / DT;
    vel.y = (me.y - ap.y) / DT;
    vel.z = (me.z - ap.z) / DT;
    // 予兆への反応: 1 回の攻撃に 1 度だけ避けるかを決め（遅れ react 秒）、避けるなら予兆・攻撃の間に範囲へ入りそうなら外へ
    if (k.action === 'windup' && decided !== attacks && k.actionTime >= react) {
      decided = attacks;
      willDodge = rng() < dodgeChance;
    }
    if (
      willDodge &&
      decided === attacks &&
      dodge <= 0 &&
      albionDodgePoint(k, me, vel, dodgePoint)
    ) {
      // 攻撃が終わるまで外にいる（入り直さない。歌・突撃は通り過ぎるまで）
      const tm = k.attack ? attackTimes(k.attack) : { windup: 0, active: 0 };
      const left =
        (k.action === 'windup' ? tm.windup - k.actionTime + tm.active : tm.active - k.actionTime) +
        0.3;
      const cap = k.attack === 'sonar' || k.attack === 'call' ? 3 : 99;
      dodge = Math.max(1.2, Math.min(cap, left));
    }
    // 10-3c: 体へ入りそうなら外へ（短く。予兆を避けている途中でも先に）
    // 10-4c: ぶつかると最大 HP の 8 割（跳ねない）なので、人は体から離れて撃つ: 体の面から 300m に入りそうなら（見越しは短く）
    // 体の軸から横へ離れる。10-3c は見越し 1.1〜2.0 秒・余裕 35m で体の面へ向かって逃げ、間に合わずに弾かれていた（1 回に約 3 回）
    const ahead = (HULL_LOOKAHEAD[o.role] ?? 1.2) * RAM_LOOKAHEAD;
    if (avoid <= 0 && albionHullAvoid(k, me, vel, ahead, avoidPoint, RAM_PAD, true)) avoid = 1.5;
    let intent: Readonly<AircraftControls>;
    let goal: Readonly<Vec3> | null = null;
    let fight = false;
    pilot.think(DT);
    const guarding = guard.check();
    const mode = guarding ? 0 : avoid > 0 ? 1 : dodge > 0 ? 2 : 3;
    modes[mode] = (modes[mode] ?? 0) + 1;
    if (guarding) {
      intent = guard.controls;
      goal = ISLAND_CENTER_SKY;
    } else if (avoid > 0) {
      avoid -= DT;
      if (dodge > 0) dodge -= DT;
      wp.fly(avoidPoint);
      intent = wp.controls;
      goal = avoidPoint;
    } else if (dodge > 0) {
      dodge -= DT;
      wp.fly(dodgePoint);
      intent = wp.controls;
      goal = dodgePoint;
    } else {
      intent = pilot.controls;
      fight = true;
      const t = s.combat.targeting.selected;
      if (t?.active) goal = s.combat.leadValid ? s.combat.lead : t.position;
    }
    // 10-3c: 体を避けるときは手の遅れ・方向へ倒す方式を通さず、そのまま引く（方向へ倒す方式は先に横へ傾けてから引くので、
    // 体の背へ降りていく所から間に合わない。実機の人は大きな体が迫ればまっすぐ引く）
    if (avoid > 0 && !guarding) Object.assign(out, intent);
    else if (direct) direct.apply(s, goal, intent, out);
    else if (hands) hands.apply(intent, out);
    else Object.assign(out, intent);
    if (throttleMax) {
      out.throttleTarget = steps === 1 ? 1 : null;
      out.throttle = 0;
      out.afterburner = false;
    }
    if (speedMatch) speedMatch.apply(out, s);
    // 10-3c: 予兆・体を避けている間は全開で（人は危ないときに速くする。遅いと子分に追いつかれる）
    if (!guarding && (avoid > 0 || dodge > 0)) {
      out.throttleTarget = 1;
      out.afterburner = avoid <= 0;
    }
    Object.assign(input, fight ? pilot.input : createCombatInput());
    s.combat.gun.hitRadiusScale = assist.gunHitRadiusScale;
    // 10-3c: 模擬の人（手で撃つ組）は、機首の線が怪獣の体（どの部位の球でも）に 900m 以内で当たるなら撃つ。実機の人は大きな体が
    // 画面を埋めると撃つ（10-3b の模擬の人は小さな部位から 9° 以内でしか撃たず、ふつうで 0 / 20 だった）
    if (role.touch && !autoFire && fight && s.player.active && gunOnBody(s.aircraft.state, parts))
      input.trigger = true;
    if (autoFire && fight) {
      const c = s.combat;
      const st = s.aircraft.state;
      if (
        autoFireReady(
          c.targeting.selected,
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
    const target = s.combat.targeting.selected;
    if (target && s.player.active) {
      const aim = s.combat.leadValid ? s.combat.lead : target.position;
      const st = s.aircraft.state;
      applyAimAssist(out, st.position, st.orientation, aim, false, assistSpecFor(assist, target));
    }
    const sel = s.combat.targeting.selected;
    if (sel !== lastSel)
      rec?.command({ kind: 'select', target: sel ? s.combat.allTargets.indexOf(sel) : -1 });
    if (rec) {
      const f = captureFrame(rec.frame, out, input, s);
      applyFrame(f, w.controls, input, s);
      s.combat.gun.hitRadiusScale = assist.gunHitRadiusScale;
      rec.push(f);
    } else Object.assign(w.controls, out);
    stepWorld(play, w.buildings(), w.controls, input, DT);
    lastSel = s.combat.targeting.selected;
    // 当たりの数え
    const attackHits = ATTACK_KINDS.reduce((n, kind) => n + dev.taken[kind], 0);
    if (s.player.active) {
      aliveSteps++;
      speedSum += s.aircraft.state.speed;
      if (input.trigger) fireSteps++;
      const o = bodyLocal(k.body, me);
      const along = Math.max(-320, Math.min(320, o.along));
      const surf = Math.max(0, Math.hypot(o.side, o.above, o.along - along) - 50);
      if (surf < 300) closeSteps++;
      if (steps % 30 === 0) dists.push(surf);
    }
    const hp = s.player.hp;
    if (attackHits > lastAttackHits || dev.taken.ram > lastRams) curHit += Math.max(0, lastHp - hp);
    else if (curHit > 0 && k.action !== lastAction) {
      maxHit = Math.max(maxHit, curHit);
      curHit = 0;
    }
    if (s.playerDowns > lastDowns) {
      if (attackHits > lastAttackHits) attackDowns++;
      else if (dev.taken.ram > lastRams) ramDowns++;
      else if (dev.taken.body > lastBody) bodyDowns++;
    }
    lastBody = dev.taken.body;
    lastDowns = s.playerDowns;
    lastAttackHits = attackHits;
    lastRams = dev.taken.ram;
    lastHp = hp;
    if (k.action === 'windup' && lastAction !== 'windup') {
      attacks++;
      attackKinds[k.attack ?? ''] = (attackKinds[k.attack ?? ''] ?? 0) + 1;
      kindAtStart = taken[k.attack ?? ''] ?? 0;
      attackCounted = false;
    } else if (
      !attackCounted &&
      attacks > 0 &&
      k.attack !== null &&
      (taken[k.attack] ?? 0) > kindAtStart
    ) {
      attackCounted = true;
      hitAttacks++;
      hitKinds[k.attack] = (hitKinds[k.attack] ?? 0) + 1;
    }
    lastAction = k.action;
  }
  maxHit = Math.max(maxHit, curHit);
  const data = rec?.finish({ label: runner.status, success: runner.status === 'success' }) ?? null;
  const nests = parts.filter((p) => p.id.startsWith('nest') && p.broken);
  return {
    data,
    hash: simHash(w),
    status: runner.status,
    reason: runner.failReason,
    seconds: runner.elapsed,
    playerDowns: s.playerDowns,
    partsBroken: raid.brokenCount,
    nestsBroken: new Set(nests.map((p) => p.id)).size,
    attacks,
    hitAttacks,
    rams: dev.taken.ram,
    kaijuHp: k.parts.ratio,
    partHits: parts.reduce((n, p) => n + p.hits, 0),
    minionKills: k.swarm.kills,
    hpLostAtClear: runner.status === 'success' ? 1 - s.player.hp / s.player.maxHp : null,
    damageRatio: s.player.damageTaken / s.player.maxHp,
    attackDowns,
    ramDowns,
    bodyDowns,
    taken: { ...dev.taken },
    attackKinds,
    maxHit,
    hitKinds,
    bodyHits: dev.taken.body,
    meanSpeed: speedSum / Math.max(1, aliveSteps),
    medianDist: [...dists].sort((x, y) => x - y)[Math.floor(dists.length / 2)] ?? 0,
    closeShare: closeSteps / Math.max(1, aliveSteps),
    fireShare: fireSteps / Math.max(1, aliveSteps),
    modes: modes.map((m) => m / Math.max(1, steps)),
  };
}
