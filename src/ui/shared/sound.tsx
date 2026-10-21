// 기기별 음소거(메모리만, 새로고침하면 다시 켬). 방 설정의 소리(settings.sound)와 둘 다 켜져야 효과음이 난다.
import { createContext, type ComponentChildren } from 'preact';
import { useContext, useState } from 'preact/hooks';
import { Icon } from './Icon';

type Sound = { muted: boolean; setMuted: (m: boolean) => void };
const SoundContext = createContext<Sound>({ muted: false, setMuted: () => {} });

export function SoundProvider({ children }: { children: ComponentChildren }) {
  const [muted, setMuted] = useState(false);
  return <SoundContext.Provider value={{ muted, setMuted }}>{children}</SoundContext.Provider>;
}

/** muted = 이 기기 음소거. 효과음 재생 조건: settings.sound && !muted. */
export const useSound = (): Sound => useContext(SoundContext);

/** 공용 헤더의 음소거 토글. */
export function MuteToggle() {
  const { muted, setMuted } = useSound();
  return (
    <button type="button" class="chip soft press mute" aria-pressed={muted} onClick={() => setMuted(!muted)}>
      <Icon name={muted ? 'volume-x' : 'volume-2'} size="sm" />
      {muted ? '소리 끔' : '소리 켬'}
    </button>
  );
}
