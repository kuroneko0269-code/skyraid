// ミッションの出現物（2-5）: 輸送機・怪獣の仮実装・地上目標の仮置き・敵機の「輸送機を優先」、
// キャンペーンの解放とランク、表示言語
import { describe, expect, it } from 'vitest';
import { createCombatInput } from '../src/combat/combat-system';
import { TEAM_PLAYER } from '../src/combat/target';
import { detectLocale } from '../src/core/locale';
import { ESCORT_ATTACK_CONFIG } from '../src/data/ai';
import {
  GROUND_TARGET_PLACEHOLDER_CONFIG,
  KAIJU_PLACEHOLDER_CONFIG,
  TRANSPORT_CONFIG,
} from '../src/data/mission-props';
import { headingQuat } from '../src/entities/enemy-aircraft';
import { GroundTargetPlaceholder } from '../src/entities/ground-target-placeholder';
import { KaijuPlaceholder } from '../src/entities/kaiju-placeholder';
import { Transport } from '../src/entities/transport';
import { quatIdentity } from '../src/flight/math';
import { FlightSession } from '../src/missions/flight-session';
import { CampaignProgress } from '../src/progression/campaign-progress';
import { DT } from './mission-bots';

describe('輸送機', () => {
  it('from から to へ直線で 120 m/s。HP 300、陣営はプレイヤー側', () => {
    const t = new Transport();
    t.deploy('g', { x: 1000, y: 800, z: 0 }, { x: -1000, y: 800, z: 0 });
    expect(t.team).toBe(TEAM_PLAYER);
    expect(t.hp).toBe(300);
    for (let i = 0; i < 600; i++) t.step(DT);
    expect(t.position.x).toBeCloseTo(1000 - TRANSPORT_CONFIG.speed * 10, 6);
    expect(t.position.y).toBe(800);
    expect(t.velocity.x).toBeCloseTo(-120, 6);
    expect(t.progress).toBeCloseTo(0.6, 6);
  });

  it('HP 0 で撃墜（止まり、active でなくなる）', () => {
    const t = new Transport();
    t.deploy('g', { x: 0, y: 800, z: 0 }, { x: 0, y: 800, z: -1000 });
    expect(t.applyDamage(299)).toBe(false);
    expect(t.applyDamage(5)).toBe(true);
    expect(t.active).toBe(false);
    const z = t.position.z;
    t.step(DT);
    expect(t.position.z).toBe(z);
  });
});

describe('怪獣の仮実装', () => {
  const sea = (): number => -60;

  it('海の中から riseSeconds で浮かび上がり、そのあと walkTo へ walkSpeed で歩いて止まる', () => {
    const k = new KaijuPlaceholder(sea);
    k.emerge(1000, 0, 0, 0, 0.2);
    expect(k.phase).toBe('rising');
    expect(k.feet.y).toBe(-KAIJU_PLACEHOLDER_CONFIG.height);
    for (let i = 0; i < KAIJU_PLACEHOLDER_CONFIG.riseSeconds * 60; i++) k.step(DT);
    expect(k.phase).toBe('walking');
    // 海の上では海面に立つ（海底ではない）
    expect(k.feet.y).toBeCloseTo(0, 6);
    expect(k.position.y).toBeCloseTo(KAIJU_PLACEHOLDER_CONFIG.centerHeight, 6);
    for (let i = 0; i < 10 * 60; i++) k.step(DT);
    expect(k.feet.x).toBeCloseTo(1000 - KAIJU_PLACEHOLDER_CONFIG.walkSpeed * 10, 3);
    for (let i = 0; i < 400 * 60; i++) k.step(DT);
    expect(k.feet.x).toBeCloseTo(0, 6);
    expect(k.velocity.x).toBe(0);
  });

  it('全体の HP だけ。retreatRatio のダメージで引き返して沈み、撃墜はされない', () => {
    const k = new KaijuPlaceholder(sea);
    k.emerge(1000, 0, 0, 0, 0.2);
    expect(k.maxHp).toBe(KAIJU_PLACEHOLDER_CONFIG.maxHp);
    // 浮かび上がって 20 秒歩いたところで撃つ
    for (let i = 0; i < (KAIJU_PLACEHOLDER_CONFIG.riseSeconds + 20) * 60; i++) k.step(DT);
    expect(k.applyDamage(KAIJU_PLACEHOLDER_CONFIG.maxHp * 0.1)).toBe(false);
    expect(k.phase).toBe('walking');
    expect(k.damageRatio).toBeCloseTo(0.1, 9);
    k.applyDamage(KAIJU_PLACEHOLDER_CONFIG.maxHp * 0.1);
    expect(k.phase).toBe('retreating');
    expect(k.active).toBe(false);
    // 引き返している間は当たらない
    expect(k.applyDamage(100000)).toBe(false);
    expect(k.isDestroyed).toBe(false);
    for (let i = 0; i < 3 * 60; i++) k.step(DT);
    expect(k.velocity.x).toBeGreaterThan(0);
    for (let i = 0; i < KAIJU_PLACEHOLDER_CONFIG.sinkSeconds * 60; i++) k.step(DT);
    expect(k.phase).toBe('gone');
    expect(k.visible).toBe(false);
  });

  it('HP を一度に全部削っても 1 残る（倒せない）', () => {
    const k = new KaijuPlaceholder(sea);
    k.emerge(0, 0, 0, 0, 1);
    k.applyDamage(1e9);
    expect(k.hp).toBe(1);
  });
});

