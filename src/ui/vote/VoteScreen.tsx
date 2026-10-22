// 화면 10 투표(스티커 붙이기): 베스트 그림 1 + 베스트 답 1, 내 것은 비활성 + "내 것". 온라인·돌려쓰기 공용.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import sticker from '../../../assets/img/UI-01-sticker-vote.webp';
import type { EntryKey, ReviewPage } from '../../engine';
import { Picture } from '../play/Picture';
import type { Sfx } from '../play/sfx';
import { ownerOf } from '../results/pages';
import { Icon } from '../shared/Icon';
import { Topbar } from '../shared/Topbar';
import { canSubmitVote, voteItems, type Keys, type VoteItem } from './vote';
import './vote.css';

export type VoteScreenProps = {
  pages: ReviewPage[];
  /** 고를 수 있는 키(자기 것 이미 빠짐). */
  candidates: Keys | null;
  mySlot: number | null;
  nameOf: (slot: number) => string;
  image: (imgId: string) => Blob | undefined;
  /** true 면 고르기 대신 waiting. */
  voted: boolean;
  /** 한 번만 부른다. 후보 없는 부문은 null. */
  onVote: (drawing: EntryKey | null, answer: EntryKey | null) => void;
  sound: (s: Sfx) => void;
  chips?: ComponentChildren;
  waiting?: ComponentChildren;
};

export function VoteScreen(p: VoteScreenProps) {
  const [drawing, setDrawing] = useState<EntryKey | null>(null);
  const [answer, setAnswer] = useState<EntryKey | null>(null);
  const [sent, setSent] = useState(false);
  // 방장이 표를 못 받았다고 돌려주면(voted true→false, 재합류 sync) 다시 고를 수 있게
  useEffect(() => {
    if (!p.voted) setSent(false);
  }, [p.voted]);
  const items = voteItems(p.pages, p.candidates, p.mySlot);
  const ok = canSubmitVote(items, drawing, answer);
  const by = (x: VoteItem, what: string) => `${p.nameOf(ownerOf(p.pages, x.chainIdx) ?? x.chainIdx)}의 스케치북 · ${p.nameOf(x.entry.bySlot)} ${what}`;

  const cand = (x: VoteItem, picked: EntryKey | null, pick: (k: EntryKey) => void, sx: number, body: ComponentChildren, what: string) => (
    <button
      type="button"
      key={x.key}
      class={x.enabled ? 'cand press' : 'cand'}
      disabled={!x.enabled}
      aria-pressed={x.enabled ? picked === x.key : undefined}
      onClick={() => pick(x.key)}
    >
      <span class="by">
        <i style={`background: var(--color-book-cover-${((ownerOf(p.pages, x.chainIdx) ?? x.chainIdx) % 6) + 1})`} />
        {by(x, what)}
        {x.mine && (
          <span class="mine">
            <Icon name="lock" />내 것
          </span>
        )}
      </span>
      {body}
      {x.enabled && (
        <span class="slot" style={`--sx: ${sx}; --sy: 0`}>
          <img src={sticker} alt="" />
        </span>
      )}
    </button>
  );

  return (
    <section class="screen screen-vote play-vote" aria-label="투표">
      <Topbar title="스티커 붙이기">{p.chips}</Topbar>
      {p.voted || sent ? (
        p.waiting
      ) : (
        <>
          <h2 class="vote-h">
            <span class="sticker-demo" aria-hidden="true">
              <Icon name="star" />
            </span>
            제일 재미있는 그림에 스티커 하나
          </h2>
          {items.drawings.length ? (
            <div class="vote-grid" role="group" aria-label="스티커 붙일 그림">
              {items.drawings.map((x) => cand(x, drawing, setDrawing, 0, <Picture blob={x.entry.imgId ? p.image(x.entry.imgId) : null} alt="" />, '그림'))}
            </div>
          ) : (
            <p class="vote-none">스티커 붙일 그림이 없어요</p>
          )}
          <h2 class="vote-h">
            <span class="sticker-demo" aria-hidden="true">
              <Icon name="star" />
            </span>
            제일 재미있는 답에 스티커 하나
          </h2>
          {items.answers.length ? (
            <div class="vote-grid" role="group" aria-label="스티커 붙일 답">
              {items.answers.map((x) =>
                cand(
                  x,
                  answer,
                  setAnswer,
                  1,
                  <span class="guess cand-guess">
                    <q>{x.entry.text}</q>
                  </span>,
                  '답',
                ),
              )}
            </div>
          ) : (
            <p class="vote-none">스티커 붙일 답이 없어요</p>
          )}
          <button
            type="button"
            class="submit press vote-submit"
            disabled={!ok}
            onClick={() => {
              if (!ok || sent) return;
              setSent(true);
              p.sound('submit');
              p.onVote(items.drawings.some((x) => x.enabled) ? drawing : null, items.answers.some((x) => x.enabled) ? answer : null);
            }}
          >
            <Icon name="check" size="lg" />
            <span>스티커 다 붙였어요</span>
          </button>
        </>
      )}
    </section>
  );
}
