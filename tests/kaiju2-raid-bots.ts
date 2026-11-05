// 9-6b: ネフィルガのソロのレイドの調整のボット。ヴォルガスのボット（kaiju-raid-bots.ts）は運動学の簡易モデルだったが、
// ネフィルガは動く的なので、本番の飛行・戦闘・ネフィルガの判定をそのまま回す（startFromHeader → stepWorld。リプレイと同じ道）。
// 役（9-1 の考え。scripts/replay-analysis/flight.ts）:
// - skilled（熟練）: 熟練の腕前（VETERAN）・武装 Lv3・翼 → 頭 → 尾 → 胴の順に壊す・予兆を見て 0.25 秒で避ける・フレア
// - average（平均的）: 平均的な腕前（AVERAGE + 人の撃ち方）・Lv0・ロックした部位（初めは胴）を撃ち続ける・予兆は半分避ける
// - beginner（初心者役。9-6c）: 9-1 の初心者役（BEGINNER + 人の撃ち方。キーボード・補助なし）・Lv0・ロックした部位を撃つ・
//   予兆は 0.6 秒遅れて 3 回に 1 回避ける
// - human（模擬の人）: 9-1 の模擬の人（初心者役 + 狙いのずれ 4°・9° で撃つ + 人の手）がタッチの初期値（方向へ倒す・カーブ 1.5・
//   狙いの補助 標準・自動射撃 ON）で飛ぶ。予兆は 0.6 秒遅れて 3 回に 1 回避ける
// 機体は初期機 Kestrel（HP 200）。撃墜されても開始位置へ戻って続ける（本番と同じ）
import { applyAimAssist, assistSpecFor } from '../src/combat/aim-assist';
import { autoFireReady } from '../src/combat/auto-fire';
import { createCombatInput } from '../src/combat/combat-input';
import type { CombatTarget } from '../src/combat/target';
import { createRandom } from '../src/core/random';
import type { AssistPreset } from '../src/data/assist';
import { MISSIONS } from '../src/data/missions';
import { assistFor, campaignStart } from './campaign-start';
import { RAID_CONFIG } from '../src/data/kaiju';
import { KAIJU2_RAID_CONFIG } from '../src/data/kaiju2-raid';
import type { RaidDifficulty } from '../src/data/raid';
import type { AircraftControls } from '../src/entities/aircraft';
import type { Vec3 } from '../src/flight/math';
import { attachKaiju2Dev, type Kaiju2Dev } from '../src/missions/kaiju2-dev';
import { NEPHIRGA_VARIANT } from '../src/missions/kaiju2-mission';
import { registerRaidVariant } from '../src/missions/raid-variants';
import { ReplayRecorder } from '../src/replay/recorder';
import { applyFrame, captureFrame, simHash, startFromHeader, stepWorld } from '../src/replay/sim';
import type { ReplayData, ReplayStart } from '../src/replay/types';
import { PilotBot } from './ai-sim';
import { FOCUS, KAIJU2_ROLES, threatOf, type Kaiju2Role } from './kaiju2-bot-roles';
import { BoundsGuard, ISLAND_CENTER_SKY, WaypointBot } from './mission-bots';
import { createWorld, type TestWorld } from './replay-helpers';
import { DirectStick } from '../scripts/replay-analysis/direct';
import { DEFAULT_HANDS, Hands } from '../scripts/replay-analysis/hands';

const DT = 1 / 60;
export type { Kaiju2Role } from './kaiju2-bot-roles';
export { campaignStart } from './campaign-start';

export interface Kaiju2BotOptions {
  readonly role: Kaiju2Role;
  readonly seed: number;
  readonly difficulty?: RaidDifficulty;
  /** 打ち切り（秒。既定は全体の制限時間 + 10） */
  readonly maxSeconds?: number;
  /** 本番の飛行と同じ手順で記録する（量子化した入力で判定。リプレイのテスト） */
  readonly record?: boolean;
  /** 毎ステップの後に呼ぶ（テストの確かめ） */
  readonly onStep?: (dev: Kaiju2Dev) => void;
  /** 9-7: キャンペーンのミッション（M8 の決戦 'finale'）を飛ぶ。省略はレイド */
  readonly missionId?: string;
  /**
   * 9-7: 補助の組（狙いの補助・自動射撃・速度合わせ。src/data/assist.ts）。省略は役の値（模擬の人はタッチの初期値・ほかは補助なし）。
   * 組を渡すと、模擬の人と初心者役はスロットルを最大のまま（9-5d と同じ）、速度合わせは組の値
   */
  readonly preset?: AssistPreset;
}

