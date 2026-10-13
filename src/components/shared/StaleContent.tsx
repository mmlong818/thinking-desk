'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { z } from 'zod';
import type { NodeKind } from '@/data/nodes';
import { useProject } from '@/components/project/ProjectStore';
import { useItemActions } from '@/components/project/useItemActions';
import { bodyDiff } from '@/lib/model/body-diff';
import { itemSummary } from '@/lib/model/feedback';
import type { Item } from '@/lib/model/item-types';
import {
  bodyAtVersion, changedInputsKey, nodeRunStaleness, staleOnNode, type StaleUpstream,
} from '@/lib/model/staleness';
import { readUi, UI_KEY, writeUi } from '@/lib/store/ui-cache';
import { ITEM_EDIT_FIELDS, ITEM_TYPE_LABEL } from './item-labels';
import { handlerFor, useRedoHandlers, type RedoHandler } from './RedoContext';

// "上游已变": the badge on an item whose upstream changed after its Link was made or confirmed,
// its panel (which upstream, before / after when the earlier body was kept, "确认仍有效" and
// "让 AI 按新内容重做"), and the per-node notice that sums it up. Confirming costs nothing; only
// the AI redo calls the model, and only when the person presses it.

const REDO_HINT = '确认只记下"看过了、仍成立"，不调用 AI。重做会调用一次 AI：已采纳 / 改过的条目保留并标为待复核，AI 按新内容给出更新版，由你取舍。';

const POPOVER_WIDTH = 460;

/** Fixed position under the anchor, kept in place while the work area scrolls or the window resizes. */
function useAnchoredPosition(anchor: React.RefObject<HTMLElement | null>, open: boolean): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});
  const place = useCallback(() => {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 16));
    setStyle({ top: rect.bottom + 4, left, width: POPOVER_WIDTH });
  }, [anchor]);
  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);
  return style;
}

/** The "⟳ 上游已变" badge; its panel opens as a popover (cards often sit in narrow, clipped columns). */
export function StaleBadge({ item }: { item: Item }) {
  const { stale } = useProject();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const style = useAnchoredPosition(ref, open);
  const info = stale.get(item.id);
  if (!info) return null;
  const names = info.changes.map((c) => ITEM_TYPE_LABEL[c.upstream.type]).join('、');
  return (
    <>
      <button ref={ref} type="button" className={`stale-badge ${open ? 'on' : ''}`} onClick={() => setOpen((v) => !v)}
        aria-expanded={open} title={`它依赖的上游（${names}）在它生成或确认之后改了`}>
        ⟳ 上游已变
      </button>
      {open ? createPortal(
        <div className="stale-popover" style={style} role="dialog" aria-label="上游变化">
          <button type="button" className="stale-close" onClick={() => setOpen(false)} aria-label="关闭">×</button>
          <StalePanel item={item} />
        </div>,
        document.body,
      ) : null}
    </>
  );
}

export function StalePanel({ item }: { item: Item }) {
  const { stale } = useProject();
  const actions = useItemActions();
  const handler = handlerFor(useRedoHandlers(), item);
  const info = stale.get(item.id);
  if (!info) return null;
  return (
    <div className="stale-panel">
      <div className="stale-panel-title">这条是按旧的上游内容做的，之后上游改了：</div>
      {info.changes.map((c) => <UpstreamChange key={c.link.id} change={c} />)}
      <div className="stale-actions">
        <button type="button" className="btn btn-ghost btn-xs" disabled={actions.busy !== null}
          onClick={() => void actions.confirmLinks(info.changes.map((c) => c.link.id))}>
          ✓ 确认仍有效
        </button>
        {handler ? <RedoButton handler={handler} /> : <span className="dim">本页没有重做这一条的 AI 步骤</span>}
      </div>
      <div className="stale-hint">{REDO_HINT}</div>
      {actions.error ? <div className="idc-error">{actions.error}</div> : null}
    </div>
  );
}

function RedoButton({ handler }: { handler: RedoHandler }) {
  return (
    <button type="button" className="btn btn-ghost btn-xs stale-redo" disabled={handler.busy} onClick={handler.run}>
      {handler.busy ? <><span className="ai-spinner" /> AI 重做中…</> : `⟳ 让 AI 按新内容重做 · ${handler.label}`}
    </button>
  );
}

function UpstreamChange({ change }: { change: StaleUpstream }) {
  const [show, setShow] = useState(false);
  const { link, upstream } = change;
  return (
    <div className="stale-change">
      <div className="stale-change-head">
        <span className="stale-change-type">{ITEM_TYPE_LABEL[upstream.type]}</span>
        <span className="stale-change-text">{itemSummary(upstream)}</span>
        <span className="stale-change-ver">v{link.toVersionSeen} → v{upstream.version}</span>
        <button type="button" className="stale-link-btn" onClick={() => setShow((v) => !v)}>{show ? '收起' : '看改了什么'}</button>
      </div>
      {show ? <UpstreamDiff upstream={upstream} seen={link.toVersionSeen} /> : null}
    </div>
  );
}

interface BeforeState {
  loading: boolean;
  before?: unknown;
  error?: string;
}

