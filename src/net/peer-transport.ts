// PeerJS 를 직접 부르는 유일한 파일. 시그널링만 서버를 거치고 데이터는 STUN 으로 뚫은 직결 채널로만 간다(TURN 없음).
import Peer, { type DataConnection } from 'peerjs';
import { ICE_SERVERS, SIGNALING } from '../config';
import type { Conn, Endpoint, Network } from './transport';

const CONNECT_TIMEOUT_MS = 15000;
const OPEN_TIMEOUT_MS = 5000; // 시그널링 WebSocket 이 매달리지 않게
const RECONNECT_MAX_MS = 30000;

function wrap(dc: DataConnection): Conn {
  let dataCb: (m: unknown) => void = () => {};
  let closeCb: () => void = () => {};
  let closed = false;
  const fireClose = () => {
    if (closed) return;
    closed = true;
    closeCb();
  };
  dc.on('data', (d) => dataCb(d));
  dc.on('close', fireClose);
  // 보내기 오류(message-too-big·not-open-yet)는 채널을 닫지 않는다. ICE 실패 등은 PeerJS 가 close 도 낸다.
  dc.on('error', (e) => {
    if (e.type !== 'message-too-big' && e.type !== 'not-open-yet') fireClose();
  });
  return {
    peer: dc.peer,
    send: (msg) => {
      if (!closed && dc.open) void dc.send(msg);
    },
    close: () => {
      dc.close({ flush: true }); // 닫기 직전 보낸 ended·rejected 를 버리지 않게
      fireClose();
    },
    onData: (cb) => void (dataCb = cb),
    onClose: (cb) => void (closeCb = cb),
  };
}

export const peerNetwork: Network = {
  open: (id) =>
    new Promise<Endpoint>((resolve, reject) => {
      const peer = new Peer(id, { ...SIGNALING, config: { iceServers: ICE_SERVERS }, debug: 0 });
      let opened = false;
      let onConn: (c: Conn) => void = () => {};
      const openTimer = setTimeout(() => {
        if (opened) return;
        peer.destroy();
        reject(new Error('timeout'));
      }, OPEN_TIMEOUT_MS);
      // 연결 중인 connect() 들의 실패 통지(peer-unavailable 은 Peer 의 error 로 온다. network·socket-* 등 내 시그널링 오류도 같은 길).
      const pending = new Set<(e: Error) => void>();
      // 시그널링만 끊긴 것 — 열린 채널은 그대로, 새 입장·다시 붙기를 받으려고 될 때까지 다시 등록한다(1·2·4…30초).
      // reconnect() 실패도 disconnected 로 다시 오므로 예약은 여기서만 하고 간격을 두 배로 늘린다. 다시 열리면 초기화, destroy 면 멈춘다.
      let backoff = 1000;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let stopped = false;
      let lostCb: () => void = () => {};
      peer.on('error', (e) => {
        if (!opened) {
          peer.destroy();
          return reject(new Error(e.type));
        }
        for (const f of pending) f(new Error(e.type));
        if (e.type === 'unavailable-id' && !stopped) {
          stopped = true; // 다른 peer 가 내 id 를 가져감 — 다시 등록해도 같은 답. 돌지 않고 알린다
          lostCb();
        }
      });
      peer.on('disconnected', () => {
        if (stopped) return; // destroy() 도 disconnected 를 낸다
        clearTimeout(retry);
        retry = setTimeout(() => peer.disconnected && !peer.destroyed && peer.reconnect(), backoff);
        backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
      });
      peer.on('connection', (dc) => {
        dc.on('open', () => onConn(wrap(dc)));
      });
      peer.on('open', () => {
        backoff = 1000;
        if (opened) return; // reconnect 로 다시 열림
        opened = true;
        clearTimeout(openTimer);
        resolve({
          id,
          onConnection: (cb) => void (onConn = cb),
          connect: (peerId, timeoutMs = CONNECT_TIMEOUT_MS) =>
            new Promise<Conn>((res, rej) => {
              const dc = peer.connect(peerId, { serialization: 'json', reliable: true });
              const done = (e?: Error) => {
                clearTimeout(timer);
                pending.delete(fail);
                if (e) {
                  dc.close();
                  rej(e);
                } else res(wrap(dc));
              };
              const fail = (e: Error) => done(e);
              const timer = setTimeout(() => done(new Error('timeout')), timeoutMs);
              pending.add(fail);
              dc.on('open', () => done());
              dc.on('error', () => done(new Error('connect-failed')));
            }),
          destroy: () => {
            stopped = true;
            clearTimeout(retry);
            peer.destroy();
          },
          onSignalingLost: (cb) => void (lostCb = cb),
        });
      });
    }),
};
