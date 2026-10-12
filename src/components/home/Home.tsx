'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { NODES, getNode, type NodeKind } from '@/data/nodes';
import {
  addLocalProject,
  generateLocalSlug,
  listLocalProjects,
  purgeProjectClientData,
  type LocalProject,
} from '@/lib/client-projects';
import { ImportButton } from './ImportButton';

export interface ServerProject {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
  node_count: number;
  last_node_kind: string | null;
  last_node_at: string | null;
}

interface Props {
  initialProjects: ServerProject[];
  dbError?: string | null;
}

type UnifiedProject = {
  slug: string;
  name: string;
  summary: string | null;
  updated_at: string;
  node_count: number;
  last_node_kind: NodeKind | null;
  source: 'server' | 'local';
};

function unify(server: ServerProject[], local: LocalProject[]): UnifiedProject[] {
  const slugs = new Set<string>();
  const out: UnifiedProject[] = [];
  for (const p of server) {
    slugs.add(p.slug);
    out.push({
      slug: p.slug,
      name: p.name,
      summary: p.summary,
      updated_at: p.updated_at,
      node_count: p.node_count,
      last_node_kind: (p.last_node_kind as NodeKind) ?? null,
      source: 'server',
    });
  }
  for (const p of local) {
    if (slugs.has(p.slug)) continue;
    out.push({
      slug: p.slug,
      name: p.name,
      summary: p.summary,
      updated_at: p.updated_at,
      node_count: 0,
      last_node_kind: null,
      source: 'local',
    });
  }
  return out.sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return d.toLocaleDateString('zh-CN');
}

