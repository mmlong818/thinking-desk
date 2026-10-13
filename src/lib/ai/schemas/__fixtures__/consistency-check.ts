import { without } from './helpers';

/** Ids follow the item ids the request listed (see evals/lib/fixtures.ts for the matching request). */
export const validConsistencyCheck = {
  findings: [
    {
      item_ids: ['ftr_00000001', 'red_00000001'],
      title: '功能触碰了道德红线',
      description: '已采纳的「排行榜」功能鼓励同学间比较，与红线「不做排名羞辱」直接冲突。',
      severity: 'high',
      suggested_fix: '改成只和自己过去比的进步曲线，或否决该功能。',
      stance: { verdict: 'recommend', reason: '功能描述明确写了班级排名' },
    },
    {
      item_ids: ['tsk_00000003'],
      title: '子任务实现的是「不做清单」里的事',
      description: '子任务「接入家长端推送」对应的正是不做清单里的「家长监控」。',
      severity: 'medium',
      suggested_fix: '删除该子任务，或先在 06 节点重新评估不做清单。',
      stance: { verdict: 'neutral', reason: '推送也可能只是提醒，取决于实现' },
    },
  ],
};

/** The model may legitimately find nothing. */
export const emptyConsistencyCheck = { findings: [] };

export const invalidConsistencyCheck = without(validConsistencyCheck, 'findings');
