// 10-4b: メカ怪獣ゴウライのソロのレイドの調整のボット（アルビオンの albion-raid-bots.ts と同じ形）。本番の飛行・戦闘・ゴウライの
// 判定をそのまま回す（startFromHeader → stepWorld。リプレイと同じ道）。役はネフィルガと同じ（kaiju2-bot-roles.ts）:
// - skilled（熟練）: 腰 → 肩の機銃 → ミサイル → 排気口 → 胴の順に壊し、放熱の間は核を撃つ。予兆を見て 0.25 秒で避ける
// - average / beginner / human: ロックした部位（初めは胴）を撃つ。予兆は半分 / 3 回に 1 回避ける
// 手応えの指標: 1 分あたりの大きな攻撃（予兆に入った回数）と弾幕の当たり・人を狙う攻撃（一斉発射・回転掃射）1 回あたりの被弾率・
// クリア時の体力の減り・撃墜（弾幕 / 掃射 / ミサイル / 体 / 墜落）・体への衝突
import { applyAimAssist, assistSpecFor } from '../src/combat/aim-assist';
import { autoFireReady } from '../src/combat/auto-fire';
import { createCombatInput } from '../src/combat/combat-input';
import { createRandom } from '../src/core/random';
import { GOURAI_RAID_CONFIG } from '../src/data/gourai-raid';
import type { AircraftControls } from '../src/entities/aircraft';
import type { Vec3 } from '../src/flight/math';
import { applyFrame, captureFrame, simHash, startFromHeader, stepWorld } from '../src/replay/sim';
import { ReplayRecorder } from '../src/replay/recorder';
import { PilotBot } from './ai-sim';
import { gunOnBody } from './albion-bot-types';
import { assistFor } from './campaign-start';
import {
  GOURAI_HULL_LOOKAHEAD,
  createGouraiWorld,
  flankPoint,
  gouraiHullAvoid,
  gouraiStart,
  missileBreakPoint,
  missileNear,
  sweepDodgePoint,
  sweepThreat,
  type GouraiBotWorld,
} from './gourai-bot-parts';
import {
  GouraiTally,
  focusPicker,
  type GouraiBotOptions,
  type GouraiBotResult,
} from './gourai-bot-types';
import { KAIJU2_ROLES } from './kaiju2-bot-roles';
import { BoundsGuard, ISLAND_CENTER_SKY, WaypointBot } from './mission-bots';
import { DirectStick } from '../scripts/replay-analysis/direct';
import { DEFAULT_HANDS, Hands } from '../scripts/replay-analysis/hands';

const DT = 1 / 60;
/** ボットの AI の地面の回避を下げる高さ（m） */
const LOW_ATTACK = 100;

export { createGouraiWorld, gouraiStart, type GouraiBotWorld } from './gourai-bot-parts';
export type { GouraiBotOptions, GouraiBotResult } from './gourai-bot-types';

