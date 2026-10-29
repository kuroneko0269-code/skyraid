import { describe, expect, it } from 'vitest';
import { STARTER_AIRCRAFT } from '../src/data/aircraft';
import { FLIGHT_CONFIG } from '../src/data/flight';
import {
  FlightModel,
  cruiseThrottle,
  turnFactor,
  type FlightInput,
} from '../src/flight/flight-model';
import { copyQuat, quatFromRotationVector, quatIdentity } from '../src/flight/math';

const DT = 1 / 60;
const DEG = Math.PI / 180;

function input(overrides: Partial<FlightInput> = {}): FlightInput {
  return {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: cruiseThrottle(STARTER_AIRCRAFT),
    afterburner: false,
    ...overrides,
  };
}

function run(model: FlightModel, inp: FlightInput, seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) model.step(inp, DT);
}

/** 機首を pitchDeg だけ上げた姿勢にする */
function setPitch(model: FlightModel, pitchDeg: number): void {
  copyQuat(model.state.orientation, quatFromRotationVector(quatIdentity(), pitchDeg * DEG, 0, 0));
}

describe('速度', () => {
  it('巡航スロットルの水平飛行では巡航速度を保つ', () => {
    const m = new FlightModel(STARTER_AIRCRAFT);
    run(m, input(), 10);
    expect(m.state.speed).toBeCloseTo(STARTER_AIRCRAFT.speed.cruise, 3);
    expect(m.state.position.y).toBeCloseTo(FLIGHT_CONFIG.spawn.position.y, 3);
  });

  it('上昇で減速し、降下で加速する', () => {
    const climb = new FlightModel(STARTER_AIRCRAFT);
    setPitch(climb, 30);
    const dive = new FlightModel(STARTER_AIRCRAFT);
    setPitch(dive, -30);
    run(climb, input(), 2);
    run(dive, input(), 2);
    expect(climb.state.speed).toBeLessThan(STARTER_AIRCRAFT.speed.cruise - 20);
    expect(dive.state.speed).toBeGreaterThan(STARTER_AIRCRAFT.speed.cruise + 20);
  });

  it('巡航スロットルの垂直上昇は必ず失速に至る', () => {
    const m = new FlightModel(STARTER_AIRCRAFT);
    setPitch(m, 89);
    let stalled = false;
    for (let i = 0; i < 60 * 20 && !stalled; i++) {
      m.step(input(), DT);
      stalled = m.state.stall > 0.5;
    }
    expect(stalled).toBe(true);
  });
});

describe('速度と旋回率', () => {
  it('係数は低速で小さく、中速で最大、超高速で再び小さい', () => {
    const curve = STARTER_AIRCRAFT.turnCurve;
    const slow = turnFactor(curve, STARTER_AIRCRAFT.speed.stall);
    const cruise = turnFactor(curve, STARTER_AIRCRAFT.speed.cruise);
    const fast = turnFactor(curve, STARTER_AIRCRAFT.speed.afterburner);
    expect(cruise).toBe(1);
    expect(slow).toBeLessThan(cruise * 0.5);
    expect(fast).toBeLessThan(cruise);
    expect(fast).toBeGreaterThan(slow);
  });

  it('折れ線の間は線形補間、範囲外は端の値', () => {
    const curve = [
      { speed: 100, factor: 0.5 },
      { speed: 200, factor: 1 },
    ];
    expect(turnFactor(curve, 150)).toBeCloseTo(0.75);
    expect(turnFactor(curve, 0)).toBe(0.5);
    expect(turnFactor(curve, 999)).toBe(1);
  });

  it('同じ入力でも実際のピッチ角速度は速度で変わる', () => {
    const rateAt = (speed: number): number => {
      const m = new FlightModel(STARTER_AIRCRAFT);
      m.state.speed = speed;
      // 角速度が立ち上がるまで 0.5 秒（速度は少し変わるが大小関係は保たれる）
      run(m, input({ pitch: 1, throttle: 1 }), 0.5);
      return m.state.angularRate.x / DEG;
    };
    const slow = rateAt(110);
    const cruise = rateAt(250);
    const fast = rateAt(420);
    expect(cruise).toBeGreaterThan(slow);
    expect(cruise).toBeGreaterThan(fast);
    expect(cruise).toBeGreaterThan(STARTER_AIRCRAFT.rates.pitch * 0.9);
  });

  it('バンクして引くと、高度をあまり変えずに向きが変わる', () => {
    const m = new FlightModel(STARTER_AIRCRAFT, { autoLevel: false });
    while (m.bankAngle() < 80) m.step(input({ roll: 1 }), DT);
    const y0 = m.state.position.y;
    run(m, input({ pitch: 1 }), 1);
    // 右バンクで引くと右（+X）へ曲がる
    expect(m.state.position.x).toBeGreaterThan(50);
    expect(Math.abs(m.state.position.y - y0)).toBeLessThan(60);
  });

  it('ピッチ反転オプションで入力の向きが逆になる', () => {
    const normal = new FlightModel(STARTER_AIRCRAFT);
    const inverted = new FlightModel(STARTER_AIRCRAFT, { invertPitch: true });
    run(normal, input({ pitch: 1 }), 0.5);
    run(inverted, input({ pitch: 1 }), 0.5);
    expect(normal.pitchAngle()).toBeGreaterThan(10);
    expect(inverted.pitchAngle()).toBeLessThan(-10);
  });
});