/** The upstream's body at `version`, read from its decision events (kept `prevBody`). */
function useBodyAt(itemId: string, version: number): BeforeState {
  const { repo, store } = useProject();
  const [state, setState] = useState<BeforeState>({ loading: true });
  useEffect(() => {
    let alive = true;
    repo.listEvents(store.projectId, { itemId }).then(
      (events) => alive && setState({ loading: false, before: bodyAtVersion(events, itemId, version) }),
      (e: unknown) => alive && setState({ loading: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      alive = false;
    };
  }, [repo, store.projectId, itemId, version]);
  return state;
}

function fieldLabel(item: Item, path: string): string {
  const [top] = path.split('.');
  return ITEM_EDIT_FIELDS[item.type]?.find((f) => f.key === top)?.label ?? path;
}

function UpstreamDiff({ upstream, seen }: { upstream: Item; seen: number }) {
  const state = useBodyAt(upstream.id, seen);
  if (state.loading) return <div className="stale-diff-note">读取历史…</div>;
  if (state.error) return <div className="idc-error">{state.error}</div>;
  if (state.before === undefined) {
    return <div className="stale-diff-note">v{seen} 的内容没有留存（旧数据或内容过长），只能看到现在的版本。</div>;
  }
  const diff = bodyDiff(state.before, upstream.body);
  if (diff.length === 0) return <div className="stale-diff-note">内容没有实质差异（可能改了又改回去）。</div>;
  return (
    <table className="stale-diff">
      <thead><tr><th>字段</th><th>之前（v{seen}）</th><th>现在（v{upstream.version}）</th></tr></thead>
      <tbody>
        {diff.map((d) => (
          <tr key={d.path}><td>{fieldLabel(upstream, d.path)}</td><td className="before">{d.before || '—'}</td><td className="after">{d.after || '—'}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

const AckSchema = z.string();

/** The run-level change set the person already marked as still holding (browser UI cache). */
function useStaleAck(projectId: string, node: NodeKind): [string | null, (key: string) => void] {
  const [ack, setAck] = useState<string | null>(null);
  useEffect(() => setAck(readUi(projectId, UI_KEY.staleAck(node), AckSchema)), [projectId, node]);
  const save = (key: string) => {
    writeUi(projectId, UI_KEY.staleAck(node), key);
    setAck(key);
  };
  return [ack, save];
}

function useNodeStaleness(node: NodeKind) {
  const { stale, snapshot, store } = useProject();
  const [ack, saveAck] = useStaleAck(store.projectId, node);
  const items = useMemo(() => staleOnNode(stale, node), [stale, node]);
  const runs = useMemo(() => {
    if (!snapshot) return [];
    return nodeRunStaleness(snapshot.runs, snapshot.items.filter((i) => !i.deletedAt), node);
  }, [snapshot, node]);
  const runKey = changedInputsKey(runs);
  const runShown = runs.length > 0 && runKey !== ack;
  const byId = new Map((snapshot?.items ?? []).map((i) => [i.id, i]));
  const runInputs = runShown ? [...new Set(runs.flatMap((r) => r.changed.map((c) => c.itemId)))] : [];
  return { items, runShown, runKey, runInputs, byId, saveAck };
}

function runInputsText(ids: readonly string[], byId: ReadonlyMap<string, Item>): string {
  const names = ids.slice(0, 3).map((id) => {
    const item = byId.get(id);
    return item && !item.deletedAt ? `${ITEM_TYPE_LABEL[item.type]}「${itemSummary(item)}」` : '一条已删除的条目';
  });
  return `${names.join('、')}${ids.length > 3 ? ` 等 ${ids.length} 条` : ''}`;
}

/** "上游有 N 处变化" for one node, with the bulk actions. */
export function StaleNotice({ node }: { node: NodeKind }) {
  const s = useNodeStaleness(node);
  const handlers = useRedoHandlers();
  const actions = useItemActions();
  if (s.items.length === 0 && !s.runShown) return null;
  const upstream = new Set([...s.items.flatMap((i) => i.changes.map((c) => c.upstream.id)), ...s.runInputs]);
  const relevant = s.runShown ? handlers : handlers.filter((h) => s.items.some((i) => handlerFor([h], i.item)));
  const confirm = async () => {
    if (s.items.length > 0) await actions.confirmLinks(s.items.flatMap((i) => i.changes.map((c) => c.link.id)));
    if (s.runShown) s.saveAck(s.runKey);
  };
  return (
    <div className="stale-notice" role="status">
      <div className="stale-notice-text">
        <span className="stale-notice-tag">上游有 {upstream.size} 处变化</span>
        {s.items.length > 0 ? <span>影响本节点 {s.items.length} 条（已标「⟳ 上游已变」，点开可看改了什么）。</span> : null}
        {s.runShown ? <span>本节点上次 AI 生成时读到的 {runInputsText(s.runInputs, s.byId)} 之后改了。</span> : null}
      </div>
      <div className="stale-actions">
        <button type="button" className="btn btn-ghost btn-xs" disabled={actions.busy !== null} onClick={() => void confirm()}>
          ✓ 全部确认仍有效
        </button>
        {relevant.map((h) => <RedoButton key={h.label} handler={h} />)}
      </div>
      <div className="stale-hint">{REDO_HINT}</div>
      {actions.error ? <div className="idc-error">{actions.error}</div> : null}
    </div>
  );
}
