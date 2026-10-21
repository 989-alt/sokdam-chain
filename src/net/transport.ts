// 세션 로직이 보는 유일한 전송 인터페이스. 구현: peer-transport.ts(PeerJS), loopback.ts(메모리).

/** 열린 데이터 채널 하나. send 는 JSON 직렬화 가능한 값만. */
export interface Conn {
  readonly peer: string;
  send(msg: object): void;
  close(): void;
  onData(cb: (msg: unknown) => void): void;
  /** 상대가 닫았거나 오류로 끊김. 한 번만 부른다. */
  onClose(cb: () => void): void;
}

export interface Endpoint {
  readonly id: string;
  onConnection(cb: (c: Conn) => void): void;
  /** 열리면 resolve. 상대 없음·실패면 Error(message = 'peer-unavailable' 등) 로 reject. */
  connect(peerId: string): Promise<Conn>;
  destroy(): void;
}

export interface Network {
  /** id 로 시그널링 등록. 이미 쓰는 id 면 Error('unavailable-id') 로 reject. */
  open(id: string): Promise<Endpoint>;
}
