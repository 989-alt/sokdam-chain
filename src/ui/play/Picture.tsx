// 받은 그림(Blob) 한 장. 없으면 "그림 없음" 자리(UI-05). 그리기 제시·답 쓰기·결과 보기·투표가 같이 쓴다.
import { useEffect, useMemo } from 'preact/hooks';
import missingImg from '../../../assets/img/UI-05-missing.webp';
import './play.css';

export function Picture({ blob, alt, missingText = '그림 없음' }: { blob: Blob | null | undefined; alt: string; missingText?: string }) {
  // useMemo: 첫 렌더부터 주소가 있어야 자리표시자가 깜빡이지 않는다
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => url && URL.revokeObjectURL(url), [url]);
  if (!url)
    return (
      <div class="missing" role="img" aria-label={missingText}>
        <img src={missingImg} alt="" width={1254} height={1254} />
        <span>{missingText}</span>
      </div>
    );
  return <img class="drawing" src={url} alt={alt} width={800} height={600} />;
}
