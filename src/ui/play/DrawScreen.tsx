// 화면 5 그리기. 온라인·돌려쓰기 공용 — net 을 모르고 props·콜백만 받는다.
// 부모는 칸(차례)마다 key 를 바꿔 새로 마운트한다(그림·타이머·재전송 횟수가 칸 단위).
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DrawingCanvas } from '../../canvas/DrawingCanvas';
import { exportDrawing } from '../../canvas/export';
import { Drawing } from '../../canvas/model';
import type { Input } from '../../engine';
import { Icon } from '../shared/Icon';
import { Topbar } from '../shared/Topbar';
import { Picture } from './Picture';
import { drawPrompt } from './prompt';
import type { Sfx } from './sfx';
import { timerView } from './timer';
import './play.css';

export type DrawScreenProps = {
  input: Input;
  /** 체인 0단계(속담 원문·뜻을 처음 보는 칸). */
  first: boolean;
  /** 앞 그림(대체 입력이 그림일 때). */
  image: (imgId: string) => Blob | undefined;
  totalSeconds: number;
  /** 남은 ms(null = 기한 없음). 0 이 되면 화면이 스스로 한 번 내보내 onSubmit 한다. */
  remainingMs: () => number | null;
  /** 다음 차례 이름 — 제출 버튼 부제 "· ○○에게 넘겨요". */
  nextName?: string | null;
  /** true 면 그리기 대신 waiting 을 보여 준다(이 컴포넌트는 칸 끝까지 마운트 유지 — 재전송에 그림이 필요). */
  submitted: boolean;
  /** 받는 쪽이 그림을 거부함(온라인 too-large·bad-image). submitted 가 false 로 돌아오면 2번까지 스스로 다시 보낸다. */
  error?: string | null;
  onSubmit: (blob: Blob) => void;
  sound: (s: Sfx) => void;
  /** 상단 바 칩(책·이름 등). */
  chips?: ComponentChildren;
  waiting?: ComponentChildren;
};

const RING = 2 * Math.PI * 70;
const RETRIES = 2;

export function DrawScreen(p: DrawScreenProps) {
  const drawing = useMemo(() => new Drawing(), []);
  const [, tick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const r = useRef({ busy: false, auto: false, warned: false, retries: 0 });
  const tv = timerView(p.remainingMs(), p.totalSeconds);
  const prompt = drawPrompt(p.input, p.first);

  const send = async () => {
    if (r.current.busy) return;
    r.current.busy = true;
    setBusy(true);
    try {
      const blob = await exportDrawing(drawing);
      p.sound('submit');
      p.onSubmit(blob);
    } catch {
      r.current.busy = false;
      setBusy(false);
      setMsg('그림을 만들지 못했어요. 다시 눌러 주세요');
    }
  };

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (p.submitted) return;
    if (tv.level === 'danger' && tv.secs > 0 && !r.current.warned) {
      r.current.warned = true;
      p.sound('warn');
    }
    if (tv.secs === 0 && !r.current.auto) {
      r.current.auto = true;
      void send();
    }
  });

  useEffect(() => {
    if (!p.error || p.submitted) return;
    r.current.busy = false;
    setBusy(false);
    if (r.current.retries < RETRIES) {
      r.current.retries++;
      setMsg('그림을 다시 보내고 있어요');
      void send();
    } else setMsg('그림을 보내지 못했어요. 한 번 더 눌러 주세요');
  }, [p.error, p.submitted]);

  return (
    <section class="screen screen-draw play-draw" aria-label="그리기 차례">
      <Topbar title="속담 이어그리기">{p.chips}</Topbar>
      {p.submitted ? (
        p.waiting
      ) : (
        <div class="book handoff-in">
          <div class="coil" aria-hidden="true" />
          <div class="notice" role="note">
            <Icon name="triangle-alert" />
            그림에 글자를 쓰지 마세요
          </div>
          <div class="head">
            <div class="prompt">
              <div class="label">
                <Icon name={p.first ? 'book-open' : prompt.imgId ? 'pencil' : 'message-square'} size="sm" />
                {prompt.label}
              </div>
              {prompt.imgId ? (
                <div class="prompt-pic">
                  <Picture blob={p.image(prompt.imgId)} alt="앞 사람 그림" />
                </div>
              ) : (
                <div class={prompt.long ? 'text long' : 'text'}>{prompt.text}</div>
              )}
              {(msg ?? prompt.hint) && (
                <div class={msg ? 'hint err' : 'hint'} role={msg ? 'alert' : undefined}>
                  {msg ?? prompt.hint}
                </div>
              )}
            </div>
            <div class={`timer ${tv.level === 'ok' ? '' : tv.level}`} role="timer" aria-label={`남은 시간 ${tv.secs}초`}>
              <svg class="ring" viewBox="0 0 160 160" aria-hidden="true">
                <circle class="track" cx="80" cy="80" r="70" />
                <circle class="fill" cx="80" cy="80" r="70" stroke-dashoffset={RING * (1 - tv.frac)} />
              </svg>
              <div class="num">{tv.secs}</div>
              <div class="unit">
                초<br />
                남음
              </div>
            </div>
          </div>
          <DrawingCanvas drawing={drawing} disabled={busy} />
          {/* role=timer 는 aria-live off — 10초 진입을 한 번만 읽어 준다 */}
          <p class="sr" aria-live="polite">
            {r.current.warned ? '10초 남았어요' : ''}
          </p>
          <button type="button" class="submit press" disabled={busy} aria-busy={busy} onClick={() => void send()}>
            <Icon name="send" size="lg" />
            <span>{busy ? '보내는 중이에요' : '다 그렸어요'}</span>
            {!busy && p.nextName && <small>· {p.nextName}에게 넘겨요</small>}
          </button>
        </div>
      )}
    </section>
  );
}
