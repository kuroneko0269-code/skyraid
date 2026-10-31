// 1 ステップ分の操作の量子化と読み書き（5-1）。自機の先行計算もホストも「量子化した後の値」で計算するので、
// 両者の結果が一致する。Three.js 非依存
import { ByteReader, ByteWriter, packAxis, packUnit, unpackAxis, unpackUnit } from './codec';

const FLAG_AFTERBURNER = 1;
const FLAG_AUTO_LEVEL = 2;
const FLAG_INVERT = 4;
// 戦闘（5-3）。fire は押している間、missile / flare / targetNext は押したステップだけ、locked はロック完了中
const FLAG_FIRE = 8;
const FLAG_MISSILE = 16;
const FLAG_FLARE = 32;
const FLAG_TARGET_NEXT = 64;
const FLAG_LOCKED = 128;
/** targetId の「なし」 */
export const NO_TARGET = 255;

/** 1 ステップ分の操作（量子化済み）。AircraftControls と同じ意味 + 飛行の設定（ホストが同じ設定で計算する） */
export interface NetControls {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  throttleTarget: number | null;
  afterburner: boolean;
  autoLevel: boolean;
  invertPitch: boolean;
  /** 戦闘の操作（5-3） */
  fire: boolean;
  missile: boolean;
  flare: boolean;
  targetNext: boolean;
  /** クライアントのロックオンが完了しているか（ホストは信頼せず円錐を見直す） */
  locked: boolean;
  /** 選んでいる対象のプレイヤー ID（NO_TARGET はなし） */
  targetId: number;
}

export function createNetControls(): NetControls {
  return {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0,
    throttleTarget: null,
    afterburner: false,
    autoLevel: false,
    invertPitch: false,
    fire: false,
    missile: false,
    flare: false,
    targetNext: false,
    locked: false,
    targetId: NO_TARGET,
  };
}

/** 推測で埋めるステップ（入力が届かなかった）: 押した瞬間だけの操作は繰り返さない */
export function clearPresses(c: NetControls): void {
  c.missile = false;
  c.flare = false;
  c.targetNext = false;
}

export function writeControls(w: ByteWriter, c: Readonly<NetControls>): void {
  w.i8(packAxis(c.pitch)).i8(packAxis(c.roll)).i8(packAxis(c.yaw)).i8(packAxis(c.throttle));
  w.u8(packUnit(c.throttleTarget));
  w.u8(
    (c.afterburner ? FLAG_AFTERBURNER : 0) |
      (c.autoLevel ? FLAG_AUTO_LEVEL : 0) |
      (c.invertPitch ? FLAG_INVERT : 0) |
      (c.fire ? FLAG_FIRE : 0) |
      (c.missile ? FLAG_MISSILE : 0) |
      (c.flare ? FLAG_FLARE : 0) |
      (c.targetNext ? FLAG_TARGET_NEXT : 0) |
      (c.locked ? FLAG_LOCKED : 0),
  );
  w.u8(c.targetId);
}

export function readControls(r: ByteReader): NetControls {
  const pitch = unpackAxis(r.i8());
  const roll = unpackAxis(r.i8());
  const yaw = unpackAxis(r.i8());
  const throttle = unpackAxis(r.i8());
  const throttleTarget = unpackUnit(r.u8());
  const flags = r.u8();
  const targetId = r.u8();
  return {
    pitch,
    roll,
    yaw,
    throttle,
    throttleTarget,
    afterburner: (flags & FLAG_AFTERBURNER) !== 0,
    autoLevel: (flags & FLAG_AUTO_LEVEL) !== 0,
    invertPitch: (flags & FLAG_INVERT) !== 0,
    fire: (flags & FLAG_FIRE) !== 0,
    missile: (flags & FLAG_MISSILE) !== 0,
    flare: (flags & FLAG_FLARE) !== 0,
    targetNext: (flags & FLAG_TARGET_NEXT) !== 0,
    locked: (flags & FLAG_LOCKED) !== 0,
    targetId,
  };
}

/**
 * 操作を通信と同じ値に丸めて out に書く（自機の先行計算もこの値で飛ぶので、ホストの計算と一致する）
 */
export function quantizeControls(out: NetControls, c: Readonly<NetControls>): NetControls {
  out.pitch = unpackAxis(packAxis(c.pitch));
  out.roll = unpackAxis(packAxis(c.roll));
  out.yaw = unpackAxis(packAxis(c.yaw));
  out.throttle = unpackAxis(packAxis(c.throttle));
  out.throttleTarget = unpackUnit(packUnit(c.throttleTarget));
  out.afterburner = c.afterburner;
  out.autoLevel = c.autoLevel;
  out.invertPitch = c.invertPitch;
  out.fire = c.fire;
  out.missile = c.missile;
  out.flare = c.flare;
  out.targetNext = c.targetNext;
  out.locked = c.locked;
  out.targetId = c.targetId;
  return out;
}
