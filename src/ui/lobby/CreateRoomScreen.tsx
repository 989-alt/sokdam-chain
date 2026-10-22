// 화면 2 방 만들기. 시안 3-cartoon-book ⑥: fieldset/legend, 필드 아래 도움말, aria-pressed 토글.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { TeacherList } from '../../app/teacher-state';
import type { Settings } from '../../net/protocol';
import { Icon } from '../shared/Icon';
import { nameToSend } from '../shared/input';
import { createFailMessage } from '../shared/messages';
import { HAS_SFX } from '../shared/sound';
import { Topbar } from '../shared/Topbar';
import { CATEGORIES, DEFAULT_SETTINGS, DRAW_SECONDS, LEVELS, REVIEW_SECONDS } from './labels';
import { NameField } from './NameField';

type Props = {
  teacher: TeacherList | null;
  /** 성공하면 true(앱이 대기실로 보낸다). */
  onCreate: (name: string, settings: Settings) => Promise<boolean>;
  onBack: () => void;
  onPassAround: () => void;
};

function Opt({ on, onClick, children }: { on: boolean; onClick: () => void; children: ComponentChildren }) {
  return (
    <button type="button" class="opt press" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

export function CreateRoomScreen({ teacher, onCreate, onBack, onPassAround }: Props) {
  const [name, setName] = useState('');
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const set = (p: Partial<Settings>) => setS({ ...s, ...p });
  const only = teacher?.mode === 'only';
  const send = nameToSend(name);

  const submit = async () => {
    if (!send || busy) return;
    setBusy(true);
    setFailed(false);
    const listSource = !teacher ? 'default' : only ? 'teacher-only' : 'teacher-add';
    const ok = await onCreate(send, { ...s, category: only ? null : s.category, level: only ? null : s.level, listSource });
    setBusy(false);
    setFailed(!ok);
  };

  return (
    <section class="screen screen-create" aria-label="방 만들기">
      <Topbar title="방 만들기">
        {teacher && (
          <span class="chip soft teacher-badge">
            <Icon name="book-open" size="sm" />
            선생님 목록 사용 중 ({teacher.items.length}개)
          </span>
        )}
      </Topbar>
      {failed && (
        <div class="banner warn" role="status" aria-live="polite">
          <Icon name="triangle-alert" />
          <span>{createFailMessage}</span>
          <button type="button" class="btn secondary press" onClick={onPassAround}>
            돌려쓰기
          </button>
        </div>
      )}
      <form
        class="form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset>
          <legend>내 이름</legend>
          <NameField id="host-name" value={name} onChange={setName} />
        </fieldset>
        {!only && (
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
        {!only && (
          <fieldset class="level">
            <legend>수준</legend>
            <div class="opts" role="group" aria-label="수준">
              {LEVELS.map((l) => (
                <Opt key={l.v} on={s.level === l.v} onClick={() => set({ level: l.v })}>
                  {l.label}
                </Opt>
              ))}
            </div>
            {teacher && <div class="help">어느 묶음·수준을 골라도 선생님 목록이 함께 나와요</div>}
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
          {only && <div class="help">선생님 목록만 쓸 때는 묶음·수준을 고르지 않아요</div>}
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
        <fieldset>
          <legend>결과 보기</legend>
          <div class="opts" role="group" aria-label="결과 보기 방식">
            {REVIEW_SECONDS.map((n) => (
              <Opt key={n} on={s.review === 'timer' && s.reviewSeconds === n} onClick={() => set({ review: 'timer', reviewSeconds: n })}>
                {n}초마다 자동 넘김
              </Opt>
            ))}
            <Opt on={s.review === 'manual'} onClick={() => set({ review: 'manual' })}>
              방장이 넘김
            </Opt>
          </div>
        </fieldset>
        {HAS_SFX && (
          <fieldset>
            <legend>소리</legend>
            <div class="opts" role="group" aria-label="소리">
              <Opt on={s.sound} onClick={() => set({ sound: true })}>
                켜기
              </Opt>
              <Opt on={!s.sound} onClick={() => set({ sound: false })}>
                끄기
              </Opt>
            </div>
            <div class="help">방 전체 설정이에요 · 내 기기만 끄려면 위 소리 버튼을 눌러 주세요</div>
          </fieldset>
        )}
        <div class="form-foot">
          <button type="button" class="btn secondary press" disabled={busy} onClick={onBack}>
            <Icon name="chevron-left" />
            뒤로
          </button>
          <button type="submit" class="btn primary press grow" disabled={!send || busy} aria-busy={busy}>
            {busy ? <span class="spin" aria-hidden="true" /> : <Icon name="play" size="lg" />}
            {busy ? '방 만드는 중' : '방 만들기'}
          </button>
        </div>
      </form>
    </section>
  );
}
