import { describe, expect, it } from 'vitest';
import {
  PvpArena,
  RESPAWN_BOOST,
  type ArenaEvent,
  type PvpControls,
} from '../src/combat/pvp-arena';
import {
  Countdown,
  PvpMatch,
  bestPlayer,
  isRookie,
  teamTotals,
  type PlayerScore,
} from '../src/combat/pvp-rules';
import { PVP_CONFIG } from '../src/data/pvp';
import { Aircraft, createControls } from '../src/entities/aircraft';
import { allAgain, autoTeams, sameSide, startBlock, teamForNewcomer } from '../src/net/lobby-rules';
import { netLoadout } from '../src/net/loadout';
import { NO_TARGET, type PlayerInfo } from '../src/net/protocol';
import { seeded } from './net-helpers';

const DT = 1 / 60;
const KESTREL = netLoadout('kestrel', undefined);
const SPEC = {
  maxHp: KESTREL.flight.hull.maxHp,
  hitRadius: KESTREL.flight.hull.hitRadius,
  visualRadius: KESTREL.flight.hull.visualRadius,
  gunDamage: KESTREL.gunDamage,
  missiles: KESTREL.missiles,
  flares: KESTREL.flares,
  targeting: KESTREL.targeting,
};

function controls(over: Partial<PvpControls> = {}): PvpControls {
  return {
    ...createControls(),
    autoLevel: false,
    invertPitch: false,
    fire: false,
    missile: false,
    flare: false,
    locked: false,
    targetId: NO_TARGET,
    ...over,
  };
}

function player(id: number, over: Partial<PlayerInfo> = {}): PlayerInfo {
  return {
    id,
    name: `P${id}`,
    aircraftId: 'kestrel',
    maxHp: 200,
    team: id % 2,
    ready: false,
    again: false,
    away: false,
    ...over,
  };
}

function score(id: number, kills: number, deaths = 0, shots = 0, hits = 0): PlayerScore {
  return { id, kills, deaths, shots, hits };
}

describe('ロビー: Ready の判定（5-4）', () => {
  it('2 人以上・ホスト以外の全員が Ready なら開始できる（ホストは Ready 不要）', () => {
    expect(startBlock([player(0)], 'ffa')).toBe('players');
    expect(startBlock([player(0), player(1)], 'ffa')).toBe('ready');
    expect(startBlock([player(0), player(1, { ready: true })], 'ffa')).toBeNull();
    const three = [player(0), player(1, { ready: true }), player(2)];
    expect(startBlock(three, 'ffa')).toBe('ready');
    three[2] = player(2, { ready: true });
    expect(startBlock(three, 'ffa')).toBeNull();
  });

  it('再接続を待っている人がいると開始できない', () => {
    const list = [player(0), player(1, { ready: true, away: true })];
    expect(startBlock(list, 'ffa')).toBe('away');
  });

  it('チーム戦は両方のチームに 1 人以上', () => {
    const list = [player(0, { team: 0 }), player(1, { ready: true, team: 0 })];
    expect(startBlock(list, 'team')).toBe('teams');
    list[1] = player(1, { ready: true, team: 1 });
    expect(startBlock(list, 'team')).toBeNull();
  });

  it('全員が「もう一度」を押したらロビーへ', () => {
    expect(allAgain([player(0, { again: true }), player(1)])).toBe(false);
    expect(allAgain([player(0, { again: true }), player(1, { again: true })])).toBe(true);
  });
});

