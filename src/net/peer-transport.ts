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
      // 연결 중인 connect() 들의 실패 통지(peer-unavailable 은 Peer 의 error 로 온다).
      const pending = new Set<(e: Error) => void>();
      peer.on('error', (e) => {
        if (!opened) {
          peer.destroy();
          reject(new Error(e.type));
        } else for (const f of pending) f(new Error(e.type));
      });
      // 시그널링만 끊긴 것 — 열린 채널은 그대로, 새 입장·다시 붙기를 받으려고 될 때까지 다시 등록한다(1·2·4…30초).
      let backoff = 1000;
      let retry: ReturnType<typeof setTimeout> | undefined;
      const tryReconnect = () => {
        if (peer.destroyed || !peer.disconnected) return void (backoff = 1000);
        peer.reconnect();
        retry = setTimeout(tryReconnect, backoff);
        backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
      };
      peer.on('disconnected', () => {
        clearTimeout(retry);
        retry = setTimeout(tryReconnect, 0); // destroy() 도 disconnected 를 낸다 — 한 박자 뒤 destroyed 로 걸러진다
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
            clearTimeout(retry);
            peer.destroy();
          },
        });
      });
    }),
};
