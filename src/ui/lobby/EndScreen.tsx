// 화면 12 종료 안내. 세션 키 삭제는 net 층이 한다 — 여기는 문구와 버튼만.
import { useState } from 'preact/hooks';
import sorry from '../../../assets/img/KA-03-mascot-faces/sorry.png';
import { Icon } from '../shared/Icon';
import { endText, type EndKind } from '../shared/messages';

type Props = { kind: EndKind; onHome: () => void; onResume?: () => Promise<string | null> };

export function EndScreen({ kind, onHome, onResume }: Props) {
  const t = endText[kind];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section class="screen screen-end" aria-label="종료 안내">
      <div class="tile end">
        <img src={sorry} alt="마스코트 부엉이가 미안한 표정으로 날개를 모은 그림" width={509} height={573} />
        <h1 class="h">{t.title}</h1>
        <p>{t.body}</p>
        {error && (
          <p class="banner" role="alert">
            {error}
          </p>
        )}
        {onResume && (
          <button
            type="button"
            class="btn secondary press"
            disabled={busy}
            aria-busy={busy}
            onClick={async () => {
              setBusy(true);
              setError(await onResume());
              setBusy(false);
            }}
          >
            <Icon name="refresh-cw" />
            이어하기
          </button>
        )}
        <button type="button" class="btn primary press" onClick={onHome}>
          <Icon name="house" size="lg" />
          홈으로
        </button>
      </div>
    </section>
  );
}