export interface Kaiju2BotResult {
  readonly status: string;
  readonly reason: string | null;
  readonly seconds: number;
  readonly playerDowns: number;
  readonly partsBroken: number;
  readonly stormAt: number | null;
  /** 1 回の攻撃で受けた最大のダメージ（一撃で落ちないことの確認） */
  readonly maxHit: number;
  readonly hitsTaken: Readonly<Record<string, number>>;
  readonly perches: number;
  /** 9-6d: 攻撃（予兆）の回数・1 度でも当たった攻撃の回数・クリア時に減っていた体力の割合（成功でなければ null） */
  readonly attacks: number;
  readonly hitAttacks: number;
  readonly hpLostAtClear: number | null;
  /** 9-6d: 受けたダメージの合計（墜落を除く）/ 最大体力 */
  readonly damageRatio: number;
  /** 9-6d: 撃墜のうち攻撃によるもの（残りは墜落）・攻撃の種類ごとの回数・状態ごとの秒数 */
  readonly attackDowns: number;
  readonly attackKinds: Readonly<Record<string, number>>;
  readonly stateSeconds: Readonly<Record<string, number>>;
  readonly data: ReplayData | null;
  /** 終わったときの状態のハッシュ */
  readonly hash: string;
}

export interface Kaiju2BotWorld {
  readonly w: TestWorld;
  readonly dev: Kaiju2Dev;
}

export function createKaiju2World(): Kaiju2BotWorld {
  registerRaidVariant(NEPHIRGA_VARIANT);
  const w = createWorld({ enemies: { enabled: false, difficulty: 'normal' } });
  const dev = attachKaiju2Dev(
    w.play,
    { hpPercent: 100, broken: [] },
    {
      ground: w.map.ordnanceGround,
      map: () => w.map.def,
    },
  );
  return { w, dev };
}

export function nephirgaStart(seed: number, difficulty: RaidDifficulty, weapons = 0): ReplayStart {
  return {
    mode: 'raid',
    mapId: RAID_CONFIG.mapId,
    raidDifficulty: difficulty,
    raidKaiju: NEPHIRGA_VARIANT.id,
    aircraftId: 'kestrel',
    upgrades: { engine: 0, airframe: 0, weapons, avionics: 0 },
    enemies: { enabled: false, difficulty: 'normal', count: 0 },
    seed: 9600 + seed,
    weatherId: 'clear',
  };
}

