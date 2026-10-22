// 화면 7 기다리기: "n / N 제출" + 참가자(끊긴 사람 표시). 그리기·답 쓰기·투표 뒤에 같이 쓴다.
import mascot from '../../../assets/img/KA-01-mascot.webp';
import hourglass from '../../../assets/img/UI-04-hourglass.webp';

export type WaitingPlayer = { name: string; connected: boolean };

/** count 가 없으면(투표 등) 문구만. */
export function WaitingPanel({ count, title, players }: { count?: { submitted: number; total: number } | null; title: string; players: WaitingPlayer[] }) {
  return (
    <div class="waiting" role="status" aria-live="polite">
      <img src={mascot} alt="마커를 들고 응원하는 부엉이" width={1145} height={1374} />
      <div>
        <div class="big">{count ? `${count.submitted} / ${count.total} 제출` : title}</div>
        {count && <p class="wait-sub">{title}</p>}
        <ul>
          {players.map((p) => (
            <li key={p.name} class={p.connected ? '' : 'off'}>
              {p.connected ? p.name : `${p.name} · 연결 끊김`}
            </li>
          ))}
        </ul>
      </div>
      <img class="hourglass" src={hourglass} alt="" width={590} height={1077} />
    </div>
  );
}
