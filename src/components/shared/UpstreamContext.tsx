'use client';

import type { ReactNode } from 'react';
import type { BriefRequestContext, ItemOfType } from '@/lib/model/context';

// The collapsible "what the AI will read" card at the top of a node: the brief, plus the
// upstream selections that travel with the request.

const CORE_FIELDS = [
  ['problem_statement', '问题'],
  ['target_user', '用户'],
  ['scenario', '场景'],
  ['value_prop', '价值主张'],
] as const;

const FULL_FIELDS = [
  ['problem_statement', '问题陈述'],
  ['target_user', '目标用户'],
  ['scenario', '使用场景'],
  ['value_prop', '价值主张'],
  ['success_criteria', '成功标准'],
  ['time_constraint', '时间约束'],
] as const;

const placeholder = <span className="placeholder">未定义</span>;

export function BriefFieldsGrid({ brief, full }: { brief: BriefRequestContext['brief']; full?: boolean }) {
  const f = brief.fields;
  return (
    <div className="ctx-grid">
      {(full ? FULL_FIELDS : CORE_FIELDS).map(([key, label]) => (
        <ContextRow key={key} label={label}>{f[key] ?? placeholder}</ContextRow>
      ))}
      {full ? (
        <ContextRow label="明确边界">
          {f.boundaries.length > 0
            ? f.boundaries.map((b, i) => <span key={i} className="tag tag-not" style={{ marginRight: 4 }}>{b}</span>)
            : placeholder}
        </ContextRow>
      ) : null}
      {full && f.red_lines.length > 0 ? (
        <ContextRow label="道德红线">
          {f.red_lines.map((r, i) => (
            <span key={i} className="tag" style={{ marginRight: 4, background: 'var(--missing)', color: 'var(--danger)' }}>⚠ {r}</span>
          ))}
        </ContextRow>
      ) : null}
    </div>
  );
}

function ContextRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div><b>{label}</b></div>
      <div>{children}</div>
    </>
  );
}

export function PersonaContextList({ personas }: { personas: ItemOfType<'persona'>[] }) {
  if (personas.length === 0) {
    return (
      <div className="ctx-section">
        <div className="ctx-section-title" style={{ color: 'var(--warn)' }}>尚未在用户节点锁定 persona</div>
        <div className="ctx-why">AI 会退化到基于 Brief 推断基线干系人。</div>
      </div>
    );
  }
  return (
    <div className="ctx-section">
      <div className="ctx-section-title">已选 personas · {personas.length} 个</div>
      {personas.map((p) => (
        <div key={p.id} className="ctx-qa">
          <div className="ctx-q">{p.body.name}</div>
          <div className="ctx-why">{p.body.one_liner}</div>
        </div>
      ))}
    </div>
  );
}

/** `<details>` card: summary line + the brief grid + whatever the node adds. */
export function UpstreamContext({ summary, brief, full, children }: {
  summary: ReactNode;
  brief: BriefRequestContext;
  full?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="para-section">
      <details className="ctx-card">
        <summary>{summary}</summary>
        <div className="ctx-body">
          <BriefFieldsGrid brief={brief.brief} full={full} />
          {children}
        </div>
      </details>
    </div>
  );
}