describe('地上目標の仮置き', () => {
  it('地表に置き（箱の中心は地表 + 高さの半分）、HP 400 で壊れる', () => {
    const g = new GroundTargetPlaceholder(() => 120);
    g.deploy('depots', 'placeholder', 10, 20);
    expect(g.position).toEqual({
      x: 10,
      y: 120 + GROUND_TARGET_PLACEHOLDER_CONFIG.size.height / 2,
      z: 20,
    });
    expect(g.applyDamage(390)).toBe(false);
    expect(g.applyDamage(10)).toBe(true);
    expect(g.active).toBe(false);
  });
});

describe('出現物と戦闘', () => {
  function missionSession(): FlightSession {
    const s = new FlightSession({ rng: () => 0.5 });
    s.startMission({ x: 0, y: 1500, z: 0, headingDeg: 0 });
    return s;
  }

  it('怪獣・地上目標はプレイヤーが撃てる（ロックの候補）。輸送機は候補に入らない', () => {
    const s = missionSession();
    s.spawn({
      kind: 'transport',
      group: 'g',
      trigger: { type: 'start' },
      from: { x: 0, y: 1500, z: -1500 },
      to: { x: 0, y: 1500, z: -9000 },
    });
    expect(s.combat.allTargets).toContain(s.props.kaiju);
    expect(s.combat.allTargets).not.toContain(s.props.transports[0]);
    expect(s.combat.allies).toContain(s.props.transports[0]);
    expect(s.combat.fuseTargets).toContain(s.props.transports[0]);
  });

  it('地上目標の破壊はグループごとに数える', () => {
    const s = missionSession();
    s.spawn({
      kind: 'groundTarget',
      group: 'depots',
      targetType: 'placeholder',
      trigger: { type: 'start' },
      positions: [
        { x: 0, z: -1000 },
        { x: 100, z: -1000 },
      ],
    });
    const [a, b] = s.props.groundTargets;
    if (!a || !b) throw new Error('地上目標がない');
    s.combat.dealDamage(a, 1000, TEAM_PLAYER);
    expect(s.destroyedCount('groundTarget', 'depots')).toBe(1);
    expect(s.destroyedCount('groundTarget')).toBe(1);
    expect(b.active).toBe(true);
  });

  it('輸送機を失うと escortLost。ミッションをやり直すと出現物は消える', () => {
    const s = missionSession();
    s.spawn({
      kind: 'transport',
      group: 'convoy',
      trigger: { type: 'start' },
      from: { x: 0, y: 800, z: 0 },
      to: { x: -1000, y: 800, z: 0 },
    });
    expect(s.escort('convoy')?.active).toBe(true);
    expect(s.escortLost).toBe(false);
    const t = s.props.transports[0];
    if (!t) throw new Error('輸送機がない');
    s.combat.dealDamage(t, 1000, 1);
    expect(s.escortLost).toBe(true);
    s.startMission({ x: 0, y: 1500, z: 0, headingDeg: 0 });
    expect(s.escort('convoy')).toBeNull();
    expect(s.escortLost).toBe(false);
  });

  it('輸送機を優先する敵機は輸送機をロックし、プレイヤー機が近づくと（1500m 以内）プレイヤー機を狙う', () => {
    const s = missionSession();
    s.spawn({
      kind: 'transport',
      group: 'convoy',
      trigger: { type: 'start' },
      from: { x: 0, y: 1000, z: -3000 },
      to: { x: -9000, y: 1000, z: -3000 },
    });
    s.spawn({
      kind: 'enemyFighter',
      group: 'e',
      count: 1,
      difficulty: 'normal',
      trigger: { type: 'start' },
      attack: 'transport',
      // 輸送機のすぐ後ろ、同じ向き（西）
      positions: [{ x: 600, y: 1000, z: -3000, headingDeg: 270 }],
      patrol: [],
    });
    const controls = {
      pitch: 0,
      roll: 0,
      yaw: 0,
      throttle: 0,
      afterburner: false,
      throttleTarget: 0.7,
    };
    const idle = createCombatInput();
    const transport = s.props.transports[0];
    const enemy = s.enemies[0];
    if (!transport || !enemy) throw new Error('出現物がない');
    // プレイヤーは遠く（3km 以上）にいる
    s.aircraft.respawn({ x: 0, y: 1500, z: 3000 });
    let lockedTransport = false;
    for (let i = 0; i < 3 * 60; i++) {
      s.step(controls, idle, DT);
      // 輸送機を狙った敵のミサイルか、敵の機銃が輸送機に当たった
      lockedTransport ||= transport.hp < transport.maxHp;
    }
    const range = (): number =>
      Math.hypot(
        enemy.position.x - s.aircraft.state.position.x,
        enemy.position.y - s.aircraft.state.position.y,
        enemy.position.z - s.aircraft.state.position.z,
      );
    expect(range()).toBeGreaterThan(ESCORT_ATTACK_CONFIG.playerAggroRange);
    expect(lockedTransport).toBe(true);
    expect(s.incomingMissiles).toBe(0);
    // プレイヤーが敵機の 1km 後ろ（同じ西向き）へ。敵機は向き直ってプレイヤー機を狙う（ミサイルか機銃）
    const e = enemy.position;
    s.aircraft.respawn({ x: e.x + 1000, y: e.y, z: e.z }, headingQuat(quatIdentity(), 270));
    expect(range()).toBeLessThan(ESCORT_ATTACK_CONFIG.playerAggroRange);
    let attacked = false;
    for (let i = 0; i < 20 * 60 && !attacked; i++) {
      s.step({ ...controls, throttleTarget: 0.35 }, idle, DT);
      attacked = s.incomingMissiles > 0 || s.player.damageTaken > 0;
    }
    expect(attacked).toBe(true);
  });
});

