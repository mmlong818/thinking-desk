'use client';

import { useEffect, useState } from 'react';
import { entityCount, textTail, type StreamProgress } from '@/lib/store/stream-progress';

// Live progress of a streamed AI action: elapsed time, how much of the answer has arrived (with
// a rough count of entries and a glimpse of the latest text), a retry notice, and a cancel button.

function useElapsedSeconds(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.round((now - since) / 1000));
}

function meta(p: StreamProgress | null, seconds: number): string {
  const parts = [`${seconds}s`];
  if (!p) return [...parts, '连接中'].join(' · ');
  if (p.attempt > 1) parts.push(`第 ${p.attempt} 次尝试`);
  if (!p.streaming) return [...parts, '该模型不支持流式输出，完成后一次显示'].join(' · ');
  if (p.text) parts.push(`已收到 ${p.text.length} 字`, `约 ${entityCount(p.text)} 条`);
  else parts.push('等待模型开始输出');
  return parts.join(' · ');
}

export function StreamProgressCard({ label, progress, onCancel }: {
  label: string;
  progress: StreamProgress | null;
  onCancel: () => void;
}) {
  const [since] = useState(() => Date.now());
  const seconds = useElapsedSeconds(progress?.startedAt ?? since);
  return (
    <div className="para-section">
      <div className="cop-card stream-progress" role="status" aria-live="polite">
        <div className="stream-progress-head">
          <span className="ai-spinner" />
          <span className="stream-progress-label">{label}</span>
          <span className="stream-progress-meta">{meta(progress, seconds)}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={onCancel}>取消</button>
        </div>
        {progress?.retry ? (
          <div className="stream-progress-retry">上一次输出没有通过校验，已自动重试：{progress.retry.issues[0] ?? progress.retry.code}</div>
        ) : null}
        {progress?.text ? <div className="stream-progress-tail">{textTail(progress.text)}</div> : null}
      </div>
    </div>
  );
}
