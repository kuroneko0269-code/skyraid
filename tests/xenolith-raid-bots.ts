// 10-5b: UFO ゼノリスのソロのレイドの調整のボット（ゴウライの gourai-raid-bots.ts と同じ形）。本番の飛行・戦闘・ゼノリスの
// 判定をそのまま回す（startFromHeader → stepWorld。リプレイと同じ道）。役はネフィルガと同じ（kaiju2-bot-roles.ts）:
// - skilled（熟練）: バリアが外れていればドーム、張っていれば発生器を撃つ。予兆を見て 0.25 秒で避ける
// - average: 張っている間は発生器・外れていれば胴。予兆は半分避ける。beginner / human: ロックした部位（胴）。3 回に 1 回避ける
// 手応えの指標: 1 分あたりの人を狙う攻撃（光線・光の弾）・1 回あたりの被弾率・クリア時の体力の減り・撃墜（なぎ払い / 溜め撃ち /
// 光の弾 / 体 / 墜落）・体への衝突・狙われていない時間（光線・光の弾・瞬間移動の予兆が無い時間）の長さ
import { applyAimAssist, assistSpecFor } from '../src/combat/aim-assist';
import { autoFireReady } from '../src/combat/auto-fire';
import { createCombatInput } from '../src/combat/combat-input';
import { createRandom } from '../src/core/random';
import { XENOLITH_RAID_CONFIG } from '../src/data/xenolith-raid';
import type { AircraftControls } from '../src/entities/aircraft';
import type { Vec3 } from '../src/flight/math';
import { applyFrame, captureFrame, simHash, startFromHeader, stepWorld } from '../src/replay/sim';
import { ReplayRecorder } from '../src/replay/recorder';
import { PilotBot } from './ai-sim';
import { gunOnBody } from './albion-bot-types';
import { assistFor } from './campaign-start';
import {
  XENOLITH_HULL_LOOKAHEAD,
  breakPoint,
  pullPoint,
  createXenolithWorld,
  sweepDodgePoint,
  sweepThreat,
  xenolithHullAvoid,
  xenolithPicker,
  xenolithStart,
  type XenolithBotWorld,
  type XenolithFocus,
} from './xenolith-bot-parts';
import {
  XenolithTally,
  type XenolithBotOptions,
  type XenolithBotResult,
} from './xenolith-bot-types';
import { KAIJU2_ROLES } from './kaiju2-bot-roles';
import { BoundsGuard, ISLAND_CENTER_SKY, WaypointBot } from './mission-bots';
import { DirectStick } from '../scripts/replay-analysis/direct';
import { DEFAULT_HANDS, Hands } from '../scripts/replay-analysis/hands';

const DT = 1 / 60;
const LOW_ATTACK = 60;
const FOCUS: Readonly<Record<string, XenolithFocus>> = {
  skilled: 'smart',
  average: 'gens',
  beginner: 'gens',
  human: 'hull',
};

export { createXenolithWorld, xenolithStart, type XenolithBotWorld } from './xenolith-bot-parts';
export type { XenolithBotOptions, XenolithBotResult } from './xenolith-bot-types';

