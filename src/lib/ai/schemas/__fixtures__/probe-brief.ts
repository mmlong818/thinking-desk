import { without } from './helpers';

export const validProbeQuestion = {
  action: 'question',
  question: 'q',
  field_tag: 'target_user',
  why: 'w',
  remaining_estimate: 3,
};
export const validProbeDone = { action: 'done', summary: 's' };
export const invalidProbe = without(validProbeQuestion, 'why');
