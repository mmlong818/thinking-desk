import { without } from './helpers';

const section = (id: string) => ({ id, title: 't', body: 'b' });

export const validDesign = {
  title: 't',
  one_liner: 'o',
  vision: 'v',
  design_principles: ['a', 'b'],
  information_architecture: [section('ia-1'), section('ia-2')],
  modules: [
    { id: 'm1', name: 'M1', responsibility: 'r', feature_ids: ['f-1'], key_screens: ['s'] },
    { id: 'm2', name: 'M2', responsibility: 'r', feature_ids: ['f-2'], key_screens: ['s'] },
  ],
  user_flows: [
    {
      id: 'uf-1',
      name: 'n',
      goal: 'g',
      precondition: 'p',
      steps: [
        { step: 1, actor: 'user', action: 'a', system_response: 'r' },
        { step: 2, actor: 'user', action: 'a', system_response: 'r' },
      ],
      success_criteria: 's',
      failure_handling: 'f',
    },
  ],
  key_interactions: [section('ki-1')],
  data_model: [{ name: 'E', description: 'd', fields: [{ name: 'id', type: 'uuid' }] }],
  tech_skeleton: [section('ts-1')],
  metrics: [],
  risks: [],
  milestones: [{ phase: 'P1', goal: 'g', deliverables: ['d'], duration: '2w' }],
  open_questions: [],
};
export const invalidDesign = without(validDesign, 'modules');
