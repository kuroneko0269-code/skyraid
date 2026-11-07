// 10-3b: 白鯨アルビオンのソロのレイドの調整のボット（ネフィルガの kaiju2-raid-bots.ts と同じ形）。本番の飛行・戦闘・アルビオンの
// 判定をそのまま回す（startFromHeader → stepWorld。リプレイと同じ道）。役はネフィルガと同じ（kaiju2-bot-roles.ts）:
// - skilled（熟練）: 巣 → 尾 → 頭 → 背びれ → 胴の順に壊す・寄ってきた子分は先に落とす・予兆を見て 0.25 秒で避ける
// - average / beginner / human: ロックした部位（初めは近い所）を撃つ。予兆は半分 / 3 回に 1 回避ける
// 手応えの指標（9-6d）: 1 分あたりの攻撃（予兆に入った回数）と子分の体当たり・攻撃 1 回あたりの被弾率・クリア時の体力の減り・
// 撃墜（攻撃 / 体当たり / 墜落）
import { applyAimAssist, assistSpecFor } from '../src/combat/aim-assist';
import { autoFireReady } from '../src/combat/auto-fire';
import { createCombatInput } from '../src/combat/combat-input';
import type { CombatTarget } from '../src/combat/target';
import { createRandom } from '../src/core/random';
import { attackTimes } from '../src/ai/albion-attacks';
import type { RaidDifficulty } from '../src/data/raid';
import type { AssistPreset } from '../src/data/assist';
import { ALBION_RAID_CONFIG } from '../src/data/albion-raid';
import type { AircraftControls } from '../src/entities/aircraft';
import type { Vec3 } from '../src/flight/math';
import { ReplayRecorder } from '../src/replay/recorder';
import { applyFrame, captureFrame, simHash, startFromHeader, stepWorld } from '../src/replay/sim';
import type { ReplayData } from '../src/replay/types';
import { PilotBot } from './ai-sim';
import {
  ALBION_FOCUS,
  albionStart,
  albionThreat,
  createAlbionWorld,
  type AlbionBotWorld,
} from './albion-bot-parts';
import { assistFor } from './campaign-start';
import { KAIJU2_ROLES, type Kaiju2Role } from './kaiju2-bot-roles';
import { BoundsGuard, ISLAND_CENTER_SKY, WaypointBot } from './mission-bots';
import { DirectStick } from '../scripts/replay-analysis/direct';
import { DEFAULT_HANDS, Hands } from '../scripts/replay-analysis/hands';

const DT = 1 / 60;

export {
  ALBION_FOCUS,
  albionStart,
  albionThreat,
  createAlbionWorld,
  type AlbionBotWorld,
} from './albion-bot-parts';

export interface AlbionBotOptions {
  readonly role: Kaiju2Role;
  readonly seed: number;
  readonly difficulty?: RaidDifficulty;
  readonly maxSeconds?: number;
  readonly record?: boolean;
  readonly preset?: AssistPreset;
  /** 予兆への反応を上書き（避ける確率・遅れ。「正しく避ければ当たらない」の確かめ） */
  readonly dodge?: { readonly chance: number; readonly react: number };
  /** 調べる用の記録 */
  readonly debug?: (line: string) => void;
}

