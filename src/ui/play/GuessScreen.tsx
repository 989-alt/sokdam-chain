// 화면 6 답 쓰기(+ 제출 뒤 같은 쪽이 기다리기로). 시간 제한 없음. 온라인·돌려쓰기 공용 — props·콜백만.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { Input } from '../../engine';
import { Icon } from '../shared/Icon';
import { Topbar } from '../shared/Topbar';
import { Picture } from './Picture';
import { ANSWER_MAX, FALLBACK_NOTE, guessAction } from './prompt';
import type { Sfx } from './sfx';
import './play.css';

export type GuessScreenProps = {
  /** 보통 image(앞 그림). 앞 그림이 없으면 엔진이 그 앞 글을 준다(text/meaning + fallbackNote). */
  input: Input;
  image: (imgId: string) => Blob | undefined;
  submitted: boolean;
  /** 앞뒤 공백을 뗀 답(빈 문자열 = 답 없음). 한 번만 부른다. */
  onSubmit: (text: string) => void;
  /** 다시 연결하는 중 — 입력·제출을 잠근다. */
  offline?: boolean;
  sound: (s: Sfx) => void;
  chips?: ComponentChildren;
  waiting?: ComponentChildren;
};

export function GuessScreen(p: GuessScreenProps) {
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState(false);
  const done = sent || p.submitted;

  const submit = (e: Event) => {
    e.preventDefault();
    if (done || p.offline) return;
    if (guessAction(text, confirming) === 'confirm') return setConfirming(true);
    setSent(true);
    p.sound('submit');
    p.onSubmit(text.trim());
  };

  return (
    <section class="screen screen-guess play-guess" aria-label="답 쓰기 차례">
      <Topbar title="속담 이어그리기">{p.chips}</Topbar>
      <div class="guess-book handoff-in">
        <article class="page" aria-label="앞 사람 것">
          <div class="coil" aria-hidden="true" />
          <div class="who">{p.input.kind === 'image' ? '앞 사람 그림' : '앞 사람 것'}</div>
          {p.input.fallbackNote && (
            <div class="fallback">
              <Icon name="image-off" />
              {FALLBACK_NOTE}
            </div>
          )}
          {p.input.kind === 'image' ? (
            <Picture blob={p.input.imgId ? p.image(p.input.imgId) : null} alt="앞 사람이 그린 그림" />
          ) : (
            <div class="guess">
              <q>{p.input.text}</q>
            </div>
          )}
        </article>

        <form class="page lined" aria-label="내 답 쓰기" onSubmit={submit}>
          <div class="coil" aria-hidden="true" />
          <div class="who">내가 쓰는 답</div>
          <div class="ask">이 그림이 나타내는 속담·관용표현을 써 보세요</div>
          {done ? (
            p.waiting
          ) : (
            <>
              <div class="field">
                <label for="answer">내 답</label>
                <input
                  id="answer"
                  type="text"
                  maxLength={ANSWER_MAX}
                  placeholder="모르면 그림에서 느껴지는 대로 써도 돼요"
                  value={text}
                  onInput={(e) => {
                    setText(e.currentTarget.value);
                    setConfirming(false);
                  }}
                  aria-describedby="answer-help"
                  autocomplete="off"
                  disabled={p.offline}
                  enterkeyhint="send"
                />
                <div class="help" id="answer-help">
                  <span role={confirming ? 'alert' : undefined} class={confirming ? 'confirm' : ''}>
                    {confirming ? '비워 두고 넘어갈까요?' : '시간 제한 없어요 · 나쁜 말은 ●로 가려요'}
                  </span>
                  <span>
                    {text.length} / {ANSWER_MAX}자
                  </span>
                </div>
              </div>
              <button type="submit" class="submit press" disabled={p.offline}>
                <Icon name="send" size="lg" />
                <span>{confirming ? '네, 비워 두고 넘어가요' : '답 보내기'}</span>
              </button>
            </>
          )}
        </form>
      </div>
    </section>
  );
}
