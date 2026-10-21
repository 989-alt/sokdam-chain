// 교사 링크(#l=…) 상태. 홈 진입·해시 변경 때 해석해 앱 메모리에 둔다(T07 돌려쓰기도 useTeacherList 로 받는다).
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { decodeFailMessage, decodeList, type ListItem, type ListMode } from '../teacher/list';

export type TeacherList = { mode: ListMode; items: ListItem[] };

/** '#l=' 해시가 아니면 null(그대로 둠). 맞으면 목록 또는 실패 문구. */
export function readTeacherHash(hash: string): { list: TeacherList } | { error: string } | null {
  const r = decodeList(hash);
  if (r.ok) return { list: { mode: r.mode, items: r.items } };
  return r.reason === 'missing' ? null : { error: decodeFailMessage(r.reason) };
}

export const TeacherContext = createContext<TeacherList | null>(null);

/** 홈에서 읽은 교사 목록. 없으면 null. listSource: mode 'only' → 'teacher-only', 'add' → 'teacher-add'. */
export const useTeacherList = (): TeacherList | null => useContext(TeacherContext);
