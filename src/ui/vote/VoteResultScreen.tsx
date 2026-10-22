// 화면 11 투표 결과: 동점 모두, 그린 사람·쓴 사람 이름. "한 판 더"는 onAgain 이 있을 때만(방장), "나가기"는 전원.
import { useEffect, useState } from 'preact/hooks';
import cheer from '../../../assets/img/KA-03-mascot-faces/cheer.webp';
import type { EntryKey, ReviewPage } from '../../engine';
import { Picture } from '../play/Picture';
import type { Sfx } from '../play/sfx';
import { Icon } from '../shared/Icon';
import { Topbar } from '../shared/Topbar';
import { findEntries } from './vote';
import './vote.css';

export type VoteResultScreenProps = {
  pages: ReviewPage[];
  result: { bestDrawings: EntryKey[]; bestAnswers: EntryKey[] };
  nameOf: (slot: number) => string;
  image: (imgId: string) => Blob | undefined;
  /** 방장만. 실패하면 보여 줄 문장을 돌려준다(성공 null). */
  onAgain?: () => string | null;
  onLeave: () => void;
  sound: (s: Sfx) => void;
};

export function VoteResultScreen(p: VoteResultScreenProps) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => p.sound('result'), []);
  const drawings = findEntries(p.pages, p.result.bestDrawings);
  const answers = findEntries(p.pages, p.result.bestAnswers);

  return (
    <section class="screen play-result" aria-label="투표 결과">
      <Topbar title="투표 결과" />
      <div class="result-grid">
        <section class="tile result-box" aria-labelledby="best-drawing">
          <h2 id="best-drawing" class="vote-h">
            <span class="sticker-demo" aria-hidden="true">
              <Icon name="star" />
            </span>
            베스트 그림
          </h2>
          {drawings.length ? (
            <ul class="best">
              {drawings.map((x) => (
                <li key={x.key}>
                  <Picture blob={x.entry.imgId ? p.image(x.entry.imgId) : null} alt={`${p.nameOf(x.entry.bySlot)} 그림`} />
                  <span class="who-best">그린 사람 · {p.nameOf(x.entry.bySlot)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="vote-none">받은 스티커가 없어요</p>
          )}
        </section>
        <section class="tile result-box" aria-labelledby="best-answer">
          <h2 id="best-answer" class="vote-h">
            <span class="sticker-demo" aria-hidden="true">
              <Icon name="star" />
            </span>
            베스트 답
          </h2>
          {answers.length ? (
            <ul class="best">
              {answers.map((x) => (
                <li key={x.key}>
                  <span class="guess cand-guess">
                    <q>{x.entry.text}</q>
                  </span>
                  <span class="who-best">쓴 사람 · {p.nameOf(x.entry.bySlot)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="vote-none">받은 스티커가 없어요</p>
          )}
        </section>
      </div>
      <img class="result-cheer" src={cheer} alt="날개를 들고 기뻐하는 부엉이" width={621} height={570} />
      {error && (
        <p class="banner" role="alert">
          {error}
        </p>
      )}
      <div class="result-foot">
        {p.onAgain && (
          <button type="button" class="btn primary press" onClick={() => setError(p.onAgain!())}>
            <Icon name="refresh-cw" size="lg" />한 판 더
          </button>
        )}
        <button type="button" class="btn secondary press" onClick={p.onLeave}>
          <Icon name="log-out" />
          나가기
        </button>
      </div>
    </section>
  );
}
