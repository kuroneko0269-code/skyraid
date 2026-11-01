// 7-B の事前修正: 協力（レイド・防衛戦）では味方プレイヤーを索敵・ロックの対象にしない
import { describe, expect, it } from 'vitest';
import { createCombatInput } from '../src/combat/combat-input';
import type { PvpMode } from '../src/data/pvp';
import { FlightSession } from '../src/missions/flight-session';
import { isCoopMode, sameSide } from '../src/net/lobby-rules';
import { PvpMirror } from '../src/net/pvp-mirror';
import type { PlayerInfo } from '../src/net/protocol';
import { TEST_PAINT } from './net-helpers';

function player(id: number, team = 0): PlayerInfo {
  return {
    id,
    name: `P${id}`,
    aircraftId: 'kestrel',
    paint: TEST_PAINT,
    maxHp: 100,
    team,
    ready: true,
    again: true,
    away: false,
  };
}

/** 自機の真正面 800m に他プレイヤーを置いて、索敵を数ステップ回す。ロックできたか */
function locksAlly(mode: PvpMode): boolean {
  const session = new FlightSession({ flightOptions: { autoLevel: false } });
  session.startMission({ x: 0, y: 1000, z: 0, headingDeg: 0 });
  const mirror = new PvpMirror(session, 0);
  mirror.syncRoster([player(0), player(1)], undefined, isCoopMode(mode));
  const rival = mirror.rivals.get(1);
  if (!rival) throw new Error('rival missing');
  rival.active = true;
  const p = session.aircraft.state.position;
  rival.position.x = p.x;
  rival.position.y = p.y;
  rival.position.z = p.z - 800;
  const input = createCombatInput();
  for (let i = 0; i < 240; i++) mirror.stepLocal(input, 1 / 60);
  return session.combat.targeting.selected === rival;
}

describe('協力モードの味方判定', () => {
  it('レイドと防衛戦は協力モード（PvP・チーム戦は違う）', () => {
    expect(isCoopMode('raid')).toBe(true);
    expect(isCoopMode('defense')).toBe(true);
    expect(isCoopMode('team')).toBe(false);
    expect(isCoopMode('ffa')).toBe(false);
    expect(sameSide(1, 2, 'raid', () => undefined)).toBe(true);
  });

  it('協力レイドでは他プレイヤーをロックしない（防衛戦と同じ）', () => {
    expect(locksAlly('raid')).toBe(false);
    expect(locksAlly('defense')).toBe(false);
  });
});

describe('修正前の再現', () => {
  it('味方扱いにしないと正面の他プレイヤーをロックする', () => {
    expect(locksAlly('ffa')).toBe(true);
  });
});
