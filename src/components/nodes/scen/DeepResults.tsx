'use client';

import type { NodeData } from '@/components/project/useNodeData';
import { JudgeStrip, judgedClass } from '@/components/shared/JudgeStrip';
import { ParaHead } from '@/components/shared/NodeKit';
import { DIMENSION_META } from '@/lib/ai/schemas/analyze-scenarios';
import type { ItemOfType } from '@/lib/model/context';
import type { Link } from '@/lib/model/types';
import { linkedIds } from '@/lib/store/request-context';
import { ScenarioJobMatrix } from './ScenarioJobMatrix';
import { accepted, type ScenarioItem } from './scen-meta';

const SEVERITY_LABEL = { high: '严重', medium: '中', low: '低' } as const;

function titleOf(items: { id: string; body: { title: string } }[], id: string | undefined) {
  return id ? items.find((i) => i.id === id)?.body.title : undefined;
}

/** The five deliverables of the deep analysis, each item judged on its own. */
export function DeepResults({ data }: { data: NodeData }) {
  const scenarios = data.of('scenario');
  const jobs = data.context('users', 'job');
  return (
    <>
      <div className="para-section">
        <ParaHead title="情景 × Job 矩阵" hint="§8.2 · 核心格 / 安全网 / 边缘 三类" />
        <ScenarioJobMatrix scenarios={accepted(scenarios)} jobs={jobs} cells={data.of('matrix_cell')} links={data.links} />
      </div>
      <PainSection data={data} scenarios={scenarios} />
      <EdgeSection data={data} />
      <InsightSection data={data} scenarios={scenarios} jobs={jobs} />
    </>
  );
}

function PainSection({ data, scenarios }: { data: NodeData; scenarios: ScenarioItem[] }) {
  const delights = data.of('delight_point');
  return (
    <div className="para-section">
      <ParaHead title="痛点 · 连续追问到根因" hint={'§8.4 · 反问 3 层"为什么"'} />
      <div className="pain-list">
        {data.of('pain_point').map((p) => (
          <PainCard key={p.id} item={p} scenario={titleOf(scenarios, linkedIds(data.links, p.id, 'derived_from')[0])} />
        ))}
      </div>
      {delights.length > 0 ? (
        <>
          <div className="para-h" style={{ marginTop: 22 }}>
            <span className="para-h-title">快点 · 产品的情感机会</span>
            <span className="para-h-hint">{delights.length} 个</span>
          </div>
          <div className="delight-list">
            {delights.map((d) => (
              <div key={d.id} className={`delight-card ${judgedClass(d)}`}>
                <div className="delight-head">
                  <span className="delight-moment judged-text">{d.body.moment}</span>
                  <span className="delight-feeling">{d.body.feeling}</span>
                </div>
                <div className="delight-reason"><b>真正打动的是：</b>{d.body.root_reason}</div>
                <div className="delight-op"><b>产品机会：</b>{d.body.opportunity}</div>
                <JudgeStrip item={d} />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PainCard({ item, scenario }: { item: ItemOfType<'pain_point'>; scenario?: string }) {
  const p = item.body;
  return (
    <div className={`pain-card ${judgedClass(item)}`}>
      <div className="pain-head">
        <span className="pain-moment judged-text">{p.moment}</span>
        <span className="pain-feeling">{p.feeling}</span>
        {scenario ? <span className="pain-scen">← {scenario}</span> : null}
      </div>
      <div className="pain-chain">
        {[p.why_1, p.why_2, p.why_3].map((why, i) => (
          <div key={i} className="pain-why"><span className="pain-why-label">为什么？</span><span>{why}</span></div>
        ))}
        <div className="pain-root"><span className="pain-root-label">底层根因</span>{p.root_cause}</div>
      </div>
      <JudgeStrip item={item} />
    </div>
  );
}

function EdgeSection({ data }: { data: NodeData }) {
  const extremes = data.of('extreme');
  const hostiles = data.of('hostile');
  return (
    <div className="para-section">
      <ParaHead title="极值 & 敌意情景" hint="§8.3 · 方法论硬要求" />
      <div className="edge-grid">
        <div className="edge-col">
          <div className="edge-col-head edge-extreme">极值情景 · {extremes.length} 个</div>
          {extremes.map((e) => (
            <div key={e.id} className={`edge-item ${judgedClass(e)}`}>
              <div className="edge-item-head">
                <span className="edge-dim">{DIMENSION_META[e.body.dim].label}</span>
                <span className="edge-limit judged-text">推到：{e.body.pushed_to_limit}</span>
              </div>
              <div className="edge-desc">{e.body.description}</div>
              <div className="edge-gap"><b>鲁棒性缺口：</b>{e.body.robustness_gap}</div>
              <JudgeStrip item={e} />
            </div>
          ))}
        </div>
        <div className="edge-col">
          <div className="edge-col-head edge-hostile">敌意情景 · {hostiles.length} 个</div>
          {hostiles.map((h) => (
            <div key={h.id} className={`edge-item sev-${h.body.severity} ${judgedClass(h)}`}>
              <div className="edge-item-head">
                <span className="edge-attack judged-text">{h.body.attack}</span>
                <span className={`sev-badge sev-${h.body.severity}`}>{SEVERITY_LABEL[h.body.severity]}</span>
              </div>
              <div className="edge-desc"><b>受害者：</b>{h.body.vulnerable_users}</div>
              <div className="edge-mitigation"><b>缓解：</b>{h.body.mitigation}</div>
              <JudgeStrip item={h} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function insightTrace(links: Link[], id: string) {
  return { scenarioId: linkedIds(links, id, 'derived_from')[0], jobId: linkedIds(links, id, 'serves')[0] };
}

function InsightSection({ data, scenarios, jobs }: { data: NodeData; scenarios: ScenarioItem[]; jobs: ItemOfType<'job'>[] }) {
  const insights = data.of('insight');
  return (
    <div className="para-section">
      <ParaHead title="设计启发" hint={`§8.5 固定格式 · ${insights.length} 条 · 直接喂给功能列表节点`} />
      <div className="insight-list">
        {insights.map((ins, i) => {
          const trace = insightTrace(data.links, ins.id);
          const scenario = titleOf(scenarios, trace.scenarioId);
          const job = titleOf(jobs, trace.jobId);
          return (
            <div key={ins.id} className={`insight-card ${judgedClass(ins)}`}>
              <div className="insight-num">{String(i + 1).padStart(2, '0')}</div>
              <div className="insight-body">
                <div className="insight-text judged-text">{ins.body.insight_text}</div>
                <div className="insight-action"><b>设计动作：</b>{ins.body.action}</div>
                <div className="insight-trace">
                  {scenario ? <span className="insight-trace-item">情景：{scenario}</span> : null}
                  {job ? <span className="insight-trace-item">Job：{job}</span> : null}
                </div>
                <JudgeStrip item={ins} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
