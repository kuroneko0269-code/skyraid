// ミッションの出現物（2-5）: 輸送機・怪獣の仮実装・敵機の「輸送機を優先」（地上目標は 2-6 の ground-target.test.ts）、
// キャンペーンの解放とランク、表示言語
import { describe, expect, it } from 'vitest';
import { createCombatInput } from '../src/combat/combat-system';
import { TEAM_PLAYER } from '../src/combat/target';
import { detectLocale } from '../src/core/locale';
import { ESCORT_ATTACK_CONFIG } from '../src/data/ai';
import { TRANSPORT_CONFIG } from '../src/data/mission-props';
import { headingQuat } from '../src/entities/enemy-aircraft';
import { Transport } from '../src/entities/transport';
import { quatIdentity } from '../src/flight/math';
import { FlightSession } from '../src/missions/flight-session';
import { CampaignProgress } from '../src/progression/campaign-progress';
import { SaveStore } from '../src/progression/save-store';
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

describe('出現物と戦闘', () => {
  function missionSession(): FlightSession {
    const s = new FlightSession({ rng: () => 0.5 });
    s.startMission({ x: 0, y: 1500, z: 0, headingDeg: 0 });
    return s;
  }

  it('怪獣の部位・地上目標はプレイヤーが撃てる（ロックの候補）。輸送機は候補に入らない', () => {
    const s = missionSession();
    s.spawn({
      kind: 'transport',
      group: 'g',
      trigger: { type: 'start' },
      from: { x: 0, y: 1500, z: -1500 },
      to: { x: 0, y: 1500, z: -9000 },
    });
    for (const part of s.props.kaiju.parts) expect(s.combat.allTargets).toContain(part);
    expect(s.combat.allTargets).not.toContain(s.props.transports[0]);
    expect(s.combat.allies).toContain(s.props.transports[0]);
    expect(s.combat.fuseTargets).toContain(s.props.transports[0]);
  });

  it('地上目標の破壊はグループごとに数える', () => {
    const s = missionSession();
    s.spawn({
      kind: 'groundTarget',
      group: 'depots',
      targetType: 'hangar',
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

describe('キャンペーンの進み具合', () => {
  it('前のミッションを成功するまで次は選べない。ランクは最高のものを残す', () => {
    const p = new CampaignProgress(['a', 'b', 'c'], SaveStore.open(null).store);
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
    const p = new CampaignProgress(['a', 'b', 'c'], SaveStore.open(null).store, true);
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
