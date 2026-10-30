// テスト用の AudioContext のモック（実音は鳴らさない）。使う分のノードとパラメータだけ
export class MockParam {
  value = 0;
  readonly events: { type: string; value: number; time: number }[] = [];
  setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.events.push({ type: 'set', value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number): this {
    this.value = value;
    this.events.push({ type: 'target', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.value = value;
    this.events.push({ type: 'linear', value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    this.value = value;
    this.events.push({ type: 'exp', value, time });
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

export class MockNode {
  readonly connections: unknown[] = [];
  connect(to: unknown): unknown {
    this.connections.push(to);
    return to;
  }
  disconnect(): void {
    this.connections.length = 0;
  }
}

class MockGain extends MockNode {
  readonly gain = new MockParam();
}

class MockCompressor extends MockNode {
  readonly threshold = new MockParam();
  readonly ratio = new MockParam();
  readonly attack = new MockParam();
  readonly release = new MockParam();
  readonly knee = new MockParam();
}

class MockFilter extends MockNode {
  type = 'lowpass';
  readonly frequency = new MockParam();
  readonly Q = new MockParam();
}

class MockPanner extends MockNode {
  panningModel = 'HRTF';
  distanceModel = 'inverse';
  refDistance = 1;
  rolloffFactor = 1;
  maxDistance = 10000;
  readonly positionX = new MockParam();
  readonly positionY = new MockParam();
  readonly positionZ = new MockParam();
}

class MockSource extends MockNode {
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

class MockBufferSource extends MockSource {
  buffer: unknown = null;
  loop = false;
}

class MockOscillator extends MockSource {
  type = 'sine';
  readonly frequency = new MockParam();
}

class MockBuffer {
  readonly duration: number;
  private readonly data: Float32Array;
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = length / sampleRate;
    this.data = new Float32Array(length);
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

export class MockAudioContext {
  currentTime = 0;
  sampleRate = 8000;
  state = 'suspended';
  readonly destination = new MockNode();
  readonly listener = {
    positionX: new MockParam(),
    positionY: new MockParam(),
    positionZ: new MockParam(),
    forwardX: new MockParam(),
    forwardY: new MockParam(),
    forwardZ: new MockParam(),
    upX: new MockParam(),
    upY: new MockParam(),
    upZ: new MockParam(),
  };
  readonly sources: MockSource[] = [];
  resumed = 0;
  suspended = 0;
  createDynamicsCompressor(): MockCompressor {
    return new MockCompressor();
  }
  createGain(): MockGain {
    return new MockGain();
  }
  createBiquadFilter(): MockFilter {
    return new MockFilter();
  }
  createPanner(): MockPanner {
    return new MockPanner();
  }
  createBuffer(channels: number, length: number, rate: number): MockBuffer {
    return new MockBuffer(channels, length, rate);
  }
  createBufferSource(): MockBufferSource {
    const s = new MockBufferSource();
    this.sources.push(s);
    return s;
  }
  createOscillator(): MockOscillator {
    const s = new MockOscillator();
    this.sources.push(s);
    return s;
  }
  resume(): Promise<void> {
    this.resumed++;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspended++;
    this.state = 'suspended';
    return Promise.resolve();
  }
  decodeAudioData(): Promise<MockBuffer> {
    return Promise.resolve(new MockBuffer(1, 8000, 8000));
  }
}

/** モックを AudioContext として渡す（テストだけのキャスト） */
export function asContext(mock: MockAudioContext): AudioContext {
  return mock as unknown as AudioContext;
}
