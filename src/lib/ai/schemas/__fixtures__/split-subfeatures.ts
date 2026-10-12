import { without } from './helpers';

export const validBreakdown = {
  splits: [
    {
      feature_id: 'f-1',
      feature_name: 'F1',
      subfeatures: [
        {
          id: 'sf-1',
          title: 't',
          description: 'd',
          layer: 'frontend',
          estimate: '2d',
          acceptance_criteria: ['ac'],
        },
      ],
    },
  ],
  summary: 's',
  total_subfeatures: 1,
};
export const invalidBreakdown = without(validBreakdown, 'splits');
