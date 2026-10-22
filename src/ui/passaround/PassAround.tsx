// 화면 13~15 돌려쓰기(기기 한 대, 네트워크 없음). 흐름은 passaround/flow, 그리기·답·결과·투표 화면은 T06 것을 그대로 몬다.
// 가림 화면은 앞 단계 화면을 언마운트한 뒤 띄운다 — 앞사람 그림·답이 DOM 에 남지 않는다.
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import shh from '../../../assets/img/KA-03-mascot-faces/shh.webp';
import cover1 from '../../../assets/img/UI-02-book-cover/1.webp';
import cover2 from '../../../assets/img/UI-02-book-cover/2.webp';
import cover3 from '../../../assets/img/UI-02-book-cover/3.webp';
import cover4 from '../../../assets/img/UI-02-book-cover/4.webp';
import cover5 from '../../../assets/img/UI-02-book-cover/5.webp';
import cover6 from '../../../assets/img/UI-02-book-cover/6.webp';
import { useTeacherList } from '../../app/teacher-state';
import { inputFor, reviewPages, stepCount, voteCandidates } from '../../engine';
import { again, current, finalNames, guardUnload, MAX, MIN, nextPage, nextSlot, reveal, start, submit, vote, type Pass, type PassSettings } from '../../passaround/flow';
import { CATEGORIES, DRAW_SECONDS, LEVELS } from '../lobby/labels';
import { NameField } from '../lobby/NameField';
import { DrawScreen } from '../play/DrawScreen';
import { GuessScreen } from '../play/GuessScreen';
import { useSfx } from '../play/sfx';
import { ReviewScreen } from '../results/ReviewScreen';
import { VoteResultScreen } from '../vote/VoteResultScreen';
import { VoteScreen } from '../vote/VoteScreen';
import { Icon } from '../shared/Icon';
import { Topbar } from '../shared/Topbar';
import './passaround.css';

const COVERS = [cover1, cover2, cover3, cover4, cover5, cover6];
const startFail = (teacherOnly: boolean) =>
  teacherOnly ? '선생님 목록에 제시어가 모자라요. 스케치북을 1권으로 줄이거나 제시어를 더 넣어 주세요' : '제시어가 모자라요. 묶음·수준을 바꾸거나 선생님 목록을 확인해 주세요';
/** 앞사람이 "보냈어요"를 두 번 누른 손가락이 다음 사람 내용을 열지 않게, 가림 화면 버튼은 잠깐 잠근다. */
const READY_DELAY_MS = 400;

