'use client';

import type { ReactNode } from 'react';
import type { RevisionNote } from '@/lib/ai/schemas/revise-features';
import type { ItemOfType } from '@/lib/model/context';
import type { Link } from '@/lib/model/types';
import { linkedIds } from '@/lib/store/request-context';
import { ParaHead } from '@/components/shared/NodeKit';
import { leapTitle, type LeapItem } from './leap-meta';

type Revision = ItemOfType<'revision'>;

export interface RevisionView {
  revisions: Revision[];
  summary: string;
  echo: string;
}

interface Props {
  leaps: LeapItem[];
  revision: RevisionView | null;
  revising: boolean;
  hasOriginalFeat: boolean;
  links: Link[];
  slug: string;
  onApply: () => void;
  /** Live progress card of the revise call, shown at the end of the section while it runs. */
  progress?: ReactNode;
}

export function ApplyLeapsSection({ leaps, revision, revising, hasOriginalFeat, links, slug, onApply, progress }: Props) {
  const selected = leaps.filter((l) => l.decision === 'accepted').length;
  return (
    <div className="para-section apply-leaps-section">
      <ParaHead title="应用跃迁 · 产出最终功能列表" hint="§十 → §九 回流 · 方法论的闭环" />
      {revision ? (
        <RevisionResult revision={revision} leaps={leaps} links={links} slug={slug} onReapply={onApply} revising={revising} />
      ) : (
        <div className="apply-leaps-invite">
          <div className="apply-leaps-lead">
            方法论原则：<em>跃迁只有改变功能列表，才真正是设计</em>。
            在上方三类候选里采纳要应用的条目，AI 会把它们应用到 06 的功能列表上，
            产出<em>独立的 08 最终功能列表</em>（不覆盖 06 原版）。
          </div>
          {!hasOriginalFeat ? <div className="apply-leaps-warn">⚠ 还没找到功能列表 · 请先完成 06 节点</div> : null}
          {selected === 0 || revising ? (
            <div className="apply-leaps-empty">
              {revising ? <><span className="ai-spinner" />&nbsp; 修订中 · 通常 90-150 秒</> : <>★ 先在上方采纳 ≥1 条跃迁，才会出现<em>修订按钮</em></>}
            </div>
          ) : (
            <button type="button" className="btn-revise" onClick={onApply} disabled={!hasOriginalFeat}>
              ✦ 应用 <b>{selected}</b> 条跃迁 · 产出 08 最终功能列表
            </button>
          )}
        </div>
      )}
      {revising ? progress : null}
    </div>
  );
}

function RevisionResult({ revision, leaps, links, slug, onReapply, revising }: {
  revision: RevisionView;
  leaps: LeapItem[];
  links: Link[];
  slug: string;
  onReapply: () => void;
  revising: boolean;
}) {
  const count = (a: RevisionNote['action']) => revision.revisions.filter((r) => r.body.action === a).length;
  return (
    <div className="revision-result">
      <div className="revision-summary">
        <div className="revision-head">
          <span className="revision-title">✓ 功能列表已修订</span>
          <div className="revision-stats">
            <span className="rev-stat added">+{count('added')} 新增</span>
            <span className="rev-stat modified">~{count('modified')} 修改</span>
            <span className="rev-stat removed">−{count('removed')} 删除</span>
          </div>
        </div>
        <div className="revision-summary-body">{revision.summary}</div>
      </div>
      <div className="revision-list">
        <div className="revision-list-label">逐条变更</div>
        {revision.revisions.filter((r) => r.body.action !== 'kept').map((r) => (
          <RevisionItem key={r.id} note={r.body} sources={sourceTitles(r, leaps, links)} />
        ))}
      </div>
      <div className="revision-echo">
        <div className="revision-echo-label">新差异化假设</div>
        <div className="revision-echo-body">{revision.echo}</div>
      </div>
      <div className="revision-actions">
        <a href={`/project/${slug}/final`} className="btn btn-accent">启动 · 08 设计案 →</a>
        <button type="button" className="btn btn-ghost" onClick={onReapply} disabled={revising}>
          {revising ? <><span className="ai-spinner" />&nbsp; 重新修订</> : '重新应用（改了选择后）'}
        </button>
      </div>
    </div>
  );
}

/** The leaps a revision came from (its derived_from Links to leap items). */
function sourceTitles(r: Revision, leaps: LeapItem[], links: Link[]): string[] {
  const ids = new Set(linkedIds(links, r.id, 'derived_from'));
  return leaps.filter((l) => ids.has(l.id)).map((l) => leapTitle(l).slice(0, 24));
}

const ACTION_META: Record<RevisionNote['action'], { label: string; cls: string; icon: string }> = {
  added:    { label: '新增', cls: 'added',    icon: '+' },
  modified: { label: '修改', cls: 'modified', icon: '~' },
  removed:  { label: '删除', cls: 'removed',  icon: '−' },
  kept:     { label: '保留', cls: 'kept',     icon: '=' },
};

function RevisionItem({ note, sources }: { note: Omit<RevisionNote, 'feature_id' | 'original_feature_id' | 'source_leap_ids'>; sources: string[] }) {
  const a = ACTION_META[note.action];
  return (
    <div className={`revision-item rev-${a.cls}`}>
      <span className={`rev-action rev-${a.cls}`}>{a.icon} {a.label}</span>
      <div className="revision-item-body">
        {note.action === 'modified' ? (
          <div className="revision-diff">
            <span className="diff-old">{note.name_before}</span>
            <span className="diff-arrow">→</span>
            <span className="diff-new">{note.name_after}</span>
          </div>
        ) : (
          <div className="revision-feature-name">{note.action === 'added' ? note.name_after : note.name_before}</div>
        )}
        <div className="revision-reason">{note.reason}</div>
        {sources.length > 0 ? (
          <div className="revision-sources">来源跃迁：{sources.map((t, i) => <span key={i} className="rev-leap-id">{t}</span>)}</div>
        ) : null}
      </div>
    </div>
  );
}
