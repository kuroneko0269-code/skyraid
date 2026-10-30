// 機体と強化 → 飛行モデル・HP・武装のパラメータ（3-3 / 3-4、Three.js 非依存）。
// 数値の掛け合わせはここに集約する: 機体の倍率（AircraftModel.stats）× 強化（1 + 効果 × Lv）を
// Kestrel（STARTER_AIRCRAFT と初期の武装）の値に掛ける。Kestrel の Lv0 は元の値と完全に一致する
import {
  STARTER_AIRCRAFT,
  type AircraftModel,
  type AircraftSpec,
  type AircraftStats,
} from '../data/aircraft';
import { BOMB_CONFIG, ROCKET_CONFIG } from '../data/ordnance';
import { UPGRADE_EFFECTS } from '../data/upgrades';
import { FLARE_CONFIG, GUN_CONFIG, MISSILE_CONFIG, TARGETING_CONFIG } from '../data/weapons';
import type { TargetingSpec } from '../data/weapons';
import type { UpgradeLevels } from './save';

/** 飛行 1 回分のプレイヤー機の装備（FlightSession.applyLoadout に渡す） */
export interface Loadout {
  readonly aircraftId: string;
  /** 飛行モデルと HP（hull.maxHp） */
  readonly flight: AircraftSpec;
  /** 機銃 1 発のダメージ */
  readonly gunDamage: number;
  readonly missiles: number;
  /** ロケットの発数（ROCKET_CONFIG.perSalvo の倍数） */
  readonly rockets: number;
  readonly bombs: number;
  readonly flares: number;
  readonly targeting: TargetingSpec;
}

const BASE = STARTER_AIRCRAFT;

/** 機体の倍率と強化 Lv から装備を作る */
export function resolveLoadout(model: AircraftModel, levels: Readonly<UpgradeLevels>): Loadout {
  const st = model.stats;
  const e = UPGRADE_EFFECTS;
  const topSpeed = st.speed * (1 + e.engine.topSpeed * levels.engine);
  const accel = st.speed * (1 + e.engine.accel * levels.engine);
  const turn = st.turn * (1 + e.airframe.turn * levels.airframe);
  const hp = st.durability * (1 + e.airframe.hp * levels.airframe);
  const abDuration = 1 + e.engine.afterburnerDuration * levels.engine;
  const s = BASE.speed;
  const flight: AircraftSpec = {
    ...BASE,
    id: model.id,
    name: model.name,
    speed: {
      ...s,
      military: s.military * topSpeed,
      afterburner: s.afterburner * topSpeed,
      limit: s.limit * topSpeed,
      maxAccel: s.maxAccel * accel,
      afterburnerMaxAccel: s.afterburnerMaxAccel * accel,
    },
    rates: {
      ...BASE.rates,
      pitch: BASE.rates.pitch * turn,
      roll: BASE.rates.roll * turn,
      yaw: BASE.rates.yaw * turn,
    },
    // 巡航より上（旋回が鈍り始める高速側）の折れ線を最高速に合わせて伸ばす。低速側（失速まわり）はそのまま
    turnCurve: BASE.turnCurve.map((p) =>
      p.speed > s.cruise ? { speed: p.speed * topSpeed, factor: p.factor } : p,
    ),
    hull: { ...BASE.hull, maxHp: Math.round(BASE.hull.maxHp * hp) },
    afterburner: {
      ...BASE.afterburner,
      durationSeconds: BASE.afterburner.durationSeconds * abDuration,
    },
  };
  const t = TARGETING_CONFIG;
  const sensor = 1 + e.avionics.sensorRange * levels.avionics;
  const counts = payloadCounts(st.payload);
  return {
    aircraftId: model.id,
    flight,
    gunDamage: GUN_CONFIG.damage * (1 + e.weapons.gunDamage * levels.weapons),
    missiles: counts.missiles + e.weapons.missiles * levels.weapons,
    rockets: counts.rockets,
    bombs: counts.bombs,
    flares: counts.flares + e.avionics.flares * levels.avionics,
    targeting: {
      ...t,
      sensorRange: t.sensorRange * sensor,
      keepRange: t.keepRange * sensor,
      lockSeconds: t.lockSeconds * (1 + e.avionics.lockTime * levels.avionics),
    },
  };
}

/** 積載の倍率 → 搭載数（強化前）。Kestrel の数（4 / 12 / 4 / 6）に掛けて四捨五入。ロケットは斉射の数で丸める */
export function payloadCounts(payload: number): {
  missiles: number;
  rockets: number;
  bombs: number;
  flares: number;
} {
  const salvo = ROCKET_CONFIG.perSalvo;
  return {
    missiles: Math.round(MISSILE_CONFIG.ammo * payload),
    rockets: Math.round((ROCKET_CONFIG.ammo / salvo) * payload) * salvo,
    bombs: Math.round(BOMB_CONFIG.ammo * payload),
    flares: Math.round(FLARE_CONFIG.charges * payload),
  };
}

/**
 * ハンガーのバーに出す 4 パラメータの実数値: 速度 = 最高速（m/s）/ 旋回 = ピッチの最大角速度（度/秒）/
 * 耐久 = HP / 積載 = 搭載数を Kestrel の数で割って平均した値（Kestrel = 1）
 */
export function loadoutStats(l: Loadout): AircraftStats {
  const salvo = ROCKET_CONFIG.perSalvo;
  const payload =
    (l.missiles / MISSILE_CONFIG.ammo +
      l.rockets / salvo / (ROCKET_CONFIG.ammo / salvo) +
      l.bombs / BOMB_CONFIG.ammo +
      l.flares / FLARE_CONFIG.charges) /
    4;
  return {
    speed: l.flight.speed.afterburner,
    turn: l.flight.rates.pitch,
    durability: l.flight.hull.maxHp,
    payload,
  };
}
