// 화면 4 대기실. 시안 3-cartoon-book ⑤: 방 코드 카드 + 책상 위 스케치북 표지 6자리 + 시작(방장만).
import { useState } from 'preact/hooks';
import title from '../../../assets/img/KA-02-title.png';
import wait from '../../../assets/img/KA-03-mascot-faces/wait.png';
import type { LobbyPlayer, Settings } from '../../net/protocol';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../net/protocol';
import { copyText } from '../../teacher/list';
import { Icon } from '../shared/Icon';
import { Topbar } from '../shared/Topbar';
import { settingsSummary } from './labels';

type Props = {
  code: string;
  players: LobbyPlayer[];
  mySlot: number | null;
  settings: Settings | null;
  isHost: boolean;
  canStart: boolean;
  startError: string | null;
  onStart: () => void;
  onLeave: () => void;
};

/** 시작 버튼 아래 이유 문장. */
export function startReason(players: LobbyPlayer[]): string {
  const n = players.length;
  const off = players.filter((p) => !p.connected).map((p) => p.name);
  const offNote = off.length ? ` · 연결 끊김: ${off.join(', ')}` : '';
  if (n < MIN_PLAYERS) return `${MIN_PLAYERS}명부터 시작할 수 있어요 · 지금 ${n}명${offNote}`;
  return `모두 모였으면 시작해요 · 최대 ${MAX_PLAYERS}명${offNote}`;
}

export function LobbyScreen({ code, players, mySlot, settings, isHost, canStart, startError, onStart, onLeave }: Props) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const me = players.find((p) => p.slot === mySlot);
  const seats = Array.from({ length: MAX_PLAYERS }, (_, i) => players[i] ?? null);

  return (
    <section class="screen screen-lobby" aria-label="대기실">
      <Topbar title="속담 이어그리기">
        <span class="chip soft" aria-live="polite">
          <Icon name="users" size="sm" />
          {players.length} / {MAX_PLAYERS}명
        </span>
        {me && (
          <span class="chip player">
            <i aria-hidden="true" />
            {me.name}
            {isHost ? ' · 방장' : ''}
          </span>
        )}
      </Topbar>
      <div class="lobby">
        <div class="tile code-card">
          <img src={title} alt="" class="code-art" width={1724} height={800} />
          <div class="lbl">친구에게 이 방 코드를 알려 주세요</div>
          <div class="code" role="img" aria-label={`방 코드 ${code.split('').join(' ')}`}>
            {code}
          </div>
          <button type="button" class="btn secondary press" onClick={async () => setCopied(await copyText(code))}>
            <Icon name="copy" />
            코드 복사
          </button>
          {copied !== null && (
            <p class="help" role="status">
              {copied ? '복사했어요' : '코드를 보고 직접 알려 주세요'}
            </p>
          )}
          {settings && (
            <div class="summary" aria-label="설정 요약">
              {settingsSummary(settings).map((t) => (
                <span key={t} class="chip soft">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <div class="desk-wrap">
          {players.length <= 1 && (
            <div class="lobby-empty tile">
              <img src={wait} alt="마스코트 부엉이가 턱을 괴고 기다리는 그림" width={506} height={529} />
              <span>아직 아무도 없어요. 방 코드를 친구에게 알려 주세요</span>
            </div>
          )}
          <ul class="desk" aria-label="참가자">
            {seats.map((p, i) =>
              p ? (
                <li key={`p${p.slot}`} class={`bookcard c${(p.slot % 6) + 1}${p.connected ? '' : ' off'}`} data-slot={p.slot}>
                  {p.slot === 0 && <span class="host">방장</span>}
                  <div class={p.connected ? 'nametag' : 'nametag off'}>
                    <i class={p.connected ? 'dotstate' : 'dotstate off'} aria-hidden="true" />
                    {p.name}
                    {!p.connected && <span class="sr">연결 끊김</span>}
                  </div>
                </li>
              ) : (
                <li key={`e${i}`} class="bookcard empty">
                  빈 자리
                </li>
              ),
            )}
          </ul>
        </div>
        <div class="startbar">
          {isHost ? (
            <>
              <button
                type="button"
                class="btn primary press start"
                aria-disabled={!canStart}
                aria-describedby="start-reason"
                onClick={() => canStart && onStart()}
              >
                <Icon name="play" size="lg" />
                시작하기
              </button>
              <div class="reason" id="start-reason">
                {startError ?? startReason(players)}
              </div>
            </>
          ) : (
            <div class="reason">방장이 시작하기를 기다려요</div>
          )}
          <button type="button" class="btn secondary press" onClick={onLeave}>
            <Icon name="log-out" />
            나가기
          </button>
        </div>
      </div>
    </section>
  );
}
