// 화면 3 방 들어가기: 방 코드 6자리 + 이름.
import { useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { CODE_LEN, cleanCode, nameToSend } from '../shared/input';
import { Topbar } from '../shared/Topbar';
import { NameField } from './NameField';

type Props = {
  /** 실패면 안내 문구, 성공이면 null(앱이 대기실로 보낸다). */
  onJoin: (code: string, name: string) => Promise<string | null>;
  onBack: () => void;
};

export function JoinRoomScreen({ onJoin, onBack }: Props) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = nameToSend(name);
  const ready = code.length === CODE_LEN && !!send && !busy;

  return (
    <section class="screen screen-join" aria-label="방 들어가기">
      <Topbar title="방 들어가기" />
      <form
        class="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          setBusy(true);
          setError(null);
          setError(await onJoin(code, send));
          setBusy(false);
        }}
      >
        <fieldset>
          <legend>방 코드</legend>
          <div class="field">
            <label for="room-code" class="sr">
              방 코드 6자리
            </label>
            <input
              id="room-code"
              class="code-input"
              type="text"
              inputMode="numeric"
              autocomplete="off"
              pattern="[0-9]*"
              value={code}
              aria-describedby="room-code-help"
              onInput={(e) => {
                const v = cleanCode(e.currentTarget.value);
                e.currentTarget.value = v;
                setCode(v);
              }}
            />
            <div class="help" id="room-code-help">
              <span>방장 화면의 숫자 6자리</span>
              <span>
                {code.length} / {CODE_LEN}
              </span>
            </div>
          </div>
        </fieldset>
        <fieldset>
          <legend>내 이름</legend>
          <NameField id="join-name" value={name} onChange={setName} />
        </fieldset>
        {error && (
          <div class="banner span2" role="alert">
            <Icon name="triangle-alert" />
            <span>{error}</span>
          </div>
        )}
        <div class="form-foot">
          <button type="button" class="btn secondary press" onClick={onBack}>
            <Icon name="chevron-left" />
            뒤로
          </button>
          <button type="submit" class="btn primary press grow" disabled={!ready} aria-busy={busy}>
            {busy ? <span class="spin" aria-hidden="true" /> : <Icon name="users" size="lg" />}
            {busy ? '들어가는 중' : '들어가기'}
          </button>
        </div>
      </form>
    </section>
  );
}
