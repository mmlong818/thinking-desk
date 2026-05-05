'use client';

import { useEffect } from 'react';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app/error]', error);
  }, [error]);

  return (
    <div style={{ padding: '32px 40px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#222' }}>
      <h1 style={{ fontSize: 18, marginBottom: 12, color: '#b12a2a' }}>页面渲染出错</h1>
      <pre
        style={{
          background: '#fef6f6',
          border: '1px solid #f2c5c5',
          padding: '12px 16px',
          borderRadius: 6,
          fontSize: 12,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ''}
        {error.stack ? `\n\n${error.stack}` : ''}
      </pre>
      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: 16,
          padding: '8px 16px',
          border: '1px solid #222',
          background: '#fff',
          cursor: 'pointer',
          borderRadius: 4,
        }}
      >
        重试
      </button>
    </div>
  );
}
