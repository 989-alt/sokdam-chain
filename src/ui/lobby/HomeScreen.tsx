// 화면 1 홈: 모드 선택(여럿이 각자 기기로 / 기기 한 대 돌려쓰기), 이어하기, 교사용 작은 링크.
import { useState } from 'preact/hooks';
import title from '../../../assets/img/KA-02-title.png';
import { hrefOf } from '../../app/router';
import { Icon } from '../shared/Icon';
import { Topbar } from '../shared/Topbar';

type Props = {
  /** 교사 링크 목록 개수. 없으면 null. */
  teacherCount: number | null;
  /** 교사 링크 해석 실패 문구. */
  toast: string | null;
  canResume: boolean;
  /** 실패면 안내 문구. */
  onResume: () => Promise<string | null>;
};

export function HomeScreen({ teacherCount, toast, canResume, onResume }: Props) {
  const [busy, setBusy] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  return (
    <section class="screen home" aria-label="처음 화면">
      <Topbar title="속담 이어그리기">
        {teacherCount !== null && (
          <span class="chip soft teacher-badge">
            <Icon name="book-open" size="sm" />
            선생님 목록 사용 중 ({teacherCount}개)
          </span>
        )}
      </Topbar>
      {toast && (
        <div class="banner warn toast" role="alert">
          <Icon name="triangle-alert" />
          <span>{toast}</span>
        </div>
      )}
      <div class="hero">
        <img src={title} alt="" width={1724} height={800} />
      </div>
      {(canResume || resumeError) && (
        <div class="tile mode resume">
          {canResume && (
            <button
              type="button"
              class="btn primary press"
              disabled={busy}
              aria-busy={busy}
              onClick={async () => {
                setBusy(true);
                setResumeError(await onResume());
                setBusy(false);
              }}
            >
              {busy ? <span class="spin" aria-hidden="true" /> : <Icon name="refresh-cw" size="lg" />}
              {busy ? '다시 들어가는 중' : '이어하기'}
            </button>
          )}
          {resumeError && (
            <p class="banner warn" role="status">
              {resumeError}
            </p>
          )}
        </div>
      )}
      <div class="modes">
        <section class="tile mode" aria-labelledby="mode-online">
          <h2 id="mode-online">여럿이 각자 기기로</h2>
          <p>한 사람이 방을 만들고, 친구들은 방 코드로 들어와요. 4~6명.</p>
          <div class="acts">
            <a class="btn primary press" href={hrefOf('create')}>
              <Icon name="play" size="lg" />방 만들기
            </a>
            <a class="btn secondary press" href={hrefOf('join')}>
              <Icon name="users" />방 들어가기
            </a>
          </div>
        </section>
        <section class="tile mode" aria-labelledby="mode-pass">
          <h2 id="mode-pass">기기 한 대 돌려쓰기</h2>
          <p>기기 하나를 차례로 넘기며 해요. 인터넷이 없어도 돼요. 3~6명.</p>
          <div class="acts">
            <a class="btn secondary press" href={hrefOf('pass')}>
              <Icon name="book-open" />돌려쓰기 시작
            </a>
          </div>
        </section>
      </div>
      <a class="linkbtn" href={hrefOf('teacher')}>
        선생님용 · 문제 목록 만들기
      </a>
    </section>
  );
}
