// 효과음 4개(PRD §11). 파일은 assets/sfx/<이름>.<확장자> — 아직 없으면(에셋 보류) 조용히 건너뛴다.
import { useSound } from '../shared/sound';

export type Sfx = 'submit' | 'warn' | 'turn' | 'result';

const FILES = import.meta.glob('../../../assets/sfx/*.{mp3,m4a,ogg,wav,webm}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export function sfxUrl(name: Sfx, files: Record<string, string> = FILES): string | null {
  const k = Object.keys(files).find((p) => p.slice(p.lastIndexOf('/') + 1).startsWith(`${name}.`));
  return k ? files[k]! : null;
}

/** on = 방 설정 소리 && 기기 음소거 아님. iOS 첫 터치 전 재생 거부·미지원은 무시. */
export function playSfx(name: Sfx, on: boolean, files?: Record<string, string>, make: (u: string) => HTMLAudioElement = (u) => new Audio(u)): void {
  if (!on) return;
  const u = sfxUrl(name, files);
  if (!u) return;
  try {
    make(u).play()?.catch(() => {});
  } catch {
    // Audio 미지원 — 소리 없이 진행
  }
}

/** settingSound = Settings.sound(방 설정). 기기 음소거는 공용 토글에서 읽는다. */
export function useSfx(settingSound: boolean): (name: Sfx) => void {
  const { muted } = useSound();
  return (name) => playSfx(name, settingSound && !muted);
}
