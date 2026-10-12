import { without } from './helpers';
import { validFeature, validPillars } from './draft-features';

export const validRevision = {
  revised_features: [validFeature(1), validFeature(2), validFeature(3)],
  revised_pillars: validPillars,
  revisions: [{ action: 'kept', reason: 'r' }],
  revised_not_doing: [],
  differentiation_echo: 'e',
  summary: 's',
  critiques: [],
};
export const invalidRevision = without(validRevision, 'summary');