describe('チーム戦: 割当・味方の判定・スコア（5-4）', () => {
  it('自動の割当は ID 順に A・B・A・B（2 対 2）。新しく入った人は少ない方へ', () => {
    const teams = autoTeams([player(3), player(0), player(2), player(1)]);
    expect([0, 1, 2, 3].map((id) => teams.get(id))).toEqual([0, 1, 0, 1]);
    expect(teamForNewcomer([player(0, { team: 0 }), player(1, { team: 0 })])).toBe(1);
    expect(teamForNewcomer([player(0, { team: 0 }), player(1, { team: 1 })])).toBe(0);
  });

  it('味方の判定: 個人戦は本人だけ、チーム戦は同じチーム', () => {
    const teamOf = (id: number) => [0, 1, 0, 1][id];
    expect(sameSide(0, 2, 'ffa', teamOf)).toBe(false);
    expect(sameSide(0, 0, 'ffa', teamOf)).toBe(true);
    expect(sameSide(0, 2, 'team', teamOf)).toBe(true);
    expect(sameSide(0, 1, 'team', teamOf)).toBe(false);
  });

  it('スコアはチームの合計。合計が撃墜数に達したら終わる', () => {
    const teamOf = (id: number) => [0, 1, 0, 1][id];
    const scores = [score(0, 4), score(1, 3), score(2, 5), score(3, 2)];
    const totals = teamTotals(scores, teamOf);
    expect(totals.get(0)).toBe(9);
    expect(totals.get(1)).toBe(5);
    const m = new PvpMatch({ timeLimitSeconds: 300, scoreLimit: 10 }, teamOf);
    expect(m.step(DT, scores)).toBeNull();
    scores[2] = score(2, 6);
    expect(m.step(DT, scores)).toBe('score');
    // 個人戦なら 1 人が 10 機に届くまで終わらない
    const ffa = new PvpMatch({ timeLimitSeconds: 300, scoreLimit: 10 });
    expect(ffa.step(DT, scores)).toBeNull();
  });

  it('味方の機銃は当たらない（命中にも数えない）、敵の機銃は当たる', () => {
    const arena = new PvpArena(() => undefined, null, seeded(1));
    const a = [0, 1, 2].map(() => new Aircraft(KESTREL.flight));
    const f = a.map((x, i) => arena.add(i, x, SPEC));
    // 0 と 1 は同じチーム、2 は敵
    arena.setTeams(
      new Map([
        [0, 0],
        [1, 0],
        [2, 1],
      ]),
    );
    const shoot = (target: Aircraft): void => {
      for (let k = 0; k < 120; k++) {
        const p = target.state.position;
        a[0]?.respawn({ x: p.x, y: p.y, z: p.z + 200 }, target.state.orientation);
        arena.tick++;
        arena.stepFighter(0, controls({ fire: true }), DT, null);
        for (const id of [1, 2]) arena.stepFighter(id, controls(), DT, null);
        arena.endTick(DT);
      }
    };
    a[2]?.respawn({ x: 0, y: 1500, z: -20000 }, null);
    a[1]?.respawn({ x: 0, y: 1000, z: 0 }, null);
    shoot(a[1] as Aircraft);
    expect(f[1]?.hp).toBe(SPEC.maxHp);
    expect(f[0]?.hits).toBe(0);
    a[1]?.respawn({ x: 0, y: 1500, z: -20000 }, null);
    a[2]?.respawn({ x: 0, y: 1000, z: 0 }, null);
    shoot(a[2] as Aircraft);
    expect(f[0]?.hits).toBeGreaterThan(0);
    expect(f[2]?.hp).toBeLessThan(SPEC.maxHp);
  });

  it('味方のミサイルの信管・爆風は味方に反応しない', () => {
    const arena = new PvpArena(() => undefined, null, seeded(1));
    const a = [0, 1].map(() => new Aircraft(KESTREL.flight));
    const f = a.map((x, i) => arena.add(i, x, SPEC));
    arena.setTeams(
      new Map([
        [0, 0],
        [1, 0],
      ]),
    );
    expect(arena.missiles.isFriendly(f[1] as never, 0)).toBe(true);
    arena.setTeams(null);
    expect(arena.missiles.isFriendly(f[1] as never, 0)).toBe(false);
    expect(arena.missiles.isFriendly(f[0] as never, 0)).toBe(true);
  });
});

