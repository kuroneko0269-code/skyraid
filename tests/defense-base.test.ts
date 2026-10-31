// 防衛戦（7-2）の基地: 司令部の HP と失敗、施設は味方、壊れたときの不利（レーダー: 予告なし / 対空砲: 支援なし / 燃料タンク: 補給が半分）、
// 味方の対空砲は敵だけを撃つ、港湾都市の基地
import { describe, expect, it } from 'vitest';
import { TEAM_PLAYER } from '../src/combat/target';
import { BOMBER_CONFIG, findDefenseMap } from '../src/data/defense';
import { DT, runDefense, startDefenseSim } from './defense-bots';

describe('基地', () => {
  it('司令部の HP は通常 2000・高難度 1500。HP 0 で失敗', () => {
    expect(startDefenseSim().defense.base.hq.maxHp).toBe(2000);
    const sim = startDefenseSim({ difficulty: 'hard' });
    const d = sim.defense;
    expect(d.base.hq.maxHp).toBe(1500);
    let ended: string | null = null;
    d.bus.on('defense:end', ({ outcome }) => (ended = outcome));
    d.base.damage(
      0,
      1500,
      () => undefined,
      () => undefined,
    );
    d.step(DT, []);
    expect(d.phase).toBe('failed');
    expect(ended).toBe('failed');
  });

  it('施設は味方（自機の弾は当たらない対象の外）。レーダーを失うと予告が消える', () => {
    const sim = startDefenseSim();
    const d = sim.defense;
    const s = sim.play.session;
    for (const g of s.props.baseTargets) {
      expect(g.team).toBe(TEAM_PLAYER);
      expect(s.combat.allTargets).not.toContain(g);
    }
    expect(d.forecast).toMatch(/から /);
    d.base.damage(
      1,
      10000,
      () => undefined,
      () => undefined,
    );
    expect(d.forecast).toBeNull();
  });

  it('味方の対空砲は射程内の敵を撃ち、自機は撃たない。壊れると撃たない', () => {
    const sim = startDefenseSim();
    const d = sim.defense;
    const s = sim.play.session;
    const aaa = s.props.friendlyAaa;
    const b = s.props.bombers[0];
    if (!b) throw new Error('bomber');
    const site = d.base.site('aaa1');
    if (!site) throw new Error('aaa');
    // 自機だけが射程内: 撃たない
    s.aircraft.respawn(
      { x: site.base.x + 1200, y: 600, z: site.base.z },
      { x: 0, y: 0, z: 0, w: 1 },
    );
    for (let i = 0; i < 4 * 60; i++) d.step(DT, []);
    expect(aaa.shotCount).toBe(0);
    // 爆撃機が射程内を通る: 撃って当てる
    b.attack(
      { x: site.base.x + 2400, y: BOMBER_CONFIG.altitude, z: site.base.z + 300 },
      { x: site.base.x - 3000, y: 0, z: site.base.z + 300 },
      1,
      0,
      1,
    );
    for (let i = 0; i < 20 * 60 && b.active; i++) d.step(DT, []);
    expect(aaa.shotCount).toBeGreaterThan(0);
    expect(b.hp).toBeLessThan(b.maxHp);
    // 対空砲を全部壊すと撃たない
    d.base.damage(
      3,
      10000,
      () => undefined,
      () => undefined,
    );
    d.base.damage(
      4,
      10000,
      () => undefined,
      () => undefined,
    );
    const shots = aaa.shotCount;
    b.attack(
      { x: site.base.x + 2400, y: BOMBER_CONFIG.altitude, z: site.base.z },
      { x: site.base.x - 3000, y: 0, z: site.base.z },
      1,
      0,
      1,
    );
    for (let i = 0; i < 10 * 60; i++) d.step(DT, []);
    expect(aaa.shotCount).toBe(shots);
  });

  it('燃料タンクを失うと補給が半分（切り上げ）', () => {
    const sim = startDefenseSim();
    const { defense: d, play } = sim;
    const s = play.session;
    d.base.damage(
      2,
      10000,
      () => undefined,
      () => undefined,
    );
    expect(d.base.alive('fuel')).toBe(false);
    const fractions: number[] = [];
    d.bus.on('defense:supply', ({ fraction }) => fractions.push(fraction));
    while (s.combat.missileAmmo.tryUse()) s.combat.missileAmmo.step(1);
    const c = d.map.center;
    s.aircraft.respawn(
      { x: c.x, y: 200 + Math.max(0, sim.map.ground(c.x, c.z)), z: c.z },
      { x: 0, y: 0, z: 0, w: 1 },
    );
    s.aircraft.state.speed = 120;
    play.step(
      { pitch: 0, roll: 0, yaw: 0, throttle: 0.2, afterburner: false },
      {
        trigger: false,
        missile: false,
        flare: false,
        targetNext: false,
        rocket: false,
        bomb: false,
        bombHeld: false,
      },
      DT,
    );
    expect(fractions).toEqual([0.5]);
    expect(s.combat.missileAmmo.count).toBe(Math.ceil(s.combat.missileAmmo.capacity / 2));
  });

  it('港湾都市でも基地が立ち、波が始まる', () => {
    const sim = startDefenseSim({ mapId: 'harbor' });
    expect(sim.defense.map).toBe(findDefenseMap('harbor'));
    expect(sim.defense.base.facilitiesAlive).toBe(4);
    sim.defense.skip();
    runDefense(sim, 30);
    expect(sim.defense.phase).toBe('wave');
  });
});