export function runGouraiBot(o: GouraiBotOptions, world?: GouraiBotWorld): GouraiBotResult {
  const role = KAIJU2_ROLES[o.role];
  const difficulty = o.difficulty ?? 'normal';
  const { w, dev } = world ?? createGouraiWorld();
  const start = gouraiStart(o.seed, difficulty, role.weapons);
  const limit = GOURAI_RAID_CONFIG.totalSeconds[difficulty] + 10;
  startFromHeader(w, start);
  const play = w.play;
  const rec = o.record ? new ReplayRecorder() : null;
  rec?.begin(start, {
    title: 'gourai',
    pilotName: o.role,
    date: '2026-11-07T00:00:00Z',
    gameVersion: '1.1.8',
    startHash: simHash(w),
  });
  const s = play.session;
  s.aircraft.flight.options.autoLevel = false;
  const runner = play.runner;
  if (!runner) throw new Error('No runner');
  const raid = dev.raid;
  const k = raid.kaiju;
  const rng = createRandom(4400 + o.seed);
  const react = o.dodge?.react ?? role.react;
  const dodgeChance = o.dodge?.chance ?? role.dodgeChance;
  const parts = dev.partTargets;
  const pick = focusPicker(s, role.focus, parts);
  // ゴウライは海面から 80m に浮くので、ボットの AI の地面の回避（150m より下へ行かない）を 100m 下げる（人は低く飛んで撃つ）
  const pilot = new PilotBot(s, role.skill, createRandom(500 + o.seed), pick, w.map.ground);
  pilot.aglBonus = role.touch ? 0 : LOW_ATTACK;
  // 弾幕の小さな当たりで逃げに入ると撃たなくなる（ボットの AI の敵機の動き）。人は撃たれても撃ち返す
  pilot.damageSense = false;
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
  const flankAt: Vec3 = { x: 0, y: 0, z: 0 };
  /** 時間の内訳（戦域の端から戻る / 体を避ける / 予兆を避ける / 戦う / 戦って撃つ）のステップ数 */
  const modes = [0, 0, 0, 0, 0];
  let dodge = 0;
  let decided = -1;
  let willDodge = false;
  let flareAt = -1;
  let warned = false;
  let flareWill = false;
  let warnAge = 0;
  const vel: Vec3 = { x: 0, y: 0, z: 0 };
  let steps = 0;
  const tally = new GouraiTally(s, k.action);
  let lastSel = s.combat.targeting.selected;
  const max = o.maxSeconds ?? limit;
  while (runner.running && steps < max * 60) {
    steps++;
    const me = s.aircraft.state.position;
    const ap = s.aircraft.prevPosition;
    vel.x = (me.x - ap.x) / DT;
    vel.y = (me.y - ap.y) / DT;
    vel.z = (me.z - ap.z) / DT;
    // 予兆への反応: 1 回の攻撃に 1 度だけ避けるかを決める（遅れ react 秒）
    if (k.action === 'windup' && decided !== tally.attacks && k.actionTime >= react) {
      decided = tally.attacks;
      willDodge = rng() < dodgeChance;
    }
    const dodging = willDodge && decided === tally.attacks;
    if (dodging && dodge <= 0 && sweepThreat(k, me, vel)) {
      sweepDodgePoint(k, me, vel, dodgePoint);
      dodge = 1.5;
    }
    // 一斉発射: 避ける回なら、追ってくるミサイルが近づいたらフレア（少し間を空けてもう 1 回）
    // 弾幕のミサイルも、MISSILE の警告で同じ確率で撒く（警告ごとに 1 度決める）
    let flare = false;
    const near = missileNear(k, 0, me);
    if (near && !warned) {
      warned = true;
      flareWill = rng() < dodgeChance;
      warnAge = 0;
    }
    if (!near) warned = false;
    warnAge += DT;
    if (near && flareWill && warnAge >= react && (flareAt < 0 || steps - flareAt > 60)) {
      flare = true;
      flareAt = steps;
    }
    // フレアを撒いても（撒けなくても）、近いミサイルからは直角へ急旋回する（人は大きく曲がって振り切る）
    if (
      flareWill &&
      warnAge >= react &&
      dodge <= 0 &&
      missileBreakPoint(k, 0, me, vel, dodgePoint, 600)
    )
      dodge = 1.2;
    // 海面・地面に近づきながら下がっていたら引き起こす（人は海面すれすれで機首を上げる。ボットの手は遅れて墜ちる）
    const floorY = Math.max(0, w.map.ground(me.x, me.z));
    if (avoid <= 0 && me.y - floorY < 45 + Math.max(0, -vel.y) * 1.2 && vel.y < 0) {
      const sp = Math.hypot(vel.x, vel.z) || 1;
      avoidPoint.x = me.x + (vel.x / sp) * 1200;
      avoidPoint.z = me.z + (vel.z / sp) * 1200;
      avoidPoint.y = floorY + 300;
      avoid = 1;
    }
    if (
      !o.noHullAvoid &&
      avoid <= 0 &&
      gouraiHullAvoid(k, me, vel, GOURAI_HULL_LOOKAHEAD[o.role] ?? 1.2, avoidPoint)
    )
      avoid = 1.2;
    let intent: Readonly<AircraftControls>;
    let goal: Readonly<Vec3> | null = null;
    let fight = false;
    pilot.think(DT);
    const guarding = guard.check();
    const mode = guarding ? 0 : avoid > 0 ? 1 : dodge > 0 ? 2 : pilot.input.trigger ? 4 : 3;
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
    } else if (role.focus && o.flank === true && flankPoint(k, me, flankAt)) {
      // 熟練: 厚い正面にいたら、同じ側の斜め後ろへ回り込む
      wp.fly(flankAt);
      intent = wp.controls;
      goal = flankAt;
    } else {
      intent = pilot.controls;
      fight = true;
      const t = s.combat.targeting.selected;
      if (t?.active) goal = s.combat.leadValid ? s.combat.lead : t.position;
    }
    // 体を避けるときは手の遅れ・方向へ倒す方式を通さず、そのまま引く（アルビオンと同じ）
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
    if (!guarding && (avoid > 0 || dodge > 0)) {
      out.throttleTarget = 1;
      out.afterburner = avoid <= 0;
    }
    Object.assign(input, fight ? pilot.input : createCombatInput());
    if (flare) input.flare = true;
    s.combat.gun.hitRadiusScale = assist.gunHitRadiusScale;
    // 模擬の人（手で撃つ組）は、機首の線が体（どの部位の球でも）に 900m 以内で当たるなら撃つ（アルビオンの 10-3c と同じ）
    // 10-4b: ゴウライは的が小さい（全長 180m）ので、どの役も機首の線が体に当たれば撃つ（人は体が照準に重なれば撃つ）
    if (fight && s.player.active && gunOnBody(s.aircraft.state, parts)) input.trigger = true;
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
    tally.step(s, dev, input.trigger, steps, DT);
  }
  const data = rec?.finish({ label: runner.status, success: runner.status === 'success' }) ?? null;
  return {
    data,
    hash: simHash(w),
    status: runner.status,
    reason: runner.failReason,
    seconds: runner.elapsed,
    playerDowns: s.playerDowns,
    partsBroken: raid.brokenCount,
    turretsAlive: k.turretsAlive,
    ...tally.result(),
    taken: { ...dev.taken },
    kaijuHp: k.parts.ratio,
    partHits: parts.reduce((n, p) => n + p.hits, 0),
    hpLostAtClear: runner.status === 'success' ? 1 - s.player.hp / s.player.maxHp : null,
    damageRatio: s.player.damageTaken / s.player.maxHp,
    bodyHits: dev.taken.body,
    vents: k.vents,
    coreInVent: raid.coreInVent === 1,
    decoyed: k.decoyed,
    modes: modes.map((m) => Math.round((m / Math.max(1, steps)) * 100)),
  };
}
