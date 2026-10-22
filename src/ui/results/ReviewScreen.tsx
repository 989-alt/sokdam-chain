// 화면 8·9 결과 보기 + 뜻·예문 카드. 장은 바깥(온라인: 방장 show, 돌려쓰기: 로컬)이 정한 page 만 보여 준다 —
// 이 화면은 스스로 장을 넘기지 않는다. onNext 가 있을 때만 '다음 쪽' 버튼이 생긴다.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Category, Mode, ReviewPage } from '../../engine';
import { Picture } from '../play/Picture';
import { FALLBACK_NOTE } from '../play/prompt';
import type { Sfx } from '../play/sfx';
import { Icon } from '../shared/Icon';
import { MuteToggle } from '../shared/sound';
import { guessText, isGap, pageLabel, pagePos, pictureOf } from './pages';
import './results.css';

export type ReviewScreenProps = {
  pages: ReviewPage[];
  page: number;
  mode: Mode;
  /** 고른 묶음 — 첫 쪽 머리 '처음 ○○'. 교사 목록만이면 null(→ '제시어'). */
  category: Category | null;
  nameOf: (slot: number) => string;
  image: (imgId: string) => Blob | undefined;
  review: 'timer' | 'manual';
  reviewSeconds: number;
  /** 넘김 권한이 있는 기기만(온라인 manual 방장, 돌려쓰기). 없으면 버튼 없음. */
  onNext?: () => void;
  sound: (s: Sfx) => void;
  /** 상단 바 오른쪽 칩. */
  chips?: ComponentChildren;
};

const HALF = 210; // page-turn 420ms 의 반 — 앞면 나감 / 뒷면 들어옴
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function ReviewScreen(p: ReviewScreenProps) {
  const [shown, setShown] = useState(p.page);
  const [turn, setTurn] = useState<'' | 'turn-out' | 'turn-in'>('');
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    p.sound('turn');
    if (reduced()) {
      setShown(p.page);
      return setTurn('');
    }
    // 넘김 중에 새 장이 오면 타이머를 버리고 최신 장으로 다시 넘긴다(큐에 쌓지 않음)
    setTurn('turn-out');
    let t2: ReturnType<typeof setTimeout> | undefined;
    const t1 = setTimeout(() => {
      setShown(p.page);
      setTurn('turn-in');
      t2 = setTimeout(() => setTurn(''), HALF);
    }, HALF);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [p.page]);

  const i = Math.min(shown, p.pages.length - 1);
  const page = p.pages[i];
  if (!page) return null;
  const pos = pagePos(p.pages, i);
  const chainPages = p.pages.filter((x) => x.chainIdx === pos.chainIdx);
  const owner = pos.owner === null ? '' : p.nameOf(pos.owner);
  const label = pageLabel(page, pos.pageNo, p.nameOf, p.mode, p.category);
  const lastOfAll = p.page >= p.pages.length - 1;

  return (
    <section class="screen screen-review play-review" aria-label="결과 보기">
      <header class="review-head">
        <h1 class="title display">결과 보기</h1>
        {owner && (
          <span class="chip book-tag" style={`margin-left:0; background: var(--color-book-cover-${(pos.owner! % 6) + 1})`}>
            {owner}의 스케치북{' '}
            <small>
              {pos.chainNo} / {pos.chainCount}권
            </small>
          </span>
        )}
        <div class="progress">
          쪽
          <div class="bar" role="progressbar" aria-valuemin={1} aria-valuemax={pos.pageCount} aria-valuenow={pos.pageNo} aria-label="진행 순서">
            <i style={{ width: `${(pos.pageNo / pos.pageCount) * 100}%` }} />
          </div>
          {pos.pageNo} / {pos.pageCount}
        </div>
        {p.chips}
        <MuteToggle />
      </header>

      {/* 장이 바뀔 때마다 쪽 머리를 한 번 읽어 준다(카드 포함 — 카드엔 who 줄이 없어 화면 밖 한 줄로) */}
      <p class="sr" aria-live="polite">
        {label}
      </p>
      <div class="spread">
        {page.kind === 'card' ? (
          <article class={`meaning ${turn}`} aria-label={label}>
            <div class="seal">정답!</div>
            <div class="kind">{[page.word.type, `${owner}의 스케치북 ${pos.pageNo}쪽`].filter(Boolean).join(' · ')}</div>
            <div class="word">{page.word.text}</div>
            <dl>
              <div>
                <dt>뜻</dt>
                <dd>{page.word.meaning}</dd>
              </div>
              {page.word.example.trim() && (
                <div>
                  <dt>예문</dt>
                  <dd class="example">{page.word.example}</dd>
                </div>
              )}
            </dl>
          </article>
        ) : (
          <article class={`page ${page.kind === 'draw' ? '' : 'lined'} ${turn}`} aria-label={label}>
            <div class="coil" aria-hidden="true" />
            <div class="pagetabs" aria-hidden="true">
              {chainPages.map((x, j) => (
                <span key={j} class={j + 1 === pos.pageNo ? 'now' : ''}>
                  {x.kind === 'draw' && <Icon name="pencil" />}
                  {x.kind === 'guess' && <Icon name="message-square" />}
                  {x.kind === 'card' ? '뜻' : j + 1}
                </span>
              ))}
            </div>
            <div class="who">{label}</div>
            {page.kind === 'prompt' && <div class="guess prompt-page">{page.text}</div>}
            {page.kind === 'guess' && (
              <div class="guess">{page.entry.status === 'done' && !page.empty ? <q>{guessText(page.entry, page.empty)}</q> : <span class="none">{guessText(page.entry, page.empty)}</span>}</div>
            )}
            {page.kind === 'draw' && (
              <div class="pic">
                <Picture blob={pictureOf(page.entry, p.image)} alt={`${p.nameOf(page.entry.bySlot)} 그림`} />
              </div>
            )}
            {isGap(p.pages, i) && (
              <div class="fallback">
                <Icon name="image-off" />
                {FALLBACK_NOTE}
              </div>
            )}
          </article>
        )}
      </div>

      <footer class="review-foot">
        {p.review === 'timer' ? (
          <>
            <div class="auto" aria-live="polite">
              {p.reviewSeconds}초마다 다음 쪽으로 넘어가요
            </div>
            <div class="bar auto-bar" aria-hidden="true">
              <i key={p.page} style={{ animationDuration: `${p.reviewSeconds}s` }} />
            </div>
          </>
        ) : (
          <div class="auto" aria-live="polite">
            {p.onNext ? '다 봤으면 넘겨 주세요' : '방장이 다음 쪽으로 넘길 거예요'}
          </div>
        )}
        {p.onNext && (
          <button type="button" class="btn primary press" onClick={p.onNext}>
            {lastOfAll ? '스티커 붙이기' : '다음 쪽'}
            <Icon name="chevron-right" size="lg" />
          </button>
        )}
      </footer>
    </section>
  );
}
