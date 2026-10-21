// 메모리 안 모의 전송. 테스트(방장 1 + 학생 n)와 방장 기기 자신의 참가자 연결에 쓴다.
// 메시지는 JSON 으로 왕복시켜 serialization 'json' 과 같게 만든다. 순서는 지연이 같아 보존된다.
import type { Conn, Endpoint, Network } from './transport';

/** unavailableMs: 없는 peer 에 connect 하면 이만큼 뒤 peer-unavailable(PeerServer 는 expire_timeout 5초 + 정리 주기 ≤1초 뒤 답한다). */
type Opts = { latencyMs?: number; dropRate?: number; rng?: () => number; unavailableMs?: number };

class LoopConn implements Conn {
  other!: LoopConn;
  closed = false;
  private dataCb: (m: unknown) => void = () => {};
  private closeCb: () => void = () => {};
  constructor(
    readonly peer: string,
    readonly local: string,
    private net: { deliver(fn: () => void): void; muted(a: string, b: string): boolean; drop(): boolean },
  ) {}
  send(msg: object): void {
    if (this.closed) return;
    const json = JSON.stringify(msg);
    if (this.net.muted(this.local, this.peer) || this.net.drop()) return;
    const to = this.other;
    this.net.deliver(() => {
      if (!to.closed) to.dataCb(JSON.parse(json));
    });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const to = this.other;
    this.net.deliver(() => to.remoteClosed());
    this.closeCb(); // PeerJS 도 자기 쪽 close 이벤트를 낸다
  }
  remoteClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCb();
  }
  onData(cb: (m: unknown) => void): void {
    this.dataCb = cb;
  }
  onClose(cb: () => void): void {
    this.closeCb = cb;
  }
}

/** 바로 이어진 연결 한 쌍(지연 0, setTimeout 0 으로 비동기 전달). */
export function connPair(aId: string, bId: string): [Conn, Conn] {
  const net = { deliver: (fn: () => void) => void setTimeout(fn, 0), muted: () => false, drop: () => false };
  const a = new LoopConn(bId, aId, net);
  const b = new LoopConn(aId, bId, net);
  a.other = b;
  b.other = a;
  return [a, b];
}

export type Loopback = Network & {
  /** id 의 모든 연결을 끊는다(양쪽 close). */
  cut(id: string): void;
  /** id 가 보내고 받는 메시지를 조용히 버린다(close 없음) — 화면 꺼짐·와이파이 정지 흉내. */
  mute(id: string, on: boolean): void;
  /** id 가 말없이 사라진다 — 시그널링 등록은 없어지고 열린 연결은 close 없이 침묵(컨텍스트 강제 종료 흉내). */
  vanish(id: string): void;
  /** id 가 등록은 남은 채 응답이 없다 — 열린 연결은 침묵, 새 connect 는 열리지 않고 timeout(망 끊긴 방장·잠든 노트북 흉내). */
  freeze(id: string): void;
};

export function createLoopback(opts: Opts = {}): Loopback {
  const latency = opts.latencyMs ?? 0;
  const rng = opts.rng ?? Math.random;
  const eps = new Map<string, { onConn: (c: Conn) => void; conns: Set<LoopConn> }>();
  const mutedIds = new Set<string>();
  const frozen = new Set<string>();
  const net = {
    deliver: (fn: () => void) => void setTimeout(fn, latency),
    muted: (a: string, b: string) => mutedIds.has(a) || mutedIds.has(b),
    drop: () => (opts.dropRate ?? 0) > 0 && rng() < opts.dropRate!,
  };

  return {
    async open(id) {
      if (eps.has(id)) throw new Error('unavailable-id');
      const me = { onConn: (_: Conn) => {}, conns: new Set<LoopConn>() };
      eps.set(id, me);
      const ep: Endpoint = {
        id,
        onConnection: (cb) => void (me.onConn = cb),
        connect: (peerId, timeoutMs) =>
          new Promise((resolve, reject) =>
            setTimeout(() => {
              const remote = eps.get(peerId);
              if (remote && frozen.has(peerId)) return void setTimeout(() => reject(new Error('timeout')), timeoutMs ?? 15000); // peer-transport 기본과 같게
              if (!remote || eps.get(id) !== me) return void setTimeout(() => reject(new Error('peer-unavailable')), opts.unavailableMs ?? 0);
              const a = new LoopConn(peerId, id, net);
              const b = new LoopConn(id, peerId, net);
              a.other = b;
              b.other = a;
              me.conns.add(a);
              remote.conns.add(b);
              remote.onConn(b);
              resolve(a);
            }, latency),
          ),
        destroy() {
          if (eps.get(id) !== me) return;
          eps.delete(id);
          for (const c of me.conns) c.close();
        },
      };
      return ep;
    },
    cut(id) {
      for (const c of eps.get(id)?.conns ?? []) c.close();
    },
    mute(id, on) {
      if (on) mutedIds.add(id);
      else mutedIds.delete(id);
    },
    vanish(id) {
      mutedIds.add(id);
      eps.delete(id);
    },
    freeze(id) {
      mutedIds.add(id);
      frozen.add(id);
    },
  };
}
