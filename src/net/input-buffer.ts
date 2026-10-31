// ホスト側のクライアントの入力の受け取り（5-1）。入力はステップ番号（seq）つきで冗長に届くので、
// seq の順に 1 ステップに 1 つずつ使う（クライアントの先行計算と同じ操作で同じ回数だけ計算するため、位置が一致する）。
// 揺らぎの吸収に最初は数ステップ溜めてから使い、溜まりすぎたら 2 つずつ使って追いつく。
// 届かない seq（全部の複製が失われた・遅れて間に合わない）は直前の操作で埋めて進む（機体を止めると動きが途切れ、
// 他の人の補間の表示が飛ぶため。ずれはクライアントの補正が吸収する）。間に合わなかった入力は後から届いても使わない。
// クライアントの時間がホストより遅れた（コマ落ち・タブを裏に回した）ために、届く入力がずっと「もう推測で使った seq」
// ばかりになったら、溜め直してそのクライアントの入力に合わせ直す（ホストの機体はその間止まり、クライアントは補正で合う）。
// Three.js 非依存
import { NET_CONFIG } from '../data/net';
import { clearPresses } from './net-controls';
import { createNetControls, type InputMsg, type NetControls } from './protocol';

const I = NET_CONFIG.input;
const RING = 256;

export class InputBuffer {
  private readonly ring: (NetControls | null)[] = new Array<NetControls | null>(RING).fill(null);
  private readonly seqs = new Int32Array(RING).fill(-1);
  /** 届いた最新の seq（0 は未着） */
  private newest = 0;
  /** 次に使う seq（0 は未開始） */
  private next = 0;
  private buffering = true;
  /** 直前に使った操作（届かない seq を埋める） */
  readonly last: NetControls = createNetControls();
  /** 最後に使った seq（state の lastInputSeq） */
  lastApplied = 0;
  /** 最新の入力の「クライアントが表示していたホストの tick − seq」（遅延補償。5-3。null は未着） */
  viewOffset: number | null = null;
  /** 埋めた（推測した）ステップの数 */
  guessed = 0;
  /** 入力が切れて直前の操作で進めたステップの数（guessed に含む） */
  starved = 0;
  /** 溜め直した回数 */
  resyncs = 0;
  /** 丸ごと間に合わなかったメッセージが続いた数 */
  private late = 0;
  private readonly out: NetControls[] = [];
  private readonly slots = [createNetControls(), createNetControls()];

  receive(msg: Readonly<InputMsg>): void {
    // 丸ごと間に合わなかったメッセージが続いたら（クライアントが遅れている）溜め直す
    this.late = this.next > 0 && msg.seq < this.next ? this.late + 1 : 0;
    const behind = this.late >= I.lateMessagesToResync || msg.seq < this.next - I.resyncTicks;
    // 最初のメッセージ（溜め直すときはこのメッセージ）の最古のステップから使い始める
    if (this.next === 0 || behind) {
      if (this.next > 0) this.resyncs++;
      this.next = Math.max(1, msg.seq - msg.controls.length + 1);
      this.newest = 0;
      this.late = 0;
      this.buffering = true;
    }
    for (let i = 0; i < msg.controls.length; i++) {
      const seq = msg.seq - i;
      const c = msg.controls[i];
      if (!c || seq < this.next) continue;
      const slot = seq % RING;
      if (this.seqs[slot] === seq) continue;
      this.seqs[slot] = seq;
      const stored = this.ring[slot] ?? createNetControls();
      Object.assign(stored, c);
      this.ring[slot] = stored;
    }
    if (msg.seq > this.newest) {
      this.newest = msg.seq;
      if (msg.viewTick > 0) this.viewOffset = msg.viewTick - msg.seq;
    }
  }

  /** 溜め直す（5-4。再接続した人の古い seq を忘れ、次に届くメッセージから使い始める） */
  reset(): void {
    this.next = 0;
    this.newest = 0;
    this.late = 0;
    this.buffering = true;
    this.viewOffset = null;
  }

  /** 溜まっているステップ数 */
  get backlog(): number {
    return this.next === 0 ? 0 : this.newest - this.next + 1;
  }

  /** このステップで使う操作（溜めている間は 0 個、ふだん 1 個、追いつくとき 2 個。返した配列は次の呼び出しまで有効） */
  pull(): readonly NetControls[] {
    const out = this.out;
    out.length = 0;
    const backlog = this.backlog;
    if (this.buffering) {
      if (backlog < I.jitterBufferTicks) return out;
      this.buffering = false;
    }
    // 切れたら直前の操作で 1 ステップ進む
    if (backlog <= 0) this.starved++;
    const n = backlog > I.maxBacklogTicks ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const seq = this.next;
      const slot = seq % RING;
      const c = this.seqs[slot] === seq ? this.ring[slot] : null;
      if (c) Object.assign(this.last, c);
      else this.guessed++;
      const used = Object.assign(this.slots[k] ?? createNetControls(), this.last);
      // 押した瞬間だけの操作（ミサイル・フレア・切替）は、使ったステップの 1 回だけ（推測で繰り返さない）
      clearPresses(this.last);
      out.push(used);
      this.lastApplied = seq;
      this.next++;
    }
    return out;
  }
}
