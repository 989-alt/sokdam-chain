// 방(온라인 모드) 세션 컨텍스트와 방 경로 화면. 방장 기기도 참가자다 — 모든 기기가 ClientSession 하나로 참가자 화면을 그린다.
import { createContext } from 'preact';
import { useContext, useState } from 'preact/hooks';
import type { ClientSession, ClientView } from '../net/client-session';
import type { HostSession, HostView } from '../net/host-session';
import { EndScreen } from '../ui/lobby/EndScreen';
import { LobbyScreen } from '../ui/lobby/LobbyScreen';
import type { EndKind } from '../ui/shared/messages';
import { useSubscribe } from '../ui/shared/use-session';
import { useWakeLock } from '../ui/shared/wake-lock';
import { PlaySlot } from './slots';

export type Room = { client: ClientSession; host: HostSession | null; code: string };

export type RoomState = {
  room: Room;
  /** 이 기기 참가자 뷰(방장 기기 포함). */
  view: ClientView;
  /** 방장 기기만. 학생 기기는 null. */
  hostView: HostView | null;
  /** 나가기(방장이면 방을 닫는다). 종료 화면 "방에서 나왔어요" 로 간다. */
  leave: () => void;
};

const RoomContext = createContext<RoomState | null>(null);

/** 방 경로 안(PlaySlot 아래)에서만 쓴다. */
export function useRoom(): RoomState {
  const r = useContext(RoomContext);
  if (!r) throw new Error('useRoom outside room route');
  return r;
}

// 교사 전용 목록이면 수준이 상관없다(돌려쓰기 PassAround startFail 과 같은 규칙)
export const startFail = (reason: string, teacherOnly: boolean): string =>
  reason === 'player-count'
    ? '4명부터 시작할 수 있어요'
    : reason === 'not-enough-words'
      ? teacherOnly
        ? '선생님 목록에 제시어가 모자라요. 제시어를 더 넣어 주세요'
        : '제시어가 모자라요. 묶음·수준을 바꾸거나 선생님 목록을 확인해 주세요'
      : '지금은 시작할 수 없어요';

function Connecting() {
  return (
    <section class="screen" aria-label="연결 중">
      <div class="tile end" role="status" aria-busy="true">
        <span class="spin big" aria-hidden="true"></span>
        <p class="h">방에 들어가고 있어요</p>
      </div>
    </section>
  );
}

export function RoomRoute({ room, onHome, onResume }: { room: Room; onHome: () => void; onResume: () => Promise<string | null> }) {
  const view = useSubscribe<ClientView>(room.client);
  const hostView = useSubscribe<HostView>(room.host);
  const [left, setLeft] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  useWakeLock(!!view && view.phase !== 'ended');
  if (!view) return <Connecting />;

  const leave = () => {
    setLeft(true);
    if (room.host) room.host.leave();
    else room.client.leave();
  };

  if (view.phase === 'ended') {
    // 방장 기기는 자기가 닫은 방의 host-left 를 받는다 — 내가 나간 것으로 보여 준다.
    const kind: EndKind = left ? 'left' : (view.ended ?? 'lost');
    return <EndScreen kind={kind} onHome={onHome} onResume={kind === 'lost' ? onResume : undefined} />;
  }

  // 이어하기는 첫 sync 까지 connecting — 대기실이 아니라 연결 중 표시.
  if (view.phase === 'connecting') return <Connecting />;

  if (view.phase === 'lobby') {
    return (
      <LobbyScreen
        code={room.code}
        players={view.players}
        mySlot={view.slot}
        settings={view.settings}
        isHost={!!room.host}
        canStart={!!hostView?.canStart}
        startError={startError}
        onStart={() => {
          const r = room.host?.start();
          setStartError(r && !r.ok ? startFail(r.reason, view.settings?.listSource === 'teacher-only') : null);
        }}
        onLeave={leave}
      />
    );
  }

  return (
    <RoomContext.Provider value={{ room, view, hostView, leave }}>
      <PlaySlot />
    </RoomContext.Provider>
  );
}