export function Home({ initialProjects, dbError }: Props) {
  const router = useRouter();
  const [projects, setProjects] = useState<UnifiedProject[]>(unify(initialProjects, []));
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [submitting, startSubmit] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const local = listLocalProjects();
    setProjects(unify(initialProjects, local));
  }, [initialProjects]);

  const create = () => {
    if (!name.trim()) return;
    setError(null);
    startSubmit(async () => {
      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), summary: summary.trim() || undefined }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          project?: { slug: string };
          error?: string;
          detail?: string;
        };
        if (res.ok && json.ok && json.project) {
          // DB succeeded
          router.push(`/project/${json.project.slug}/brief`);
          return;
        }
        // Fall back to local storage
        const slug = generateLocalSlug(name.trim());
        addLocalProject({ slug, name: name.trim(), summary: summary.trim() || null });
        router.push(`/project/${slug}/brief`);
      } catch (e) {
        // Network failure → still fall back to local
        console.warn('create project fallback to local:', e);
        const slug = generateLocalSlug(name.trim());
        addLocalProject({ slug, name: name.trim(), summary: summary.trim() || null });
        router.push(`/project/${slug}/brief`);
      }
    });
  };

  const cancel = () => {
    setShowForm(false);
    setName('');
    setSummary('');
    setError(null);
  };

  const hasProjects = projects.length > 0;

  return (
    <div className="home">
      <header className="home-top">
        <div className="home-brand">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="2.5" y="2.5" width="19" height="19" rx="2" stroke="#1A1A1A" strokeWidth="1.5" />
            <path d="M7 8h10M7 12h7M7 16h5" stroke="#B84A2B" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="18" cy="16" r="2" fill="#B84A2B" />
          </svg>
          <div>
            <div className="home-brand-name">思考工作台</div>
            <div className="home-brand-sub">Thinking Desk · 内部工具 v0.1</div>
          </div>
        </div>
        <div className="home-top-right">
          {dbError ? (
            <span className="home-db-warn" title={dbError}>
              Postgres 未连接 · 本地缓存模式
            </span>
          ) : null}
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <ImportButton />
          </div>
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => setShowForm((v) => !v)}
          >
            + 新建项目
          </button>
        </div>
      </header>

      <section className="home-hero">
        <h1 className="home-hero-title">AI 陪伴下的结构化设计思考</h1>
        <p className="home-hero-lead">
          每个新项目走一遍 <em>9 节点方法论</em>——Brief、用户与任务、干系人、替代方案、情景、
          功能列表、创造性跃迁、设计案、子功能拆分。我不替你出图、不替你做决定，
          我陪你<em>把问题想透</em>。
        </p>
      </section>

      {showForm ? (
        <section className="home-create">
          <div className="home-create-head">
            <span className="home-create-num">+ 新建</span>
            <span className="home-create-title">给项目起个名字</span>
          </div>
          <div className="home-create-body">
            <label className="home-field">
              <span>项目名称</span>
              <input
                type="text"
                autoFocus
                maxLength={80}
                placeholder="例如：K12 · AI 学习陪练"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim() && !submitting) create();
                  if (e.key === 'Escape') cancel();
                }}
              />
            </label>
            <label className="home-field">
              <span>一句话摘要（可选）</span>
              <input
                type="text"
                maxLength={200}
                placeholder="这个项目是做什么的？"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </label>
            {error ? <div className="home-create-error">{error}</div> : null}
            <div className="home-create-actions">
              <button type="button" className="btn btn-ghost" onClick={cancel} disabled={submitting}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-accent"
                onClick={create}
                disabled={submitting || !name.trim()}
              >
                {submitting ? (
                  <>
                    <span className="ai-spinner" />
                    &nbsp; 创建中
                  </>
                ) : (
                  '创建并进入 Brief →'
                )}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="home-list">
        <div className="home-list-head">
          <span className="home-list-title">历史项目</span>
          <span className="home-list-count">{projects.length} 个</span>
        </div>
        {!hasProjects ? (
          <div className="empty-state" style={{ marginTop: 12 }}>
            <div className="empty-state-title">还没有项目</div>
            <p>点右上角"+ 新建项目"开始第一次结构化思考。</p>
          </div>
        ) : (
          <div className="home-cards">
            {projects.map((p) => (
              <ProjectCard
                key={p.slug}
                project={p}
                onDelete={async () => {
                  // 二次确认：一次浏览器 confirm + 一次输入项目名
                  const ok1 = window.confirm(
                    `确定要删除「${p.name}」？\n\n这会清空该项目所有节点的本地缓存，无法恢复。`,
                  );
                  if (!ok1) return;
                  const typed = window.prompt(
                    `再次确认：请输入项目名「${p.name}」以删除，或留空取消。`,
                    '',
                  );
                  if (!typed || typed.trim() !== p.name.trim()) return;

                  // 服务端项目（DB 在跑时）—— 试着调一次 delete API；失败也继续清本地
                  if (p.source === 'server') {
                    try {
                      await fetch(`/api/projects/${encodeURIComponent(p.slug)}`, { method: 'DELETE' });
                    } catch {
                      /* network down / DB down — local purge anyway */
                    }
                  }
                  purgeProjectClientData(p.slug);
                  // 本地状态立即移除并刷新
                  setProjects((cur) => cur.filter((x) => x.slug !== p.slug));
                  router.refresh();
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProjectCard({ project: p, onDelete }: { project: UnifiedProject; onDelete: () => void }) {
  const pct = Math.round((p.node_count / NODES.length) * 100);
  const lastKind = p.last_node_kind ? getNode(p.last_node_kind) : null;
  return (
    <div className="home-card-wrap" style={{ position: 'relative' }}>
      <a className="home-card" href={`/project/${p.slug}/${p.last_node_kind ?? 'brief'}`}>
        <div className="home-card-head">
          <span className="home-card-name">{p.name}</span>
          {p.source === 'local' ? <span className="home-card-tag">本地</span> : null}
        </div>
        {p.summary ? <div className="home-card-summary">{p.summary}</div> : null}
        <div className="home-card-dots">
          {NODES.map((n, i) => {
            const done = i < p.node_count;
            const isLast = lastKind?.kind === n.kind;
            return (
              <span
                key={n.kind}
                className={`home-card-dot ${done ? 'done' : ''} ${isLast ? 'doing' : ''}`}
                title={`${n.num} ${n.label}${done ? ' · 已有产出' : ''}`}
              />
            );
          })}
        </div>
        <div className="home-card-foot">
          <span className="home-card-progress">{p.node_count} / {NODES.length} · {pct}%</span>
          <span className="home-card-when">{formatWhen(p.updated_at)}{lastKind ? ` · ${lastKind.label}` : ''}</span>
        </div>
      </a>
      <button
        type="button"
        className="home-card-del"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
        title="删除项目（需二次确认）"
        aria-label="删除项目"
      >
        ×
      </button>
    </div>
  );
}