export function runKaiju2Bot(o: Kaiju2BotOptions, world?: Kaiju2BotWorld): Kaiju2BotResult {
  const role = KAIJU2_ROLES[o.role];
  const difficulty = o.difficulty ?? 'normal';
  const { w, dev } = world ?? createKaiju2World();
  const start = o.missionId
    ? campaignStart(o.missionId, o.seed, role.weapons)
    : nephirgaStart(o.seed, difficulty, role.weapons);
  const limit = o.missionId
    ? (MISSIONS.find((m) => m.id === o.missionId)?.timeLimitSeconds ?? 600) + 10
    : KAIJU2_RAID_CONFIG.totalSeconds[difficulty] + 10;
  startFromHeader(w, start);
  const play = w.play;
  const rec = o.record ? new ReplayRecorder() : null;
  rec?.begin(start, {
    title: 'nephirga',
    pilotName: o.role,
    date: '2026-11-04T00:00:00Z',
    gameVersion: '1.0.5',
    startHash: simHash(w),
  });
  const s = play.session;
  s.aircraft.flight.options.autoLevel = false;
  const runner = play.runner;
  if (!runner) throw new Error('No runner');
  const raid = dev.raid;
  const k = raid.body;
  const rng = createRandom(4100 + o.seed);
  const pick = (): CombatTarget => {
    if (!role.focus) {
      const sel = s.combat.targeting.selected;
      return sel && raid.targets.includes(sel as never) ? sel : (raid.targets[0] as CombatTarget);
    }
    for (const id of FOCUS) {
      const t = raid.targets.find((x) => x.id === id);
      if (t && !t.broken) return t;
    }
    return raid.targets[0] as CombatTarget;
  };
  const pilot = new PilotBot(s, role.skill, createRandom(500 + o.seed), pick, w.map.ground);
  const wp = new WaypointBot(s);
  const guard = new BoundsGuard(s, runner.boundary);
  const hands = role.touch
    ? new Hands({ ...DEFAULT_HANDS, curve: 1.5 }, createRandom(7000 + o.seed))
    : null;
  const direct = hands ? new DirectStick(hands, w.map.ground, 'horizon') : null;
  // 9-7: 補助の組（渡さなければ役の値: 模擬の人はタッチの初期値・ほかは補助なし）
  const { assist, autoFire, throttleMax, speedMatch } = assistFor(o.role, role.touch, o.preset);
  const out: AircraftControls = { ...pilot.controls };
  const input = createCombatInput();
  const dodgePoint: Vec3 = { x: 0, y: 0, z: 0 };
  let dodge = 0;
  let decidedKey = '';
  let maxHit = 0;
  let lastHp = s.player.hp;
  let perches = 0;
  let lastHits = 0;
  let attackDamage = 0;
  let lastAttackState = k.state;
  let lastState = k.state;
  let attacks = 0;
  let hitAttacks = 0;
  let attackHitsAtStart = 0;
  let attackCounted = false;
  let attackDowns = 0;
  let lastDowns = s.playerDowns;
  const stateSeconds: Record<string, number> = {};
  const attackKinds: Record<string, number> = {};
  const max = o.maxSeconds ?? limit;
  let steps = 0;
  let lastSel = s.combat.targeting.selected;
  while (runner.running && steps < max * 60) {
    steps++;
    const me = s.aircraft.state.position;
    // 予兆への反応（1 回の攻撃に 1 度だけ決める）
    const key = `${k.attack ?? ''}:${String(k.history.length)}:${String(Math.floor(k.time / 30))}`;
    const threatened = threatOf(dev, me);
    if (threatened && key !== decidedKey && k.stateTime >= role.react) {
      decidedKey = key;
      if (rng() < role.dodgeChance) {
        dodge = 1.6;
        const dx = me.x - k.position.x;
        const dz = me.z - k.position.z;
        const l = Math.hypot(dx, dz) || 1;
        const side = rng() < 0.5 ? -1 : 1;
        dodgePoint.x = me.x + (-dz / l) * side * 1500 + (dx / l) * 500;
        dodgePoint.z = me.z + (dx / l) * side * 1500 + (dz / l) * 500;
        dodgePoint.y = Math.max(me.y, 500);
        if (o.role === 'skilled' && k.attack === 'orbs') input.flare = true;
      }
    }
    let intent: Readonly<AircraftControls>;
    let goal: Readonly<Vec3> | null = null;
    let fight = false;
    pilot.think(DT);
    if (guard.check()) {
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
    const flare = input.flare;
    Object.assign(input, fight ? pilot.input : createCombatInput());
    if (flare) input.flare = true;
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
    // 選択の変更（ボットは直接選ぶ）は HUD のタップと同じ「外部の操作」として記録する
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
    o.onStep?.(dev);
    input.flare = false;
    // 怪獣の攻撃で受けたダメージ（墜落・建物への衝突は数えない）
    const hp = s.player.hp;
    const hitsNow = k.hits.orbs + k.hits.gust + k.hits.dive + k.hits.tail;
    if (hitsNow > lastHits) attackDamage += Math.max(0, lastHp - hp);
    else if (attackDamage > 0 && k.state !== lastAttackState) {
      maxHit = Math.max(maxHit, attackDamage);
      attackDamage = 0;
    }
    const lastHitsAtDown = lastHits;
    lastHits = hitsNow;
    lastAttackState = k.state;
    lastHp = hp;
    if (k.state === 'perched' && lastState !== 'perched') perches++;
    if (s.playerDowns > lastDowns && hitsNow > lastHitsAtDown) attackDowns++;
    lastDowns = s.playerDowns;
    stateSeconds[k.state] = (stateSeconds[k.state] ?? 0) + DT;
    // 9-6d: 予兆に入ったら 1 回。その攻撃（次の予兆まで。雷球は飛んでいる間も）で当たったら被弾の 1 回
    if (k.state === 'windup' && lastState !== 'windup') {
      attacks++;
      attackKinds[k.attack ?? ''] = (attackKinds[k.attack ?? ''] ?? 0) + 1;
      attackHitsAtStart = hitsNow;
      attackCounted = false;
    } else if (!attackCounted && attacks > 0 && hitsNow > attackHitsAtStart) {
      attackCounted = true;
      hitAttacks++;
    }
    lastState = k.state;
  }
  maxHit = Math.max(maxHit, attackDamage);
  const data = rec?.finish({ label: runner.status, success: runner.status === 'success' }) ?? null;
  return {
    data,
    hash: simHash(w),
    status: runner.status,
    reason: runner.failReason,
    seconds: runner.elapsed,
    playerDowns: s.playerDowns,
    partsBroken: raid.brokenCount,
    stormAt: raid.stormAt >= 0 ? raid.stormAt : null,
    maxHit,
    hitsTaken: { ...k.hits },
    perches,
    attacks,
    hitAttacks,
    attackDowns,
    attackKinds,
    stateSeconds,
    damageRatio: s.player.damageTaken / s.player.maxHp,
    hpLostAtClear: runner.status === 'success' ? 1 - s.player.hp / s.player.maxHp : null,
  };
}
