// 공용 상단 바: 제목 + (칩 등) + 음소거 토글. 시안 .topbar.
import type { ComponentChildren } from 'preact';
import { MuteToggle } from './sound';

export function Topbar({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <header class="topbar">
      <h1 class="title display">{title}</h1>
      {children}
      <MuteToggle />
    </header>
  );
}
