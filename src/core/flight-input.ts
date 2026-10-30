// キーボード・パッド・タッチのアクションを飛行の操作に読み替える（固定ステップごと。main.ts から分けた）
import type { AircraftControls } from '../entities/aircraft';
import type { Input } from './input';

export function readFlightControls(input: Input, controls: AircraftControls): void {
  controls.pitch = input.axis('pitchDown', 'pitchUp');
  controls.roll = input.axis('rollLeft', 'rollRight');
  controls.yaw = input.axis('yawLeft', 'yawRight');
  controls.throttle = input.axis('throttleDown', 'throttleUp');
  controls.afterburner = input.isDown('afterburner');
  controls.throttleTarget = input.takeThrottleTarget();
}