export interface AlbionBotResult {
  readonly status: string;
  readonly reason: string | null;
  readonly seconds: number;
  readonly playerDowns: number;
  readonly partsBroken: number;
  readonly nestsBroken: number;
  readonly attacks: number;
  readonly hitAttacks: number;
  readonly rams: number;
  /** 終わったときの体力の割合・部位に当てた回数 */
  readonly kaijuHp: number;
  readonly partHits: number;
  readonly minionKills: number;
  readonly hpLostAtClear: number | null;
  readonly damageRatio: number;
  /** 撃墜のうち攻撃（潮吹き・尾）・子分の体当たりによるもの（残りは墜落） */
  readonly attackDowns: number;
  readonly ramDowns: number;
  readonly taken: Readonly<Record<string, number>>;
  readonly attackKinds: Readonly<Record<string, number>>;
  readonly maxHit: number;
  readonly data: ReplayData | null;
  readonly hash: string;
}

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
  const pick = (): CombatTarget => {
    const me = s.aircraft.state.position;
    if (role.focus) {
      // 熟練: 機首の前 15° 以内・500m 以内に来た子分は落とす（追い回さない）
      const st = s.aircraft.state;
      const q = st.orientation;
      const fx = -2 * (q.x * q.z + q.w * q.y);
      const fy = 2 * (q.w * q.x - q.y * q.z);
      const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
      for (const m of minions) {
        if (!m.active) continue;
        const p = m.position;
        const d = Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z);
        const cos = ((p.x - me.x) * fx + (p.y - me.y) * fy + (p.z - me.z) * fz) / (d || 1);
        if (d < 500 && cos > Math.cos((15 * Math.PI) / 180)) return m;
      }
      for (const id of ALBION_FOCUS) {
        const t = parts.find((x) => x.id === id && !x.broken);
        if (t) return t;
      }
    }
    const sel = s.combat.targeting.selected;
    return sel?.active ? sel : ((parts[1] ?? parts[0]) as CombatTarget);
  };
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
  let dodge = 0;
  let decided = -1;
  let willDodge = false;
  const vel: Vec3 = { x: 0, y: 0, z: 0 };
  let attacks = 0;
  let hitAttacks = 0;
  let attackHitsAtStart = 0;
  let attackCounted = false;
  let lastAction = k.action;
  let attackDowns = 0;
  let ramDowns = 0;
  let lastDowns = s.playerDowns;
  let lastAttackHits = 0;
  let lastRams = 0;
  let maxHit = 0;
  let curHit = 0;
  let lastHp = s.player.hp;
  const attackKinds: Record<string, number> = {};
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
    if (willDodge && decided === attacks && albionThreat(k, me, vel)) {
      // 攻撃が終わるまで外にいる（入り直さない）
      const tm = k.attack ? attackTimes(k.attack) : { windup: 0, active: 0 };
      const left =
        (k.action === 'windup' ? tm.windup - k.actionTime + tm.active : tm.active - k.actionTime) +
        0.3;
      dodge = Math.max(dodge, 1.2, left);
      const b = k.body.position;
      // 体の軸から横へ（背の上・真後ろから外へ）、体より下へ
      const fx = -Math.sin(k.body.heading);
      const fz = -Math.cos(k.body.heading);
      const side = (me.x - b.x) * -fz + (me.z - b.z) * fx >= 0 ? 1 : -1;
      dodgePoint.x = me.x + -fz * side * 1400 - fx * 300;
      dodgePoint.z = me.z + fx * side * 1400 - fz * 300;
      dodgePoint.y = Math.max(250, b.y - 300);
    }
    let intent: Readonly<AircraftControls>;
    let goal: Readonly<Vec3> | null = null;
    let fight = false;
    pilot.think(DT);
    const guarding = guard.check();
    if (guarding) {
      intent = guard.controls;
      goal = ISLAND_CENTER_SKY;
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
    if (direct) direct.apply(s, goal, intent, out);
    else if (hands) hands.apply(intent, out);
    else Object.assign(out, intent);
    if (throttleMax) {
      out.throttleTarget = steps === 1 ? 1 : null;
      out.throttle = 0;
      out.afterburner = false;
    }
    if (speedMatch) speedMatch.apply(out, s);
    Object.assign(input, fight ? pilot.input : createCombatInput());
    s.combat.gun.hitRadiusScale = assist.gunHitRadiusScale;
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
    const attackHits = dev.taken.spout + dev.taken.slam;
    if (o.debug && attackHits > lastAttackHits)
      o.debug(
        `hit ${k.attack ?? ''} t=${k.actionTime.toFixed(2)} dodge=${dodge.toFixed(2)} will=${String(willDodge)} guard=${String(guarding)} me=${me.x.toFixed(0)},${me.y.toFixed(0)},${me.z.toFixed(0)} kb=${k.body.position.y.toFixed(0)} active=${String(s.player.active)}`,
      );
    const hp = s.player.hp;
    if (attackHits > lastAttackHits || dev.taken.ram > lastRams) curHit += Math.max(0, lastHp - hp);
    else if (curHit > 0 && k.action !== lastAction) {
      maxHit = Math.max(maxHit, curHit);
      curHit = 0;
    }
    if (s.playerDowns > lastDowns) {
      if (attackHits > lastAttackHits) attackDowns++;
      else if (dev.taken.ram > lastRams) ramDowns++;
    }
    lastDowns = s.playerDowns;
    lastAttackHits = attackHits;
    lastRams = dev.taken.ram;
    lastHp = hp;
    if (k.action === 'windup' && lastAction !== 'windup') {
      attacks++;
      attackKinds[k.attack ?? ''] = (attackKinds[k.attack ?? ''] ?? 0) + 1;
      attackHitsAtStart = attackHits;
      attackCounted = false;
    } else if (!attackCounted && attacks > 0 && attackHits > attackHitsAtStart) {
      attackCounted = true;
      hitAttacks++;
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
    taken: { ...dev.taken },
    attackKinds,
    maxHit,
  };
}
