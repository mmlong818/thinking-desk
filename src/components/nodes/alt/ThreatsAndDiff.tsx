'use client';

import type { ItemOfType } from '@/lib/model/context';
import { useItemActions } from '@/components/project/useItemActions';
import { EditableList, EditableTextarea } from '@/components/shared/Editable';
import { ItemDecision } from '@/components/shared/ItemDecision';

/** The differentiation hypothesis singleton: its key threats and the one-line statement, both editable. */
export function ThreatsAndDiff({ hypothesis }: { hypothesis: ItemOfType<'diff_hypothesis'> }) {
  const actions = useItemActions();
  const { statement, key_threats: threats } = hypothesis.body;
  const save = (patch: Partial<typeof hypothesis.body>) => void actions.editBody(hypothesis, { ...hypothesis.body, ...patch });
  return (
    <>
      <ItemDecision item={hypothesis} variant="full" />
      <div className="threats-diff" style={{ marginTop: 10 }}>
        <div className="threats-block">
          <div className="threats-label">TOP 威胁</div>
          <EditableList
            items={threats}
            placeholder="一条威胁…"
            addLabel="+ 添加我的威胁"
            onChange={(next) => save({ key_threats: next })}
          />
        </div>
        <div className="diff-block">
          <div className="diff-label">差异化假设 · 一句话说清凭什么赢</div>
          <div className="diff-quote">
            <EditableTextarea
              value={statement}
              placeholder="一句话说清凭什么赢…"
              onChange={(v) => v.trim() && save({ statement: v })}
            />
          </div>
          <div className="diff-footnote">
            <em>10 秒读完测试</em>：找 3 个没参与项目的同事念一遍再用自己话复述，
            如果他们说成"就是 XX 的翻版"，假设就失败了。
          </div>
        </div>
      </div>
      {actions.error ? <div className="idc-error">{actions.error}</div> : null}
    </>
  );
}
