'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div style={{ padding: 32, fontFamily: 'ui-monospace, Menlo, monospace' }}>
          <h1 style={{ color: '#b12a2a', fontSize: 18, marginBottom: 12 }}>全局渲染失败</h1>
          <pre
            style={{
              background: '#fef6f6',
              border: '1px solid #f2c5c5',
              padding: 12,
              borderRadius: 6,
              fontSize: 12,
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
            style={{ marginTop: 16, padding: '8px 16px', border: '1px solid #222', background: '#fff', cursor: 'pointer' }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
