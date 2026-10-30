// 1 ステップ分の操作の量子化と読み書き（5-1）。自機の先行計算もホストも「量子化した後の値」で計算するので、
// 両者の結果が一致する。Three.js 非依存
import { ByteReader, ByteWriter, packAxis, packUnit, unpackAxis, unpackUnit } from './codec';

const FLAG_AFTERBURNER = 1;
const FLAG_AUTO_LEVEL = 2;
const FLAG_INVERT = 4;

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
  };
}

export function writeControls(w: ByteWriter, c: Readonly<NetControls>): void {
  w.i8(packAxis(c.pitch)).i8(packAxis(c.roll)).i8(packAxis(c.yaw)).i8(packAxis(c.throttle));
  w.u8(packUnit(c.throttleTarget));
  w.u8(
    (c.afterburner ? FLAG_AFTERBURNER : 0) |
      (c.autoLevel ? FLAG_AUTO_LEVEL : 0) |
      (c.invertPitch ? FLAG_INVERT : 0),
  );
}

export function readControls(r: ByteReader): NetControls {
  const pitch = unpackAxis(r.i8());
  const roll = unpackAxis(r.i8());
  const yaw = unpackAxis(r.i8());
  const throttle = unpackAxis(r.i8());
  const throttleTarget = unpackUnit(r.u8());
  const flags = r.u8();
  return {
    pitch,
    roll,
    yaw,
    throttle,
    throttleTarget,
    afterburner: (flags & FLAG_AFTERBURNER) !== 0,
    autoLevel: (flags & FLAG_AUTO_LEVEL) !== 0,
    invertPitch: (flags & FLAG_INVERT) !== 0,
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
  return out;
}