function Opt({ on, onClick, children }: { on: boolean; onClick: () => void; children: ComponentChildren }) {
  return (
    <button type="button" class="opt press" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

export function PassAround({ onExit }: { onExit: () => void }) {
  const teacher = useTeacherList();
  const [pass, setPass] = useState<Pass | null>(null);
  const images = useRef(new Map<string, Blob>()); // 메모리뿐 — 새로고침하면 판과 함께 사라진다
  const sound = useSfx(true); // 기기 음소거는 상단 바 토글
  const playing = !!pass;
  useEffect(() => (playing ? guardUnload(window) : undefined), [playing]);
  const pages = useMemo(() => (pass?.phase.kind === 'review' || pass?.phase.kind === 'vote' || pass?.phase.kind === 'result' ? reviewPages(pass.game) : []), [pass]);

  if (!pass)
    return (
      <Setup
        teacher={!!teacher}
        teacherOnly={teacher?.mode === 'only'}
        onBack={onExit}
        onStart={(names, s) => {
          const r = start(names, s, teacher, Math.random);
          if ('ok' in r) return startFail(teacher?.mode === 'only');
          images.current.clear();
          setPass(r);
          return null;
        }}
      />
    );

  const nameOf = (slot: number) => pass.names[slot] ?? '';
  const image = (id: string) => images.current.get(id);
  const ph = pass.phase;
  // 상태 갱신은 모두 최신 상태 기준(함수형) — 연타로 두 번 불려도 두 번째는 이미 다음 가림 화면이라 flow 가 무시한다.
  const update = (f: (p: Pass) => Pass) => setPass((p) => (p ? f(p) : p));
  const quit = () => {
    if (confirm('지금 하던 게임이 지워져요. 그만할까요?')) onExit();
  };

  if (ph.kind === 'cover' || ph.kind === 'vote-cover') {
    const c = current(pass.game);
    const slot = ph.kind === 'vote-cover' ? ph.voter : c!.entry.bySlot;
    const owner = ph.kind === 'cover' ? c!.chain.startSlot : slot;
    return (
      <Cover
        key={ph.kind === 'cover' ? `c${pass.game.step}` : `v${ph.voter}`}
        name={nameOf(slot)}
        what={ph.kind === 'vote-cover' ? '스티커 붙일 차례' : c!.entry.kind === 'draw' ? '그림 그릴 차례' : '답 쓸 차례'}
        cover={COVERS[owner % 6]!}
        onReady={() => update((p) => reveal(p, Date.now()))}
        onQuit={quit}
      />
    );
  }

  if (ph.kind === 'turn') {
    const c = current(pass.game)!;
    const next = nextSlot(pass.game);
    const chips = (
      <>
        <span class="chip book-tag" style={`background: var(--color-book-cover-${(c.chain.startSlot % 6) + 1})`}>
          {nameOf(c.chain.startSlot)}의 스케치북{' '}
          <small>
            {c.step + 1} / {stepCount(pass.names.length)}쪽
          </small>
        </span>
        <span class="chip player">
          <i aria-hidden="true" />
          {nameOf(c.entry.bySlot)}
        </span>
      </>
    );
    if (c.entry.kind === 'draw') {
      const deadline = ph.deadline ?? Date.now();
      return (
        <DrawScreen
          key={pass.game.step}
          input={inputFor(c.chain, c.step, pass.game.mode)}
          first={c.step === 0}
          category={pass.settings.category}
          image={image}
          totalSeconds={pass.settings.drawSeconds}
          remainingMs={() => deadline - Date.now()}
          nextName={next === null ? null : nameOf(next)}
          submitted={false}
          onSubmit={(blob) => {
            const imgId = `t${pass.game.step}`; // 차례마다 하나 — 두 번 불려도 같은 칸을 덮을 뿐
            images.current.set(imgId, blob);
            update((p) => submit(p, { imgId }));
          }}
          sound={sound}
          chips={chips}
        />
      );
    }
    return (
      <GuessScreen
        key={pass.game.step}
        input={inputFor(c.chain, c.step, pass.game.mode)}
        category={pass.settings.category}
        image={image}
        submitted={false}
        onSubmit={(text) => update((p) => submit(p, { text }))}
        sound={sound}
        chips={chips}
      />
    );
  }

  if (ph.kind === 'review')
    return (
      <ReviewScreen
        pages={pages}
        page={ph.page}
        mode={pass.game.mode}
        category={pass.settings.category}
        nameOf={nameOf}
        image={image}
        review="manual"
        reviewSeconds={5}
        onNext={() => update((p) => nextPage(p, pages.length))}
        sound={sound}
      />
    );

  if (ph.kind === 'vote') {
    const c = voteCandidates(pass.game, ph.voter);
    return (
      <VoteScreen
        key={ph.voter}
        pages={pages}
        candidates={{ drawings: c.drawings.map((x) => x.key), answers: c.answers.map((x) => x.key) }}
        mySlot={ph.voter}
        nameOf={nameOf}
        image={image}
        voted={false}
        onVote={(d, a) => update((p) => vote(p, d, a))}
        sound={sound}
        chips={
          <span class="chip player">
            <i aria-hidden="true" />
            {nameOf(ph.voter)}
          </span>
        }
      />
    );
  }

  return (
    <VoteResultScreen
      pages={pages}
      result={ph.result}
      nameOf={nameOf}
      image={image}
      onAgain={() => {
        const r = again(pass, Math.random);
        if ('ok' in r) return startFail(teacher?.mode === 'only');
        images.current.clear();
        setPass(r);
        return null;
      }}
      onLeave={onExit}
      sound={sound}
    />
  );
}

/** 화면 14 가림: 앞 내용 없이 덮은 책 + 쉿 부엉이 + 이름. */
function Cover({ name, what, cover, onReady, onQuit }: { name: string; what: string; cover: string; onReady: () => void; onQuit: () => void }) {
  const [armed, setArmed] = useState(false);
  const ready = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ready.current?.focus(); // 화면이 바뀌었음을 스크린리더·키보드에 알린다
    const t = setTimeout(() => setArmed(true), READY_DELAY_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <section class="screen pass-cover" aria-label="가림 화면">
      <Topbar title="기기 한 대 돌려쓰기" />
      <div class="tile end">
        <div class="pass-art" aria-hidden="true">
          <img class="pass-book" src={cover} alt="" width={338} height={480} />
          <img class="pass-shh" src={shh} alt="" width={542} height={570} />
        </div>
        <h1 class="h">{name} 차례예요. 준비되면 누르세요</h1>
        <p>{what}예요. 다른 친구는 화면을 보지 말아요</p>
        {/* disabled 대신 aria-disabled — disabled 버튼은 포커스를 받지 못한다 */}
        <button ref={ready} type="button" class="btn primary press" aria-disabled={!armed} onClick={() => armed && onReady()}>
          <Icon name="play" size="lg" />
          준비됐어요
        </button>
        <button type="button" class="btn secondary press" onClick={onQuit}>
          <Icon name="log-out" />
          그만하기
        </button>
      </div>
    </section>
  );
}

/** 화면 13 설정: 이름 차례대로(3~6), 체인 수, 수준·방식·그리기 시간. */
function Setup(p: { teacher: boolean; teacherOnly: boolean; onBack: () => void; onStart: (names: string[], s: PassSettings) => string | null }) {
  const [raw, setRaw] = useState<string[]>(['', '', '']);
  const [s, setS] = useState<PassSettings>({ category: '속담', level: 'e34', mode: 'A', drawSeconds: 60, chainCount: 2 });
  const [error, setError] = useState<string | null>(null);
  const set = (x: Partial<PassSettings>) => setS({ ...s, ...x });
  const names = finalNames(raw);

  return (
    <section class="screen screen-create" aria-label="돌려쓰기 설정">
      <Topbar title="기기 한 대 돌려쓰기">
        {p.teacher && (
          <span class="chip soft teacher-badge">
            <Icon name="book-open" size="sm" />
            선생님 목록 사용 중
          </span>
        )}
      </Topbar>
      {error && (
        <div class="banner warn" role="alert">
          <Icon name="triangle-alert" />
          <span>{error}</span>
        </div>
      )}
      <form
        class="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (names) setError(p.onStart(names, { ...s, category: p.teacherOnly ? null : s.category, level: p.teacherOnly ? null : s.level }));
        }}
      >
        <fieldset class="span2">
          <legend>참가자 이름 (기기를 넘길 차례대로)</legend>
          <ol class="pass-names">
            {raw.map((v, i) => (
              <li key={i}>
                <span class="pass-no display" aria-hidden="true">
                  {i + 1}
                </span>
                <NameField id={`pass-name-${i}`} value={v} onChange={(x) => setRaw(raw.map((y, j) => (j === i ? x : y)))} />
                {raw.length > MIN && (
                  <button type="button" class="btn secondary press" aria-label={`${i + 1}번 빼기`} onClick={() => setRaw(raw.filter((_, j) => j !== i))}>
                    <Icon name="trash-2" />
                  </button>
                )}
              </li>
            ))}
          </ol>
          {raw.length < MAX && (
            <button type="button" class="btn secondary press" onClick={() => setRaw([...raw, ''])}>
              <Icon name="users" />
              한 명 더
            </button>
          )}
          <div class="help">
            {MIN}~{MAX}명 · 이름을 모두 써야 시작할 수 있어요 · 같은 이름은 (2)를 붙여요
          </div>
        </fieldset>
        <fieldset>
          <legend>스케치북 수</legend>
          <div class="opts" role="group" aria-label="스케치북 수">
            {([1, 2] as const).map((n) => (
              <Opt key={n} on={s.chainCount === n} onClick={() => set({ chainCount: n })}>
                {n}권
              </Opt>
            ))}
          </div>
          <div class="help">2권으로 하면 한 권이 끝난 뒤 다음 권을 돌려요</div>
        </fieldset>
        {!p.teacherOnly && (
          <fieldset class="category">
            <legend>묶음</legend>
            <div class="opts" role="group" aria-label="묶음">
              {CATEGORIES.map((c) => (
                <Opt key={c} on={s.category === c} onClick={() => set({ category: c })}>
                  {c}
                </Opt>
              ))}
            </div>
          </fieldset>
        )}
        {!p.teacherOnly && (
          <fieldset class="level">
            <legend>수준</legend>
            <div class="opts" role="group" aria-label="수준">
              {LEVELS.map((l) => (
                <Opt key={l.v} on={s.level === l.v} onClick={() => set({ level: l.v })}>
                  {l.label}
                </Opt>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset>
          <legend>첫 쪽에 무엇을 보여 줄까요</legend>
          <div class="opts" role="group" aria-label="시작 방식">
            <Opt on={s.mode === 'A'} onClick={() => set({ mode: 'A' })}>
              글자 보고 그리기
            </Opt>
            <Opt on={s.mode === 'B'} onClick={() => set({ mode: 'B' })}>
              뜻 보고 그리기
            </Opt>
          </div>
        </fieldset>
        <fieldset>
          <legend>그리기 시간</legend>
          <div class="opts" role="group" aria-label="그리기 시간">
            {DRAW_SECONDS.map((n) => (
              <Opt key={n} on={s.drawSeconds === n} onClick={() => set({ drawSeconds: n })}>
                {n}초
              </Opt>
            ))}
          </div>
          <div class="help">시간이 다 되면 그린 데까지 보내요 · 답 쓰기는 시간 제한이 없어요</div>
        </fieldset>
        <div class="form-foot">
          <button type="button" class="btn secondary press" onClick={p.onBack}>
            <Icon name="chevron-left" />
            홈으로
          </button>
          <button type="submit" class="btn primary press grow" disabled={!names}>
            <Icon name="play" size="lg" />
            시작하기
          </button>
        </div>
      </form>
    </section>
  );
}
