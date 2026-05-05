import { Copilot } from '@/components/shell/Copilot';
import { getNode, formatNodeNum, type NodeKind } from '@/data/nodes';

export function PlaceholderNode({ kind }: { kind: NodeKind }) {
  const node = getNode(kind)!;
  return (
    <div className="main">
      <main className="work">
        <div className="work-inner">
          <div className="node-hat">
            <span className="node-hat-num">{formatNodeNum(kind)}</span>
            <span className="node-hat-rule" />
            <span className="node-hat-chip">{node.chip}</span>
          </div>
          <h1 className="node-title">{node.label}</h1>
          <p className="node-intro">
            这个节点的 AI 工作流还在施工中 ——
            已有原型里的视觉与交互稿，<em>下一个会话将把真实 AI 接进来</em>。
            目前可以先把 Brief 节点跑通看看。
          </p>
          <div className="cop-card" style={{ marginTop: 40, maxWidth: 600 }}>
            <div className="cop-card-title">该节点将覆盖的 AI 能力</div>
            <ul className="cop-bullet">
              <li>基于上下文的进料加速（从已完成节点逆推）</li>
              <li>批判追问（方法论要求的三问 / 七问 / 差异化逼问）</li>
              <li>与已有节点的一致性检查</li>
            </ul>
          </div>
        </div>
      </main>
      <Copilot
        cards={[
          {
            tag: 'check',
            title: '此节点尚未接入真实 AI',
            body: '视觉和交互已定稿，后续会话会把 Claude / Gemini / Zhipu 的具体任务接进来。',
          },
        ]}
      />
    </div>
  );
}
