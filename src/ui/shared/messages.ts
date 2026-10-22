// net 층 실패 이유 → 학생이 읽는 문장. (reason 목록: .superpowers/sdd/new-edu-game/T03-api.md)

/** 방 들어가기·이어하기 실패. */
export function joinFailMessage(reason: string): string {
  switch (reason) {
    case 'full':
      return '방이 꽉 찼어요';
    case 'started':
      return '이미 시작한 방이에요';
    case 'version':
      return '앱을 새로고침해 주세요';
    case 'name':
      return '이름을 다시 써 주세요';
    case 'no-room':
    case 'timeout':
    case 'code':
      return '방을 찾을 수 없어요. 코드를 다시 확인해 주세요';
    case 'unknown':
    case 'ended':
    case 'no-session':
      return '이어할 게임이 없어요. 새로 들어가 주세요';
    default:
      return '연결할 수 없어요. 와이파이를 확인하고 다시 해 보세요';
  }
}

/** 이어하기 실패 — 코드를 쓴 적이 없으니 코드 확인 안내는 하지 않는다. */
export function resumeFailMessage(reason: string): string {
  if (reason === 'timeout') return '연결이 잘 안 돼요. 잠시 뒤 이어하기를 다시 눌러 주세요';
  if (reason === 'no-room') return '이어할 게임이 없어요. 새로 들어가 주세요';
  return joinFailMessage(reason);
}

/** 방 만들기 실패(시그널링 서버 장애 등) — PRD §8 복구 경로를 같이 안내한다. */
export const createFailMessage = '지금은 연결할 수 없어요. 기기 한 대 돌려쓰기로 해 보세요';

export type EndKind = 'host-left' | 'finished' | 'lost' | 'left';

export const endText: Record<EndKind, { title: string; body: string }> = {
  'host-left': { title: '방장 연결이 끊겨 게임이 끝났어요', body: '그림과 답이 방장 기기에만 남았어요. 처음 화면에서 다시 시작해 주세요' },
  finished: { title: '게임이 끝났어요', body: '모든 차례가 끝났어요. 처음 화면에서 새 게임을 시작해 주세요' },
  lost: { title: '연결이 끊겼어요', body: '와이파이를 확인하고 이어하기를 눌러 보세요' },
  left: { title: '방에서 나왔어요', body: '처음 화면에서 다시 들어가거나 새 방을 만들어 주세요' },
};
