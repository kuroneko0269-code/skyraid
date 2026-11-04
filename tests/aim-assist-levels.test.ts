// 狙いの補助の強さ・自動射撃（9-3）: タッチの設定（弱・標準・強 / 自動射撃）、パッドは今のまま、ネット対戦の部屋の補正、
// 当たる範囲の判定、設定の読み込み、部屋の設定のビット、リプレイのヘッダ
import { describe, expect, it } from 'vitest';
import './i18n-setup';
import { autoFireReady } from '../src/combat/auto-fire';
import { createCombatInput } from '../src/combat/combat-input';
import { AssistControl, type NetAssistRules } from '../src/core/assist-control';
import type { AssistFlags } from '../src/core/assist-settings';
import { normalizeControls } from '../src/core/control-settings';
import type { InputDevice } from '../src/core/input';
import { createRandom } from '../src/core/random';
import { AIM_ASSIST_CONFIG, AIM_ASSIST_LEVEL_SPECS, type AimAssistLevel } from '../src/data/assist';
import { NET_CONFIG } from '../src/data/net';
import { createControls } from '../src/entities/aircraft';
import type { Vec3 } from '../src/flight/math';
import { FlightSession } from '../src/missions/flight-session';
import { ByteReader, ByteWriter } from '../src/net/codec';
import { readSettings, writeSettings } from '../src/net/codec-lobby';
import type { GameSettings } from '../src/net/protocol';
import { replayControls, type ReplayHeader } from '../src/replay/types';
import { optionsSummary } from '../src/ui/lobby-controls';
import { arenaForce } from './ai-sim';
import { DEG, IDENTITY } from './combat-helpers';

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

/** 機首（-Z）から右へ yawDeg ずれた dist m 先の点 */
function ahead(yawDeg: number, dist: number): Vec3 {
  return { x: Math.sin(yawDeg * DEG) * dist, y: 0, z: -Math.cos(yawDeg * DEG) * dist };
}

function setup(
  device: InputDevice,
  level: AimAssistLevel = 'normal',
  autoFire = true,
  net: NetAssistRules | null = null,
) {
  const s = new FlightSession({ rng: createRandom(3), enemies: arenaForce(1, 600) });
  s.configureEnemies(true, 'easy', 1);
  s.reset();
  const flags: AssistFlags = { aim: true, camera: true, hud: true };
  const control = new AssistControl(
    s,
    flags,
    () => device,
    () => ({ aimAssist: level, autoFire }),
  );
  control.netRules = () => net;
  return { s, control };
}

describe('狙いの補助の強さ（タッチだけ）', () => {
  it('タッチは設定の強さ（標準 = 円錐 15°・補正 0.5・1.5° で最大、弱 = 4-12 の値）、パッドは弱のまま', () => {
    expect(AIM_ASSIST_LEVEL_SPECS.normal).toMatchObject({
      coneDeg: 15,
      maxCorrection: 0.5,
      fullCorrectionDeg: 1.5,
    });
    expect(AIM_ASSIST_LEVEL_SPECS.weak).toBe(AIM_ASSIST_CONFIG);
    for (const level of ['weak', 'normal', 'strong'] as const) {
      expect(setup('touch', level).control.spec).toBe(AIM_ASSIST_LEVEL_SPECS[level]);
      expect(setup('gamepad', level).control.spec).toBe(AIM_ASSIST_CONFIG);
    }
  });

  it('判定の拡大はどの強さでも同じ（1.3 倍）', () => {
    for (const level of ['weak', 'normal', 'strong'] as const)
      expect(AIM_ASSIST_LEVEL_SPECS[level].gunHitRadiusScale).toBe(
        AIM_ASSIST_CONFIG.gunHitRadiusScale,
      );
  });

  it('標準は弱より遠く（12°）の敵にも効き、機首の近く（1°）で強く補正する', () => {
    const correction = (level: AimAssistLevel, deg: number): number => {
      const { s, control } = setup('touch', level);
      const target = s.enemies[0];
      if (!target) throw new Error('敵機がいない');
      const st = s.aircraft.state;
      st.position.x = st.position.y = st.position.z = 0;
      Object.assign(st.orientation, IDENTITY);
      Object.assign(target.position, ahead(deg, 2000));
      s.combat.targeting.select(target);
      s.combat.leadValid = false;
      const c = createControls();
      c.roll = 0.5;
      control.apply(c);
      return c.yaw;
    };
    expect(correction('weak', 12)).toBe(0);
    expect(correction('normal', 12)).toBeGreaterThan(0);
    expect(correction('normal', 1)).toBeGreaterThan(correction('weak', 1) * 2);
  });

  it('ネット対戦で部屋の補正が OFF なら弱（今の PvP と同じ）', () => {
    const off = setup('touch', 'strong', true, { aimAssist: false, autoFire: false });
    expect(off.control.spec).toBe(AIM_ASSIST_CONFIG);
    const on = setup('touch', 'strong', true, { aimAssist: true, autoFire: false });
    expect(on.control.spec).toBe(AIM_ASSIST_LEVEL_SPECS.strong);
  });
});

