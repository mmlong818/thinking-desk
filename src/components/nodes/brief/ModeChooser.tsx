'use client';

import type { ClarifyAsk } from './brief-meta';

interface Props {
  ask: ClarifyAsk;
  onPick: (mode: 'questionnaire' | 'interview') => void;
  onSkip: () => void;
}

export function ModeChooser({ ask, onPick, onSkip }: Props) {
  const suggested = ask.suggested_mode;
  return (
    <div className="mode-chooser">
      <div className="mode-chooser-reason">
        <b>AI 的判断：</b>
        {ask.mode_reason || ask.reasoning}
      </div>
      <div className="mode-chooser-options">
        <ModeCard
          title="静态问卷"
          subtitle="一次抛 7-9 道选择题 · 最快"
          desc={['适合原文信息密度较高', '主要缺的是细节（deadline / 预算 / 付费方）', '几分钟就能答完']}
          suggested={suggested === 'questionnaire'}
          count={ask.questions.length}
          onPick={() => onPick('questionnaire')}
        />
        <ModeCard
          title="对话式追问"
          subtitle="一问一答 · 按 §5.3 访谈法"
          desc={['适合原文很短或很模糊', '还原你"上一次真实做这件事"的过程', '高风险领域（K12 / 医疗 / 金融）推荐']}
          suggested={suggested === 'interview'}
          count={null}
          onPick={() => onPick('interview')}
        />
      </div>
      <div className="mode-chooser-skip">
        <button type="button" className="btn btn-ghost" onClick={onSkip}>都不要 · 直接用原文抽取</button>
        <span className="dim" style={{ fontSize: 11 }}>精度通常会低 15-25 个百分点</span>
      </div>
    </div>
  );
}

function ModeCard({ title, subtitle, desc, suggested, count, onPick }: {
  title: string;
  subtitle: string;
  desc: string[];
  suggested: boolean;
  count: number | null;
  onPick: () => void;
}) {
  return (
    <button type="button" className={`mode-card ${suggested ? 'suggested' : ''}`} onClick={onPick}>
      {suggested ? <span className="mode-card-badge">AI 推荐</span> : null}
      <div className="mode-card-title">{title}</div>
      <div className="mode-card-subtitle">{subtitle}</div>
      <ul className="mode-card-desc">
        {desc.map((d) => <li key={d}>{d}</li>)}
      </ul>
      <div className="mode-card-foot">{count !== null ? `已准备 ${count} 道题` : '第一个问题正在生成'} →</div>
    </button>
  );
}
