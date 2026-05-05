'use client';

import { useEffect, useRef, useState } from 'react';
import { readPreferredModel, writePreferredModel } from '@/lib/client-model';

interface Provider {
  name: 'claude' | 'openai' | 'gemini' | 'zhipu';
  configured: boolean;
  models: { id: string; label?: string }[];
  error?: string;
}

const PROVIDER_LABEL: Record<Provider['name'], string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  zhipu: '智谱 GLM',
};

function fmt(value: string | null): string {
  if (!value) return '默认';
  const [p, ...rest] = value.split(':');
  const model = rest.join(':');
  return `${PROVIDER_LABEL[p as Provider['name']] ?? p} · ${model || '自动'}`;
}

export function ModelPicker() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelected(readPreferredModel());
    const sync = (e: Event) => {
      const detail = (e as CustomEvent).detail as string | null;
      setSelected(detail ?? null);
    };
    window.addEventListener('td:model-change', sync);
    return () => window.removeEventListener('td:model-change', sync);
  }, []);

  useEffect(() => {
    if (!open || providers) return;
    let cancelled = false;
    setLoading(true);
    fetch('/api/providers')
      .then((r) => r.json())
      .then((json: { providers?: Provider[] }) => {
        if (!cancelled) setProviders(json.providers ?? []);
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, providers]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const pick = (value: string | null) => {
    writePreferredModel(value);
    setSelected(value);
    setOpen(false);
  };

  const refresh = () => {
    setProviders(null);
  };

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        type="button"
        className="btn btn-ghost model-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        title="切换 AI 模型"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 1v2M8 13v2M15 8h-2M3 8H1M13 3l-1.4 1.4M4.4 11.6L3 13M13 13l-1.4-1.4M4.4 4.4L3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span>{fmt(selected)}</span>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="model-picker-pop">
          <div className="model-picker-head">
            <span>选择 AI 模型</span>
            <button type="button" className="cop-action-btn" onClick={refresh}>
              重新发现
            </button>
          </div>

          <button
            type="button"
            className={`model-picker-item default ${!selected ? 'selected' : ''}`}
            onClick={() => pick(null)}
          >
            <div className="model-picker-item-label">默认 · 跟随环境变量</div>
            <div className="model-picker-item-sub">AI_MODEL_&lt;TASK&gt; 的 .env 配置</div>
          </button>

          {loading ? (
            <div className="model-picker-loading">
              <span className="ai-spinner" />
              &nbsp; 正在从 provider 拉取可用模型…
            </div>
          ) : providers && providers.length > 0 ? (
            providers.map((p) => (
              <div key={p.name} className="model-picker-group">
                <div className="model-picker-group-head">
                  <span>{PROVIDER_LABEL[p.name]}</span>
                  <span className="mono dim" style={{ fontSize: 10 }}>
                    {p.configured ? `${p.models.length} models` : '未配置'}
                  </span>
                </div>
                {p.error ? (
                  <div className="model-picker-error">{p.error}</div>
                ) : p.models.length === 0 ? (
                  <div className="model-picker-error">无可用模型 · 检查 API key / 网络</div>
                ) : (
                  p.models.map((m) => {
                    const val = `${p.name}:${m.id}`;
                    return (
                      <button
                        key={val}
                        type="button"
                        className={`model-picker-item ${selected === val ? 'selected' : ''}`}
                        onClick={() => pick(val)}
                      >
                        <div className="model-picker-item-label">{m.label ?? m.id}</div>
                        <div className="model-picker-item-sub mono">{m.id}</div>
                      </button>
                    );
                  })
                )}
              </div>
            ))
          ) : (
            <div className="model-picker-error">没有配置任何 provider · 请在 .env 里填 API key</div>
          )}

          <div className="model-picker-foot mono dim">
            选择会保存在浏览器本地 · 每次 AI 请求都会附带
          </div>
        </div>
      ) : null}
    </div>
  );
}
