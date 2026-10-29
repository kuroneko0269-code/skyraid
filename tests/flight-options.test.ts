import { describe, expect, it } from 'vitest';
import { parseFlightOptions } from '../src/core/flight-options';

describe('parseFlightOptions', () => {
  it('既定はオートレベル ON・ピッチ反転なし', () => {
    expect(parseFlightOptions('')).toEqual({ autoLevel: true, invertPitch: false });
    expect(parseFlightOptions('?debug=input')).toEqual({ autoLevel: true, invertPitch: false });
  });

  it('?autolevel=off と ?invert で切り替わる', () => {
    expect(parseFlightOptions('?autolevel=off&invert')).toEqual({
      autoLevel: false,
      invertPitch: true,
    });
    expect(parseFlightOptions('?autolevel=0&invert=false')).toEqual({
      autoLevel: false,
      invertPitch: false,
    });
  });
});