describe('初心者保護（ハンデ。5-4）', () => {
  it('撃墜数が最下位の人だけ。全員同じ（開始直後）なら誰も対象にしない', () => {
    expect(isRookie(0, [score(0, 0), score(1, 0)])).toBe(false);
    expect(isRookie(0, [score(0, 1), score(1, 3), score(2, 1)])).toBe(true);
    expect(isRookie(2, [score(0, 1), score(1, 3), score(2, 1)])).toBe(true);
    expect(isRookie(1, [score(0, 1), score(1, 3), score(2, 1)])).toBe(false);
    expect(isRookie(0, [score(0, 0)])).toBe(false);
  });

  it('設定が ON なら、最下位の人の復帰で HP +50%・ミサイル +2。次の復帰で最下位でなければ元に戻る', () => {
    const events: ArenaEvent[] = [];
    const arena = new PvpArena((e) => events.push({ ...e }), null, seeded(1));
    arena.rookieGuard = true;
    const a = [0, 1].map(() => new Aircraft(KESTREL.flight));
    const f = a.map((x, i) => arena.add(i, x, SPEC));
    const victim = f[1];
    const killer = f[0];
    if (!victim || !killer) throw new Error('fighters');
    killer.kills = 2;
    victim.applyDamage(9999);
    // 墜落と同じ扱いにするため、復帰のタイマーだけ始める
    victim.respawnTimer = PVP_CONFIG.respawnSeconds;
    for (let k = 0; k < PVP_CONFIG.respawnSeconds * 60 + 2; k++) {
      arena.tick++;
      arena.endTick(DT);
    }
    expect(victim.alive).toBe(true);
    expect(victim.boosted).toBe(true);
    expect(victim.maxHp).toBe(Math.round(SPEC.maxHp * 1.5));
    expect(victim.hp).toBe(victim.maxHp);
    expect(victim.missileAmmo.count).toBe(SPEC.missiles + 2);
    const respawn = events.find((e) => e.kind === 'respawn');
    expect((respawn?.b ?? 0) & RESPAWN_BOOST).toBe(RESPAWN_BOOST);
    // 撃墜数が並んだら次の復帰は普通
    victim.kills = 2;
    victim.invulnerableTimer = 0;
    victim.applyDamage(99999);
    victim.respawnTimer = PVP_CONFIG.respawnSeconds;
    for (let k = 0; k < PVP_CONFIG.respawnSeconds * 60 + 2; k++) {
      arena.tick++;
      arena.endTick(DT);
    }
    expect(victim.boosted).toBe(false);
    expect(victim.maxHp).toBe(SPEC.maxHp);
    expect(victim.missileAmmo.count).toBe(SPEC.missiles);
  });

  it('設定が OFF なら最下位でも普通に復帰する', () => {
    const arena = new PvpArena(() => undefined, null, seeded(1));
    const f = [0, 1].map((i) => arena.add(i, new Aircraft(KESTREL.flight), SPEC));
    const victim = f[1];
    if (!victim || !f[0]) throw new Error('fighters');
    f[0].kills = 3;
    victim.applyDamage(9999);
    victim.respawnTimer = PVP_CONFIG.respawnSeconds;
    for (let k = 0; k < PVP_CONFIG.respawnSeconds * 60 + 2; k++) {
      arena.tick++;
      arena.endTick(DT);
    }
    expect(victim.alive).toBe(true);
    expect(victim.maxHp).toBe(SPEC.maxHp);
  });
});

describe('リザルト・連続撃墜・カウントダウン（5-4）', () => {
  it('最長連続撃墜は撃墜されると途切れ、最大を残す', () => {
    const arena = new PvpArena(() => undefined, null, seeded(1));
    const a = [0, 1].map(() => new Aircraft(KESTREL.flight));
    const f = a.map((x, i) => arena.add(i, x, SPEC));
    const [hunter, prey] = f;
    if (!hunter || !prey) throw new Error('fighters');
    const kill = (shooter: typeof hunter, victim: typeof hunter): void => {
      // 機銃で撃墜させる（並べて撃つ）
      victim.invulnerableTimer = 0;
      if (!victim.alive) victim.revive(0);
      for (let k = 0; k < 600 && victim.alive; k++) {
        const p = victim.aircraft.state.position;
        shooter.aircraft.respawn(
          { x: p.x, y: p.y, z: p.z + 200 },
          victim.aircraft.state.orientation,
        );
        shooter.aircraft.state.speed = victim.aircraft.state.speed;
        arena.tick++;
        arena.stepFighter(shooter.id, controls({ fire: true }), DT, null);
        arena.stepFighter(victim.id, controls(), DT, null);
        arena.endTick(DT);
      }
      expect(victim.alive).toBe(false);
    };
    kill(hunter, prey);
    kill(hunter, prey);
    kill(hunter, prey);
    expect(hunter.streak).toBe(3);
    hunter.revive(0);
    prey.revive(0);
    kill(prey, hunter);
    expect(hunter.streak).toBe(0);
    expect(hunter.bestStreak).toBe(3);
    expect(prey.bestStreak).toBe(1);
  });

  it('ベストプレイヤーは最多撃墜（同じなら被撃墜の少ない方 → 命中率）。誰も撃墜していなければなし', () => {
    expect(bestPlayer([score(0, 0), score(1, 0)])).toBeNull();
    expect(bestPlayer([score(0, 3, 2), score(1, 5, 4), score(2, 1)])?.id).toBe(1);
    expect(bestPlayer([score(0, 3, 2), score(1, 3, 1)])?.id).toBe(1);
    expect(bestPlayer([score(0, 3, 1, 10, 1), score(1, 3, 1, 10, 5)])?.id).toBe(1);
  });

  it('カウントダウンは 3 秒（180 ステップ）で終わる', () => {
    const c = new Countdown(PVP_CONFIG.countdownSeconds);
    let n = 0;
    while (c.step()) n++;
    expect(n).toBe(180);
    expect(c.active).toBe(false);
    expect(c.remainingSeconds).toBe(0);
  });
});
