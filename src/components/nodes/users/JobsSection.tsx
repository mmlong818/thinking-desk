'use client';

import { useState } from 'react';
import type { Link } from '@/lib/model/types';
import { EditableItemFields } from '@/components/shared/EditableItemFields';
import { ItemDecision, RejectionNote, StanceBadge } from '@/components/shared/ItemDecision';
import { linkedIds } from '@/lib/store/request-context';
import { GROUP_META, shortName, type JobGroupKey, type JobItem, type PersonaItem } from './users-meta';

interface RefreshBarProps {
  selection: PersonaItem[];
  basis: string[];
  refreshing: boolean;
  onRefresh: () => void;
}

export function JobsRefreshBar({ selection, basis, refreshing, onRefresh }: RefreshBarProps) {
  const current = selection.map((p) => p.id).sort();
  const stale = current.length > 0 && (current.length !== basis.length || current.some((id, i) => id !== basis[i]));
  const names = selection.map(shortName).join('、');
  return (
    <div className={`jobs-refresh-bar ${stale ? 'stale' : ''}`}>
      <div className="jobs-refresh-info">
        {stale ? (
          <>
            <span className="jobs-refresh-dot" />
            <b>画像选择已变 —— </b>
            Jobs 可能没覆盖新选的 persona 或还留着不相关的。建议刷新。
          </>
        ) : current.length === 0 ? (
          <span className="dim">没有已选 persona —— 请先至少选 1 个</span>
        ) : (
          <>当前 Jobs 基于 <b>{current.length} 个已选 persona</b>（{names}）推导。</>
        )}
      </div>
      <button
        type="button"
        className={stale ? 'btn btn-accent' : 'btn btn-ghost'}
        onClick={onRefresh}
        disabled={refreshing || current.length === 0}
        title="基于当前已选 persona 重新推导 Jobs 清单"
      >
        {refreshing ? <><span className="ai-spinner" />&nbsp; 刷新中</> : stale ? `⟳ 基于 ${current.length} 个 persona 刷新 Jobs` : '⟳ 重新刷新'}
      </button>
    </div>
  );
}

interface GroupProps {
  group: JobGroupKey;
  jobs: JobItem[];
  personas: PersonaItem[];
  links: Link[];
}

export function JobGroup({ group, jobs, personas, links }: GroupProps) {
  if (jobs.length === 0) return null;
  const meta = GROUP_META[group];
  const accepted = jobs.filter((j) => j.decision === 'accepted').length;
  const sorted = [...jobs].sort((a, b) => b.body.reach * b.body.impact - a.body.reach * a.body.impact);
  return (
    <div className="job-group">
      <div className="job-group-head">
        <span className="job-group-title">{meta.label}</span>
        <span className={`job-group-tag ${group}`}>{meta.tag}</span>
        <span className="job-group-sub">{meta.hint} · {accepted} / {jobs.length} 已采纳</span>
      </div>
      {sorted.map((j) => <JobRow key={j.id} job={j} personas={personas} links={links} />)}
    </div>
  );
}

function JobRow({ job, personas, links }: { job: JobItem; personas: PersonaItem[]; links: Link[] }) {
  const [editing, setEditing] = useState(false);
  const j = job.body;
  const byId = new Map(personas.map((p) => [p.id, p]));
  const personaIds = linkedIds(links, job.id, 'derived_from');
  const state = job.decision === 'accepted' ? 'locked' : job.decision === 'rejected' ? 'is-rejected' : '';
  return (
    <div className={`job-row ${state}`}>
      <ItemDecision item={job} onToggleEdit={() => setEditing((v) => !v)} editing={editing} showNote={false} />
      <div>
        <div className="job-row-title judged-text">
          {j.title}
          <StanceBadge stance={job.aiStance} />
        </div>
        <div className="job-row-source">
          {j.source}
          {personaIds.length > 0 ? (
            <span className="job-row-personas">
              {personaIds.map((pid) => {
                const p = byId.get(pid);
                return <span key={pid} className="job-persona-chip">{p ? shortName(p) : pid}</span>;
              })}
            </span>
          ) : null}
        </div>
        <RejectionNote item={job} />
        {editing ? <EditableItemFields item={job} /> : null}
      </div>
      <div className="job-row-score">
        <span>R{j.reach}</span>
        <span>I{j.impact}</span>
      </div>
      <div className="job-row-ri">{j.reach * j.impact}</div>
    </div>
  );
}

export function LockedSummary({ jobs }: { jobs: JobItem[] }) {
  const accepted = jobs.filter((j) => j.decision === 'accepted');
  if (accepted.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">还没有采纳任何 Job</div>
        <p>采纳至少每类 1 个——它们将在后续节点里成为产品聚焦点。</p>
      </div>
    );
  }
  return (
    <div className="brief-form">
      {(Object.keys(GROUP_META) as JobGroupKey[]).map((g) => {
        const picked = accepted.filter((j) => j.body.dimension === g);
        if (picked.length === 0) return null;
        return (
          <div className="brief-row" key={g}>
            <div className="brief-label">{GROUP_META[g].label}<small>{picked.length} 条</small></div>
            <div className="brief-value">
              {picked.map((j) => (
                <div key={j.id} style={{ marginBottom: 4 }}>
                  <span className="ai-filled">{j.body.title}</span>
                  <span className="dim" style={{ fontSize: 11, fontFamily: 'var(--mono)', marginLeft: 8 }}>
                    R{j.body.reach}·I{j.body.impact} · {j.body.source}
                  </span>
                </div>
              ))}
            </div>
            <div className="brief-status filled">✓</div>
          </div>
        );
      })}
    </div>
  );
}