export function runXenolithBot(o: XenolithBotOptions, world?: XenolithBotWorld): XenolithBotResult {
  const role = KAIJU2_ROLES[o.role];
  const difficulty = o.difficulty ?? 'normal';
  const { w, dev } = world ?? createXenolithWorld();
  const start = xenolithStart(o.seed, difficulty, role.weapons);
  const limit = XENOLITH_RAID_CONFIG.totalSeconds[difficulty] + 10;
  startFromHeader(w, start);
  const play = w.play;
  const rec = o.record ? new ReplayRecorder() : null;
  rec?.begin(start, {
    title: 'xenolith',
    pilotName: o.role,
    date: '2026-11-08T00:00:00Z',
    gameVersion: '1.1.9',
    startHash: simHash(w),
  });
  const s = play.session;
  s.aircraft.flight.options.autoLevel = false;
  const runner = play.runner;
  if (!runner) throw new Error('No runner');
  const raid = dev.raid;
  const k = raid.kaiju;
  k.orbsEnabled = o.noOrbs !== true;
  const rng = createRandom(4500 + o.seed);
  const react = o.dodge?.react ?? role.react;
  const dodgeChance = o.dodge?.chance ?? role.dodgeChance;
  const parts = dev.partTargets;
  const pick = xenolithPicker(s, k, FOCUS[o.role] ?? 'hull', parts);
  const pilot = new PilotBot(s, role.skill, createRandom(500 + o.seed), pick, w.map.ground);
  pilot.aglBonus = role.touch ? 0 : LOW_ATTACK;
  pilot.damageSense = false;
  const wp = new WaypointBot(s);
  const guard = new BoundsGuard(s, runner.boundary);
  const hands = role.touch
    ? new Hands({ ...DEFAULT_HANDS, curve: 1.5 }, createRandom(7000 + o.seed))
    : null;
  const direct = hands ? new DirectStick(hands, w.map.ground, 'horizon') : null;
  const { assist, autoFire, throttleMax, speedMatch } = assistFor(o.role, role.touch, o.preset);
  const out: AircraftControls = { ...pilot.controls };
  const pullControls: AircraftControls = { ...pilot.controls };
  const input = createCombatInput();
  const dodgePoint: Vec3 = { x: 0, y: 0, z: 0 };
  const avoidPoint: Vec3 = { x: 0, y: 0, z: 0 };
  let avoid = 0;
  let dodge = 0;
  /** 操縦桿をいっぱいに引く残り秒（溜め撃ちを避ける） */
  let pull = 0;
  /** 予兆ごとに 1 度だけ避けるかを決める（光線は撃った回数、光の弾はばらまいた回数で見分ける） */
  let beamKey = -1;
  let beamDodge = false;
  let beamAge = 0;
  let orbKey = -1;
  let orbDodge = false;
  let orbAge = 0;
  const vel: Vec3 = { x: 0, y: 0, z: 0 };
  const modes = [0, 0, 0, 0, 0];
  let steps = 0;
  const tally = new XenolithTally(s);
  const max = o.maxSeconds ?? limit;
  let lastSel = s.combat.targeting.selected;
  while (runner.running && steps < max * 60) {
    steps++;
    const me = s.aircraft.state.position;
    const ap = s.aircraft.prevPosition;
    vel.x = (me.x - ap.x) / DT;
    vel.y = (me.y - ap.y) / DT;
    vel.z = (me.z - ap.z) / DT;
    const beam = k.beam;
    // 光線の予兆: 1 回に 1 度だけ避けるかを決める（遅れ react 秒）
    const beamNo = k.attacksUsed.sweep + k.attacksUsed.charged;
    if (beam.busy && beam.phase !== 'recover') {
      if (beamKey !== beamNo) {
        beamKey = beamNo;
        beamAge = 0;
        beamDodge = rng() < dodgeChance;
      }
      beamAge += DT;
    }
    const deciding = beamDodge && beamKey === beamNo && beamAge >= react;
    if (deciding && dodge <= 0 && pull <= 0 && sweepThreat(k, me)) {
      sweepDodgePoint(k, me, vel, dodgePoint);
      dodge = 1.6;
    }
    // 溜めの間（線が止まった）に、今の傾きのまま操縦桿をいっぱいに引く（線は進む先を狙っているので、進む向きを変える。
    // 低ければ上へ）。ほかの避け方より先に
    if (
      deciding &&
      pull <= 0 &&
      beam.kind === 'charged' &&
      beam.phase === 'charge' &&
      beam.targetId === 0
    ) {
      const floor = Math.max(0, w.map.ground(me.x, me.z));
      if (me.y - floor < 300) {
        pullPoint(k, me, vel, dodgePoint);
        dodge = 2;
      } else {
        dodge = 0;
        pull = 1.5;
      }
    }
    // 光の弾: 予兆ごとに 1 度だけ決め、遅れて横へ曲がる
    if (k.orbPhase === 'warn') {
      if (orbKey !== k.orbVolleys) {
        orbKey = k.orbVolleys;
        orbAge = 0;
        orbDodge = rng() < dodgeChance;
      }
      orbAge += DT;
    } else if (orbKey === k.orbVolleys - 1) orbAge += DT;
    if (orbDodge && orbAge >= react && orbAge < react + 0.3 && dodge <= 0) {
      breakPoint(k, me, vel, dodgePoint);
      dodge = 1.2;
    }
    // 海面・地面に近づきながら下がっていたら引き起こす
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
      xenolithHullAvoid(k, me, vel, XENOLITH_HULL_LOOKAHEAD[o.role] ?? 1.2, avoidPoint)
    )
      avoid = 1;
    let intent: Readonly<AircraftControls>;
    let goal: Readonly<Vec3> | null = null;
    let fight = false;
    pilot.think(DT);
    const guarding = guard.check();
    const mode = guarding
      ? 0
      : avoid > 0
        ? 1
        : dodge > 0 || pull > 0
          ? 2
          : pilot.input.trigger
            ? 4
            : 3;
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
    } else if (pull > 0) {
      pull -= DT;
      if (dodge > 0) dodge -= DT;
      Object.assign(pullControls, pilot.controls, { pitch: 1, roll: 0, yaw: 0 });
      intent = pullControls;
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
    if ((avoid > 0 || pull > 0) && !guarding) Object.assign(out, intent);
    else if (direct) direct.apply(s, goal, intent, out);
    else if (hands) hands.apply(intent, out);
    else Object.assign(out, intent);
    if (throttleMax) {
      out.throttleTarget = steps === 1 ? 1 : null;
      out.throttle = 0;
      out.afterburner = false;
    }
    if (speedMatch) speedMatch.apply(out, s);
    if (!guarding && (avoid > 0 || dodge > 0 || pull > 0)) {
      out.throttleTarget = 1;
      out.afterburner = avoid <= 0;
    }
    Object.assign(input, fight ? pilot.input : createCombatInput());
    s.combat.gun.hitRadiusScale = assist.gunHitRadiusScale;
    // どの役も機首の線が体（どの部位の球でも）に当たれば撃つ（人は体が照準に重なれば撃つ）
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
    // 狙いの補助は戦っている間だけ（避ける・体から離れる間に機首を的へ戻さない。人は避けるときスティックを大きく倒す）
    const target = s.combat.targeting.selected;
    if (fight && target && s.player.active) {
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
    ...tally.result(),
    taken: { ...dev.taken },
    kaijuHp: k.parts.ratio,
    hpLostAtClear: runner.status === 'success' ? 1 - s.player.hp / s.player.maxHp : null,
    damageRatio: s.player.damageTaken / s.player.maxHp,
    bodyHits: dev.taken.body,
    gensBroken: k.brokenGens,
    emittersBroken: k.brokenEmitters,
    warps: k.warp.warps,
    orbVolleys: k.orbVolleys,
    beams: k.attacksUsed.sweep + k.attacksUsed.charged,
    modes: modes.map((m) => Math.round((m / Math.max(1, steps)) * 100)),
  };
}
