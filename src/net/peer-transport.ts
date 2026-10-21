// PeerJS 를 직접 부르는 유일한 파일. 시그널링만 서버를 거치고 데이터는 STUN 으로 뚫은 직결 채널로만 간다(TURN 없음).
import Peer, { type DataConnection } from 'peerjs';
import { ICE_SERVERS, SIGNALING } from '../config';
import type { Conn, Endpoint, Network } from './transport';

const CONNECT_TIMEOUT_MS = 15000;

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
  dc.on('error', fireClose);
  return {
    peer: dc.peer,
    send: (msg) => {
      if (!closed && dc.open) void dc.send(msg);
    },
    close: () => {
      dc.close();
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
      // 연결 중인 connect() 들의 실패 통지(peer-unavailable 은 Peer 의 error 로 온다).
      const pending = new Set<(e: Error) => void>();
      peer.on('error', (e) => {
        if (!opened) {
          peer.destroy();
          reject(new Error(e.type));
        } else for (const f of pending) f(new Error(e.type));
      });
      // 시그널링만 끊긴 것 — 열린 채널은 그대로, 새 입장을 받으려고 다시 등록한다.
      peer.on('disconnected', () => {
        if (!peer.destroyed) peer.reconnect();
      });
      peer.on('connection', (dc) => {
        dc.on('open', () => onConn(wrap(dc)));
      });
      peer.on('open', () => {
        opened = true;
        resolve({
          id,
          onConnection: (cb) => void (onConn = cb),
          connect: (peerId) =>
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
              const timer = setTimeout(() => done(new Error('timeout')), CONNECT_TIMEOUT_MS);
              pending.add(fail);
              dc.on('open', () => done());
              dc.on('error', () => done(new Error('connect-failed')));
            }),
          destroy: () => peer.destroy(),
        });
      });
    }),
};