describe('自動射撃', () => {
  it('当たる範囲（的の半径 × 判定の拡大 / 距離）の中で、予測照準点が有効なときだけ', () => {
    const t = { active: true, hitRadius: 6 };
    // 600m 先で半径 7.8m → 約 0.74°
    expect(autoFireReady(t, ahead(0.5, 600), true, ORIGIN, IDENTITY, 1.3)).toBe(true);
    expect(autoFireReady(t, ahead(1, 600), true, ORIGIN, IDENTITY, 1.3)).toBe(false);
    expect(autoFireReady(t, ahead(0.5, 600), false, ORIGIN, IDENTITY, 1.3)).toBe(false);
    expect(autoFireReady({ ...t, active: false }, ahead(0, 600), true, ORIGIN, IDENTITY, 1.3)).toBe(
      false,
    );
    // 後ろ
    expect(autoFireReady(t, { x: 0, y: 0, z: 600 }, true, ORIGIN, IDENTITY, 1.3)).toBe(false);
    expect(autoFireReady(null, ahead(0, 600), true, ORIGIN, IDENTITY, 1.3)).toBe(false);
  });

  function fireWith(device: InputDevice, autoFire: boolean, net: NetAssistRules | null): boolean {
    const { s, control } = setup(device, 'normal', autoFire, net);
    const target = s.enemies[0];
    if (!target) throw new Error('敵機がいない');
    const st = s.aircraft.state;
    st.position.x = st.position.y = st.position.z = 0;
    Object.assign(st.orientation, IDENTITY);
    s.combat.targeting.select(target);
    Object.assign(s.combat.lead, ahead(0.2, 500));
    s.combat.leadValid = true;
    control.apply(createControls());
    const input = createCombatInput();
    control.applyFire(input);
    return input.trigger;
  }

  it('タッチで ON なら撃つ。OFF・パッド・キーボード・部屋の補正 OFF なら撃たない', () => {
    expect(fireWith('touch', true, null)).toBe(true);
    expect(fireWith('touch', false, null)).toBe(false);
    expect(fireWith('gamepad', true, null)).toBe(false);
    expect(fireWith('keyboard', true, null)).toBe(false);
    expect(fireWith('touch', true, { aimAssist: true, autoFire: false })).toBe(false);
    expect(fireWith('touch', true, { aimAssist: false, autoFire: true })).toBe(true);
  });

  it('射撃ボタンで撃っていればそのまま', () => {
    const { control } = setup('touch', 'normal', true);
    const input = createCombatInput();
    input.trigger = true;
    control.applyFire(input);
    expect(input.trigger).toBe(true);
  });
});

describe('設定の読み込み（settings.controls）', () => {
  it('無い（9-2 までのセーブ）・不正なら標準・自動射撃 ON、正しい値はそのまま', () => {
    expect(normalizeControls({})).toMatchObject({ aimAssist: 'normal', autoFire: true });
    expect(normalizeControls({ aimAssist: 'max', autoFire: 'yes' })).toMatchObject({
      aimAssist: 'normal',
      autoFire: true,
    });
    expect(normalizeControls({ aimAssist: 'weak', autoFire: false })).toMatchObject({
      aimAssist: 'weak',
      autoFire: false,
    });
  });
});

describe('ネット対戦の部屋の補正（ロビー）', () => {
  const base: GameSettings = { ...NET_CONFIG.defaultSettings };

  it('既定は OFF（今の PvP と同じ）', () => {
    expect([base.aimAssist, base.autoFire]).toEqual([false, false]);
  });

  it('設定のビットに入って、読み書きで戻る', () => {
    for (const [aimAssist, autoFire] of [
      [true, false],
      [false, true],
      [true, true],
      [false, false],
    ] as const) {
      const s: GameSettings = { ...base, mode: 'team', hard: true, aimAssist, autoFire };
      const w = new ByteWriter();
      writeSettings(w, s);
      expect(readSettings(new ByteReader(w.finish()))).toEqual(s);
    }
  });

  it('補正の 1 行: 個人戦・チーム戦は狙いの補助・自動射撃も出す（協力は出さない）', () => {
    const ffa = optionsSummary({ ...base, aimAssist: true });
    expect(ffa).toContain('狙いの補助 ON');
    expect(ffa).toContain('自動射撃 OFF');
    expect(optionsSummary({ ...base, mode: 'raid' })).not.toContain('狙いの補助');
  });
});

describe('リプレイのヘッダ（操作の設定）', () => {
  const controls = {
    device: 'touch',
    steerMode: 'direct',
    stickCurve: 1.5,
    stickPosition: 'floating',
    sensitivity: 1,
    deadzone: 0.12,
  };
  const header = (c: object): ReplayHeader => ({ controls: c }) as unknown as ReplayHeader;

  it('狙いの補助・自動射撃は無くても読める（9-2 の記録）・あれば型を確かめる', () => {
    expect(replayControls(header(controls))).not.toBeNull();
    expect(replayControls(header({ ...controls, aimAssist: 'strong', autoFire: false }))).not.toBe(
      null,
    );
    expect(replayControls(header({ ...controls, aimAssist: 3 }))).toBeNull();
    expect(replayControls(header({ ...controls, autoFire: 'on' }))).toBeNull();
  });
});