describe('失速', () => {
  it('最低速度を下回ると失速し、機首が下がる', () => {
    const m = new FlightModel(STARTER_AIRCRAFT);
    m.state.speed = STARTER_AIRCRAFT.speed.stall - FLIGHT_CONFIG.stall.range;
    setPitch(m, 20);
    m.step(input({ throttle: 0 }), DT);
    expect(m.state.stall).toBeGreaterThan(0.9);
    run(m, input({ throttle: 0 }), 1);
    expect(m.pitchAngle()).toBeLessThan(0);
  });

  it('失速中は操舵が効きにくい', () => {
    const rateAt = (speed: number): number => {
      const m = new FlightModel(STARTER_AIRCRAFT);
      m.state.speed = speed;
      m.step(input({ roll: 1 }), DT);
      return Math.abs(m.state.angularRate.z);
    };
    const stall = STARTER_AIRCRAFT.speed.stall;
    // ロールは速度の影響が小さいので、失速の効果がそのまま出る
    expect(rateAt(stall - FLIGHT_CONFIG.stall.range)).toBeLessThan(rateAt(stall + 1) * 0.5);
  });

  it('スロットルを上げると失速から回復する', () => {
    const m = new FlightModel(STARTER_AIRCRAFT);
    m.state.speed = 40;
    run(m, input({ throttle: 0 }), 0.5);
    expect(m.state.stall).toBeGreaterThan(0);
    run(m, input({ throttle: 1 }), 8);
    expect(m.state.stall).toBe(0);
    expect(m.state.speed).toBeGreaterThan(STARTER_AIRCRAFT.speed.stall);
  });

  it('真上を向いて速度 0 でも機首が下がる', () => {
    const m = new FlightModel(STARTER_AIRCRAFT);
    setPitch(m, 90);
    m.state.speed = 0;
    run(m, input({ throttle: 0 }), 2);
    expect(m.pitchAngle()).toBeLessThan(60);
  });
});

describe('オートレベル', () => {
  const bankTo45 = (m: FlightModel): void => {
    while (m.bankAngle() < 45) m.step(input({ roll: 1 }), DT);
  };

  it('入力がないとロールがゆっくり水平に戻る', () => {
    const m = new FlightModel(STARTER_AIRCRAFT);
    bankTo45(m);
    run(m, input(), 0.3);
    // ゆっくり: 0.3 秒ではまだ戻りきらない
    expect(m.bankAngle()).toBeGreaterThan(20);
    run(m, input(), 5);
    expect(Math.abs(m.bankAngle())).toBeLessThan(2);
  });

  it('OFF ならバンクを保つ', () => {
    const m = new FlightModel(STARTER_AIRCRAFT, { autoLevel: false });
    bankTo45(m);
    run(m, input(), 0.5);
    const bank = m.bankAngle();
    run(m, input(), 3);
    expect(m.bankAngle()).toBeCloseTo(bank, 0);
  });

  it('ピッチ入力中（バンクして引いている間）は戻さない', () => {
    const m = new FlightModel(STARTER_AIRCRAFT);
    bankTo45(m);
    run(m, input(), 0.2);
    const bank = m.bankAngle();
    run(m, input({ pitch: 1 }), 0.3);
    expect(m.bankAngle()).toBeGreaterThan(bank - 5);
  });
});

describe('アフターバーナー', () => {
  const ab = STARTER_AIRCRAFT.afterburner;

  it('押している間ゲージを消費して加速し、空になると止まる', () => {
    const m = new FlightModel(STARTER_AIRCRAFT);
    run(m, input({ afterburner: true }), ab.durationSeconds / 2);
    expect(m.state.afterburnerActive).toBe(true);
    expect(m.state.afterburnerGauge).toBeCloseTo(0.5, 2);
    expect(m.state.speed).toBeGreaterThan(STARTER_AIRCRAFT.speed.cruise + 50);
    run(m, input({ afterburner: true }), ab.durationSeconds / 2 + 0.1);
    expect(m.state.afterburnerGauge).toBe(0);
    expect(m.state.afterburnerActive).toBe(false);
    expect(m.state.afterburnerLocked).toBe(true);
  });

  it('離すと遅延のあと回復し、しきい値を超えると再点火できる', () => {
    const m = new FlightModel(STARTER_AIRCRAFT);
    run(m, input({ afterburner: true }), ab.durationSeconds + 0.1);
    run(m, input(), ab.rechargeDelaySeconds * 0.9);
    expect(m.state.afterburnerGauge).toBe(0);
    run(m, input(), ab.rechargeDelaySeconds * 0.1 + ab.rechargeSeconds * 0.5);
    expect(m.state.afterburnerGauge).toBeCloseTo(0.5, 1);
    expect(m.state.afterburnerLocked).toBe(false);
    run(m, input(), ab.rechargeSeconds);
    expect(m.state.afterburnerGauge).toBe(1);
  });
});

describe('高度上限', () => {
  it('上限を超えて上がれず、機首が押し下げられる', () => {
    const m = new FlightModel(STARTER_AIRCRAFT);
    m.state.position.y = FLIGHT_CONFIG.ceiling.start;
    setPitch(m, 45);
    run(m, input({ throttle: 1, afterburner: true }), 6);
    expect(m.state.position.y).toBeLessThanOrEqual(FLIGHT_CONFIG.ceiling.end);
    expect(m.pitchAngle()).toBeLessThan(5);
  });
});
