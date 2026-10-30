import { FLIGHT_CONFIG } from '../data/flight';

export interface FlightControlOptions {
  autoLevel: boolean;
  invertPitch: boolean;
}

const OFF_VALUES = ['0', 'off', 'false'];

/**
 * URL のクエリで指定された操作設定だけを返す（4-11: 設定画面の値より優先する。指定のない項目は入らない）
 */
export function parseFlightOverrides(search: string): Partial<FlightControlOptions> {
  const params = new URLSearchParams(search);
  const out: Partial<FlightControlOptions> = {};
  const autoLevel = params.get('autolevel');
  const invert = params.get('invert');
  if (autoLevel !== null) out.autoLevel = readBool(autoLevel, true);
  if (invert !== null) out.invertPitch = readBool(invert, true);
  return out;
}

/**
 * URL のクエリから操作設定を読む（4-10 までは設定画面の代わり。4-11 からは設定画面の値を URL が上書きする）。
 * - ?autolevel=off（0 / false も可）でオートレベル OFF
 * - ?invert（値なし、または 1 / on / true）でピッチ反転（W = 機首上げ）
 */
export function parseFlightOptions(search: string): FlightControlOptions {
  const params = new URLSearchParams(search);
  const defaults = FLIGHT_CONFIG.defaults;
  return {
    autoLevel: readBool(params.get('autolevel'), defaults.autoLevel),
    invertPitch: readBool(params.get('invert'), defaults.invertPitch),
  };
}

function readBool(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return !OFF_VALUES.includes(value.toLowerCase());
}
