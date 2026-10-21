// 화면 16 교사 목록 만들기 (PRD §6-16·§7.6). 3-cartoon-book 시안의 방 만들기 부품(.screen·.topbar·fieldset·.opt·.btn·.help)을 그대로 쓴다.
import { useMemo, useRef, useState } from 'preact/hooks';
import { buildLink, copyText, encodeList, HASH_MAX, parseLines, type ListMode } from '../../teacher/list';
import './teacher.css';

const PLACEHOLDER = '원숭이도 나무에서 떨어진다 | 잘하는 사람도 실수할 때가 있다 | 달리기 1등 민수도 오늘은 넘어졌다';

export interface TeacherListScreenProps {
  onBack: () => void;
}

export function TeacherListScreen({ onBack }: TeacherListScreenProps) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<ListMode>('add');
  const [copy, setCopy] = useState<'idle' | 'ok' | 'fail'>('idle');
  const linkRef = useRef<HTMLTextAreaElement>(null);

  const { items, errors } = useMemo(() => parseLines(text), [text]);
  const enc = useMemo(() => (items.length ? encodeList(mode, items) : null), [mode, items]);
  const link = enc?.ok ? buildLink(enc.hash) : '';

  async function onCopy() {
    if (await copyText(link)) return setCopy('ok');
    setCopy('fail');
    linkRef.current?.focus();
    linkRef.current?.select();
  }

  return (
    <section class="screen screen-teacher" aria-label="문제 목록 만들기">
      <header class="topbar">
        <div class="title display">문제 목록 만들기</div>
      </header>
      <form class="form" onSubmit={(e) => e.preventDefault()}>
        <fieldset class="span2">
          <legend>속담 붙여넣기</legend>
          <div class="field">
            <label for="teacher-lines" class="sr">속담 목록</label>
            <textarea
              id="teacher-lines"
              class="teacher-lines"
              rows={8}
              value={text}
              placeholder={PLACEHOLDER}
              aria-describedby="teacher-lines-help"
              spellcheck={false}
              onInput={(e) => {
                setText(e.currentTarget.value);
                setCopy('idle');
              }}
            />
            <div class="help" id="teacher-lines-help">
              <span>한 줄에 속담 | 뜻 | 예문 · 예문은 비워도 돼요</span>
              <span>속담 30자 · 뜻 60자 · 예문 80자까지</span>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>어떻게 쓸까요</legend>
          <div class="opts">
            {(
              [
                ['add', '기본 목록에 더하기'],
                ['only', '이 목록만'],
              ] as const
            ).map(([v, label]) => (
              <label key={v} class={mode === v ? 'opt press is-checked' : 'opt press'}>
                <input
                  type="radio"
                  name="teacher-mode"
                  value={v}
                  class="sr"
                  checked={mode === v}
                  onChange={() => {
                    setMode(v);
                    setCopy('idle');
                  }}
                />
                {label}
              </label>
            ))}
          </div>
          <div class="help">"이 목록만"이면 방 만들기에서 수준을 고르지 않아요</div>
        </fieldset>

        <fieldset>
          <legend>확인 결과</legend>
          <p class="teacher-summary" role="status" aria-live="polite">
            통과 {items.length}개{errors.length > 0 && ` · 고칠 줄 ${errors.length}개`}
          </p>
          {errors.length > 0 && (
            <table class="teacher-errors">
              <thead>
                <tr>
                  <th scope="col">줄</th>
                  <th scope="col">고칠 점</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e) => (
                  <tr key={e.line}>
                    <td>{e.line}</td>
                    <td>{e.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {errors.length > 0 && <div class="help">고칠 줄은 링크에 들어가지 않아요</div>}
          {enc && !enc.ok && (
            <p class="teacher-alert" role="alert">
              {enc.maxItems}개까지만 담을 수 있어요. 줄을 지우거나 뜻·예문을 짧게 줄여 주세요.
            </p>
          )}
          {enc?.ok && (
            <div class="help">
              <span>
                링크 길이 {enc.hash.length.toLocaleString()} / {HASH_MAX.toLocaleString()}자
              </span>
            </div>
          )}
          {enc?.ok && enc.warning && <p class="teacher-warn">{enc.warning}</p>}
        </fieldset>

        <fieldset class="span2">
          <legend>공유 링크</legend>
          <div class="field">
            <label for="teacher-link" class="sr">공유 링크</label>
            <textarea id="teacher-link" ref={linkRef} class="teacher-link" rows={3} readOnly value={link} placeholder="속담을 넣으면 링크가 생겨요" aria-describedby="teacher-link-help" />
            <div class="help" id="teacher-link-help">
              <span>복사한 링크를 QR 도구나 클래스룸에 붙여 넣으세요</span>
            </div>
          </div>
          <p class="teacher-copy" role="status" aria-live="polite">
            {copy === 'ok' ? '복사했어요' : copy === 'fail' ? '길게 눌러 복사하세요' : ''}
          </p>
        </fieldset>

        <div class="form-foot">
          <button type="button" class="btn secondary press" onClick={onBack}>
            뒤로
          </button>
          <button type="button" class="btn primary press teacher-copy-btn" disabled={!link} onClick={onCopy}>
            링크 복사
          </button>
        </div>
      </form>
    </section>
  );
}
