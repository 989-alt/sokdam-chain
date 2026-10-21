// T06(플레이·결과·투표)·T07(돌려쓰기) 화면이 들어올 자리. 그 task 가 화면을 만들면 아래 자리표시자를 한 줄 re-export 로 바꾼다:
//   export { OnlinePlay as PlaySlot } from '../ui/play/OnlinePlay';     — props 없음, useRoom() 으로 세션을 받는다
//   export { PassAround as PassSlot } from '../ui/passaround/PassAround'; — props { onExit }
import { Topbar } from '../ui/shared/Topbar';
import { useRoom } from './room';

export function PlaySlot() {
  const { view, leave } = useRoom();
  return (
    <section class="screen" aria-label="게임 중">
      <Topbar title="속담 이어그리기" />
      <div class="tile end">
        <p class="h">게임 화면을 준비하고 있어요</p>
        <p>지금 단계: {view.phase}</p>
        <button type="button" class="btn secondary press" onClick={leave}>
          나가기
        </button>
      </div>
    </section>
  );
}

export function PassSlot({ onExit }: { onExit: () => void }) {
  return (
    <section class="screen" aria-label="기기 한 대 돌려쓰기">
      <Topbar title="기기 한 대 돌려쓰기" />
      <div class="tile end">
        <p class="h">돌려쓰기 화면을 준비하고 있어요</p>
        <button type="button" class="btn secondary press" onClick={onExit}>
          홈으로
        </button>
      </div>
    </section>
  );
}
