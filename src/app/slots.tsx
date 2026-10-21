// T06(플레이·결과·투표)·T07(돌려쓰기) 화면이 들어올 자리. 그 task 가 화면을 만들면 아래 자리표시자를 한 줄 re-export 로 바꾼다:
//   export { OnlinePlay as PlaySlot } from '../ui/play/OnlinePlay';     — props 없음, useRoom() 으로 세션을 받는다
//   export { PassAround as PassSlot } from '../ui/passaround/PassAround'; — props { onExit }
export { OnlinePlay as PlaySlot } from '../ui/play/OnlinePlay';

export { PassAround as PassSlot } from '../ui/passaround/PassAround';
