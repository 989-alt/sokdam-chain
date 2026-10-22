// 방 만들기·들어가기·이어하기를 net 층에 연결한다. UI 는 결과(Room 또는 실패 이유)만 받는다.
import { POOL } from '../data/words';
import { createHost } from '../net/host-session';
import { joinRoom, resumeRoom } from '../net/client-session';
import { peerNetwork } from '../net/peer-transport';
import type { Settings } from '../net/protocol';
import type { Network } from '../net/transport';
import { loadSession } from '../storage/session';
import { toWords } from '../teacher/list';
import type { Room } from './room';
import type { TeacherList } from './teacher-state';

const JOIN_TIMEOUT_MS = 8000; // 계약: 8초 안에 방장 연결이 안 되면 "방을 찾을 수 없어요"
const CREATE_TIMEOUT_MS = 10000;
/** 이어하기는 코드 확인이 아니라 다시 붙기 — 느린 ICE(전송 기본 15초)를 기다린다. */
export const RESUME_TIMEOUT_MS = 20000;

type Fail = { ok: false; reason: string };

/** ms 안에 안 끝나면 timeout. 늦게 성공한 세션은 onLate 로 정리한다(떠 있는 연결 방지). */
function timed<T extends { ok: boolean }>(p: Promise<T>, ms: number, onLate: (r: T) => void): Promise<T | Fail> {
  let late = false;
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.then((r) => {
      clearTimeout(timer);
      if (late) onLate(r);
      return r;
    }),
    new Promise<Fail>((res) => {
      timer = setTimeout(() => {
        late = true;
        res({ ok: false, reason: 'timeout' });
      }, ms);
    }),
  ]);
}

export async function createRoom(hostName: string, settings: Settings, teacher: TeacherList | null): Promise<Room | Fail> {
  const r = await timed(
    createHost({ network: peerNetwork, settings, pool: POOL, teacher: teacher ? toWords(teacher.items, settings.level ?? 'e34') : undefined, hostName }),
    CREATE_TIMEOUT_MS,
    (late) => late.ok && late.host.leave(),
  );
  return r.ok && 'host' in r ? { client: r.me, host: r.host, code: r.host.code } : (r as Fail);
}

export async function enterRoom(code: string, name: string): Promise<Room | Fail> {
  const r = await timed(joinRoom({ network: peerNetwork, code, name }), JOIN_TIMEOUT_MS, (late) => late.ok && late.client.leave());
  return r.ok && 'client' in r ? { client: r.client, host: null, code } : (r as Fail);
}

export async function resume(network: Network = peerNetwork): Promise<Room | Fail> {
  const code = loadSession()?.roomCode ?? '';
  // 늦은 성공은 연결만 닫는다 — leave 는 세션 키를 지워 다음 이어하기를 막는다
  const r = await timed(resumeRoom({ network }), RESUME_TIMEOUT_MS, (late) => late.ok && late.client.close());
  return r.ok && 'client' in r ? { client: r.client, host: null, code } : (r as Fail);
}

export const isRoom = (x: Room | Fail): x is Room => 'client' in x;
export { loadSession as savedSession };
