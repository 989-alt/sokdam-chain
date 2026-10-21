// 온라인 어댑터: useRoom() 의 세션·뷰를 공용 화면 props 로 내린다. 공용 화면은 net 을 모른다(T07 이 같은 화면을 로컬 엔진으로 몬다).
// 장 넘김·한 판 더는 방장 세션(room.host)만 — 학생 기기엔 그 콜백을 넘기지 않는다.
import { useRef } from 'preact/hooks';
import { useRoom } from '../../app/room';
import { stepCount } from '../../engine';
import { ReviewScreen } from '../results/ReviewScreen';
import { VoteResultScreen } from '../vote/VoteResultScreen';
import { VoteScreen } from '../vote/VoteScreen';
import { Topbar } from '../shared/Topbar';
import { DrawScreen } from './DrawScreen';
import { GuessScreen } from './GuessScreen';
import { useSfx } from './sfx';
import { WaitingPanel } from './WaitingPanel';

export function OnlinePlay() {
  const { room, view, leave } = useRoom();
  const sound = useSfx(!!view.settings?.sound);
  // 칸(차례)이 바뀌면 그리기·답 쓰기 화면을 새로 마운트 — 'step' 메시지마다 cell 객체가 새로 온다
  const seq = useRef({ cell: view.cell, n: 0 });
  if (seq.current.cell !== view.cell) seq.current = { cell: view.cell, n: seq.current.n + 1 };

  const players = view.players;
  const nameOf = (slot: number) => players.find((x) => x.slot === slot)?.name ?? '';
  const image = (id: string) => room.client.image(id);
  const me = players.find((x) => x.slot === view.slot);
  const meChip = (
    <>
      {view.reconnecting && (
        <span class="chip" role="status">
          다시 연결하는 중
        </span>
      )}
      {me && (
        <span class="chip player">
          <i class={me.connected && !view.reconnecting ? '' : 'off'} aria-hidden="true" />
          {me.name}
        </span>
      )}
    </>
  );
  const waitList = players.map((x) => ({ name: x.name, connected: x.connected }));
  const settings = view.settings;
  const cell = view.cell;

  if (view.phase === 'play') {
    const waiting = <WaitingPanel count={view.waiting} title="친구들을 기다리고 있어요" players={waitList} />;
    if (!cell || !settings)
      return (
        <section class="screen" aria-label="기다리기">
          <Topbar title="속담 이어그리기">{meChip}</Topbar>
          <WaitingPanel title="다음 차례를 준비하고 있어요" players={waitList} />
        </section>
      );
    const n = players.length;
    // 온라인 체인 i 의 주인 = slot i(startSlot = chainIdx)
    const chips = (
      <>
        <span class="chip book-tag" style={`background: var(--color-book-cover-${(cell.chainIdx % 6) + 1})`}>
          {nameOf(cell.chainIdx)}의 스케치북{' '}
          <small>
            {cell.step + 1} / {stepCount(n)}쪽
          </small>
        </span>
        {meChip}
      </>
    );
    if (cell.kind === 'draw')
      return (
        <DrawScreen
          key={seq.current.n}
          input={cell.input}
          first={cell.step === 0}
          image={image}
          totalSeconds={settings.drawSeconds}
          remainingMs={() => room.client.remainingMs()}
          nextName={view.slot === null || n === 0 ? null : nameOf((view.slot + 1) % n)}
          submitted={view.submitted}
          error={view.submitError}
          onSubmit={(b) => void room.client.submitDrawing(b)}
          offline={view.reconnecting}
          sound={sound}
          chips={chips}
          waiting={waiting}
        />
      );
    return (
      <GuessScreen
        key={seq.current.n}
        input={cell.input}
        image={image}
        submitted={view.submitted}
        onSubmit={(t) => room.client.submitGuess(t)}
        offline={view.reconnecting}
        sound={sound}
        chips={chips}
        waiting={waiting}
      />
    );
  }

  if (view.phase === 'review' && settings)
    return (
      <ReviewScreen
        pages={view.pages}
        page={view.page}
        mode={settings.mode}
        nameOf={nameOf}
        image={image}
        review={settings.review}
        reviewSeconds={settings.reviewSeconds}
        onNext={room.host && settings.review === 'manual' ? () => room.host!.next() : undefined}
        sound={sound}
      />
    );

  if (view.phase === 'vote')
    return (
      <VoteScreen
        pages={view.pages}
        candidates={view.candidates}
        mySlot={view.slot}
        nameOf={nameOf}
        image={image}
        voted={view.voted}
        onVote={(d, a) => room.client.vote(d, a)}
        sound={sound}
        chips={meChip}
        waiting={<WaitingPanel title="친구들이 스티커를 붙이고 있어요" players={waitList} />}
      />
    );

  if (view.phase === 'vote-result' && view.result)
    return (
      <VoteResultScreen
        pages={view.pages}
        result={view.result}
        nameOf={nameOf}
        image={image}
        onAgain={
          room.host
            ? () => {
                const r = room.host!.again();
                return r.ok ? null : '지금은 한 판 더 할 수 없어요';
              }
            : undefined
        }
        onLeave={leave}
        sound={sound}
      />
    );

  // review 인데 settings 가 아직 없음 등 — 잠깐 비는 순간
  return (
    <section class="screen" aria-label="기다리기">
      <Topbar title="속담 이어그리기">{meChip}</Topbar>
      <WaitingPanel title="잠깐만 기다려 주세요" players={waitList} />
    </section>
  );
}
