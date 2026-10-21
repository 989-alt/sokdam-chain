// 앱 셸: 해시 라우터 · 교사 링크 감지 · 방 세션 · 음소거. 화면 목록 PRD §6.
import { useEffect, useState } from 'preact/hooks';
import '../styles/tokens.css';
import '../styles/app.css';
import { CreateRoomScreen } from '../ui/lobby/CreateRoomScreen';
import { HomeScreen } from '../ui/lobby/HomeScreen';
import { JoinRoomScreen } from '../ui/lobby/JoinRoomScreen';
import { joinFailMessage } from '../ui/shared/messages';
import { SoundProvider } from '../ui/shared/sound';
import { TeacherListScreen } from '../ui/teacher/TeacherListScreen';
import { createRoom, enterRoom, isRoom, resume, savedSession } from './connect';
import { RoomRoute, type Room } from './room';
import { go, useRoute } from './router';
import { PassSlot } from './slots';
import { readTeacherHash, TeacherContext, type TeacherList } from './teacher-state';

export function App() {
  const [room, setRoom] = useState<Room | null>(null);
  const [teacher, setTeacher] = useState<TeacherList | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const readHash = (hash: string) => {
    const t = readTeacherHash(hash);
    if (!t) return;
    if ('list' in t) setTeacher(t.list);
    else {
      setTeacher(null);
      setToast(t.error);
    }
  };
  const route = useRoute(room ? 'room' : null, readHash);
  useEffect(() => readHash(location.hash), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  // 방 없이 #/room 으로 왔으면(새로고침 등) 홈으로. 이어하기는 홈에서.
  useEffect(() => {
    if (route === 'room' && !room) history.replaceState(null, '', '#/');
  }, [route, room]);

  const enter = (r: Room) => {
    setRoom(r);
    go('room');
  };
  const doResume = async (): Promise<string | null> => {
    const r = await resume();
    if (isRoom(r)) {
      enter(r);
      return null;
    }
    return joinFailMessage(r.reason);
  };
  const home = () => {
    room?.host?.leave();
    setRoom(null);
    // lock 이 풀린 뒤 이동해야 한다 — 다음 렌더 뒤.
    setTimeout(() => go('home'));
  };

  let screen;
  if (room) screen = <RoomRoute room={room} onHome={home} onResume={doResume} />;
  else if (route === 'create')
    screen = (
      <CreateRoomScreen
        teacher={teacher}
        onBack={() => go('home')}
        onPassAround={() => go('pass')}
        onCreate={async (name, settings) => {
          const r = await createRoom(name, settings, teacher);
          if (!isRoom(r)) return false;
          enter(r);
          return true;
        }}
      />
    );
  else if (route === 'join')
    screen = (
      <JoinRoomScreen
        onBack={() => go('home')}
        onJoin={async (code, name) => {
          const r = await enterRoom(code, name);
          if (!isRoom(r)) return joinFailMessage(r.reason);
          enter(r);
          return null;
        }}
      />
    );
  else if (route === 'teacher') screen = <TeacherListScreen onBack={() => go('home')} />;
  else if (route === 'pass') screen = <PassSlot onExit={() => go('home')} />;
  else screen = <HomeScreen teacherCount={teacher?.items.length ?? null} toast={toast} canResume={!!savedSession()} onResume={doResume} />;

  return (
    <SoundProvider>
      <TeacherContext.Provider value={teacher}>{screen}</TeacherContext.Provider>
    </SoundProvider>
  );
}