describe('キャンペーンの進み具合（セッション内）', () => {
  it('前のミッションを成功するまで次は選べない。ランクは最高のものを残す', () => {
    const p = new CampaignProgress(['a', 'b', 'c']);
    expect([p.isUnlocked('a'), p.isUnlocked('b'), p.isUnlocked('c')]).toEqual([true, false, false]);
    p.recordClear('a', 'B');
    expect([p.isUnlocked('b'), p.isUnlocked('c')]).toEqual([true, false]);
    expect(p.bestRank('a')).toBe('B');
    p.recordClear('a', 'C');
    expect(p.bestRank('a')).toBe('B');
    p.recordClear('a', 'S');
    expect(p.bestRank('a')).toBe('S');
    expect(p.bestRank('b')).toBeNull();
    expect(p.isUnlocked('x')).toBe(false);
  });

  it('?unlockAll ならすべて選べる', () => {
    const p = new CampaignProgress(['a', 'b', 'c'], true);
    expect(p.isUnlocked('c')).toBe(true);
  });
});

describe('表示言語', () => {
  it('既定は日本語（他の UI がまだ日本語だけ）。?lang=en で英語、?lang=auto でブラウザの言語', () => {
    expect(detectLocale('', ['en-US'])).toBe('ja');
    expect(detectLocale('?lang=en', ['ja-JP'])).toBe('en');
    expect(detectLocale('?lang=ja', ['en-US'])).toBe('ja');
    expect(detectLocale('?lang=fr', ['en-US'])).toBe('ja');
    expect(detectLocale('?lang=auto', ['ja-JP', 'en'])).toBe('ja');
    expect(detectLocale('?lang=auto', ['en-US'])).toBe('en');
    expect(detectLocale('?lang=auto', [])).toBe('ja');
  });
});
