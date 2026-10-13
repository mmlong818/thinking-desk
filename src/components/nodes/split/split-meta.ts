import type { NodeData } from '@/components/project/useNodeData';
import type { SubFeature } from '@/lib/ai/schemas/split-subfeatures';
import type { ItemOfType } from '@/lib/model/context';
import { linkedIds } from '@/lib/store/request-context';

export type SubtaskItem = ItemOfType<'subtask'>;

export const LAYER_OPTIONS: SubFeature['layer'][] = ['frontend', 'backend', 'data', 'ai', 'design', 'test', 'devops', 'mixed'];

export const LAYER_META: Record<SubFeature['layer'], { label: string; cls: string }> = {
  frontend: { label: '前端', cls: 'fe' },
  backend:  { label: '后端', cls: 'be' },
  data:     { label: '数据', cls: 'data' },
  ai:       { label: 'AI',  cls: 'ai' },
  design:   { label: '设计', cls: 'design' },
  test:     { label: '测试', cls: 'test' },
  devops:   { label: '运维', cls: 'devops' },
  mixed:    { label: '综合', cls: 'mixed' },
};

export interface SplitGroup {
  key: string;
  /** The feature the subtasks implement (Link), when it still exists. */
  featureId?: string;
  name: string;
  moduleName?: string;
  subtasks: SubtaskItem[];
}

const nameOf = (data: NodeData, id: string | undefined) => {
  const item = id ? data.all.find((i) => i.id === id) : undefined;
  const body = item?.body as { name?: unknown } | undefined;
  return typeof body?.name === 'string' ? body.name : undefined;
};

/** Subtasks grouped by the feature they implement (else by the feature name they carry). */
export function groupSubtasks(data: NodeData, subtasks: SubtaskItem[]): SplitGroup[] {
  const groups = new Map<string, SplitGroup>();
  for (const st of subtasks) {
    const [featureId] = linkedIds(data.links, st.id, 'implements');
    const key = featureId ?? `name:${st.body.feature_name ?? ''}`;
    if (!groups.has(key)) {
      const [moduleId] = linkedIds(data.links, st.id, 'derived_from');
      groups.set(key, {
        key, featureId,
        name: nameOf(data, featureId) ?? st.body.feature_name ?? '未关联功能',
        moduleName: nameOf(data, moduleId),
        subtasks: [],
      });
    }
    groups.get(key)?.subtasks.push(st);
  }
  return [...groups.values()];
}
