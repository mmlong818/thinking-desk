'use client';

import type { ItemOfType } from '@/lib/model/context';
import type { Link } from '@/lib/model/types';
import { linkedIds } from '@/lib/store/request-context';
import { CATEGORY_LABEL, type ScenarioItem } from './scen-meta';

type Cell = ItemOfType<'matrix_cell'>;
type JobItem = ItemOfType<'job'>;

const FI_LABEL: Record<string, string> = { low: '低', medium: '中', high: '高' };

/** Cells point at their scenario and job over derived_from links. */
function cellLookup(cells: Cell[], links: Link[]) {
  const byPair = new Map<string, Cell>();
  for (const c of cells) {
    const targets = linkedIds(links, c.id, 'derived_from');
    for (const a of targets) for (const b of targets) byPair.set(`${a}|${b}`, c);
  }
  return (scenarioId: string, jobId: string) => byPair.get(`${scenarioId}|${jobId}`);
}

export function ScenarioJobMatrix({ scenarios, jobs, cells, links }: {
  scenarios: ScenarioItem[];
  jobs: JobItem[];
  cells: Cell[];
  links: Link[];
}) {
  if (jobs.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">尚无已锁 Job</div>
        <p>回到用户与任务节点锁定至少 1 个 Job，再回来看矩阵。</p>
      </div>
    );
  }
  const get = cellLookup(cells, links);
  return (
    <div className="matrix-shell">
      <MatrixLegend />
      <div className="matrix-wrap">
        <table className="matrix" style={{ ['--matrix-cols' as string]: jobs.length }}>
          <thead>
            <tr>
              <th className="matrix-corner">
                <span className="matrix-corner-row">情景</span>
                <span className="matrix-corner-slash">／</span>
                <span className="matrix-corner-col">Job</span>
              </th>
              {jobs.map((j) => (
                <th key={j.id} className="matrix-col-head" title={j.body.title}><div className="matrix-th-title">{j.body.title}</div></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr key={s.id}>
                <th className="matrix-row-head" title={`${s.body.title}\n${s.body.meta}`}>
                  <div className="matrix-th-title">{s.body.title}</div>
                  {s.body.meta ? <div className="matrix-th-meta">{s.body.meta}</div> : null}
                </th>
                {jobs.map((j) => <MatrixCell key={j.id} cell={get(s.id, j.id)} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatrixLegend() {
  return (
    <div className="matrix-legend">
      <span className="matrix-legend-item cat-core"><span className="matrix-legend-dot" /> 核心</span>
      <span className="matrix-legend-item cat-safety_net"><span className="matrix-legend-dot" /> 安全网</span>
      <span className="matrix-legend-item cat-fringe"><span className="matrix-legend-dot" /> 边缘</span>
      <span className="matrix-legend-sep" />
      <span className="matrix-legend-hint">F = 频率 · I = 重要度</span>
    </div>
  );
}

function MatrixCell({ cell }: { cell?: Cell }) {
  if (!cell) {
    return <td className="matrix-cell cat-fringe matrix-cell-empty"><div className="matrix-empty">—</div></td>;
  }
  const c = cell.body;
  return (
    <td className={`matrix-cell cat-${c.category}`} title={c.note}>
      <div className="matrix-cell-head">
        <span className="matrix-cat">{CATEGORY_LABEL[c.category]}</span>
        <span className="matrix-fi-pair">
          <span className={`matrix-fi-chip fi-${c.frequency}`} title={`频率 ${FI_LABEL[c.frequency] ?? c.frequency}`}>F·{FI_LABEL[c.frequency] ?? c.frequency}</span>
          <span className={`matrix-fi-chip fi-${c.importance}`} title={`重要度 ${FI_LABEL[c.importance] ?? c.importance}`}>I·{FI_LABEL[c.importance] ?? c.importance}</span>
        </span>
      </div>
      <div className="matrix-note">{c.note}</div>
    </td>
  );
}
