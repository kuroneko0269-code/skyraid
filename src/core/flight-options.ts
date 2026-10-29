import { FLIGHT_CONFIG } from '../data/flight';

export interface FlightControlOptions {
  autoLevel: boolean;
  invertPitch: boolean;
}

const OFF_VALUES = ['0', 'off', 'false'];

/**
 * URL のクエリから操作設定を読む（設定画面ができるまでの暫定）。
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
