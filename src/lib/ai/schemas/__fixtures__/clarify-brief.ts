import { without } from './helpers';

export const validClarifyProceed = { action: 'proceed', reason: 'enough info' };

export const validClarifyAsk = {
  action: 'ask',
  need_type: 'product',
  reasoning: 'r',
  questions: [{ id: 'q1', title: 't', type: 'single', options: ['a', 'b', 'c'] }],
};

export const invalidClarify = without(validClarifyAsk, 'questions');
