import { describe, expect, it } from 'vitest';
import { NODES } from '../../data/nodes';
import { validAlternatives } from '../ai/schemas/__fixtures__/alternatives';
import { validBrief } from '../ai/schemas/__fixtures__/extract-brief';
import { validDeepAnalysis, validDimensions, validScenarioDrafts } from '../ai/schemas/__fixtures__/scenarios';
import { validFeature, validPillars } from '../ai/schemas/__fixtures__/draft-features';
import { validLeap } from '../ai/schemas/__fixtures__/creative-leap';
import { validDesign } from '../ai/schemas/__fixtures__/generate-design';
import { validBreakdown } from '../ai/schemas/__fixtures__/split-subfeatures';
import { validStakeholders } from '../ai/schemas/__fixtures__/stakeholders';
import { validUsers } from '../ai/schemas/__fixtures__/users';
import { ITEM_TYPE_DEFS, parseBody, readRefValues, typeAllowedOn } from './item-types';
import { ITEM_TYPES, type ItemType } from './types';

/** One raw AI entity per type, taken from the task fixtures where one exists. */
const SAMPLES: Record<ItemType, unknown> = {
  brief: { raw_text: 'r', ...validBrief, fields: validBrief.fields },
  assumption: { statement: 's', quote: 'q' },
  red_line: { text: 'no dark patterns' },
  persona: validUsers.personas[0],
  job: { ...validUsers.jobs.functional[0], dimension: 'functional', persona_ids: ['p-1'] },
  stakeholder: validStakeholders.stakeholders[0],
  engagement_plan: validStakeholders.engagement_plan,
  alternative: validAlternatives.alternatives[0],
  alt_profile: validAlternatives.strategic_profiles[0],
  alt_breakdown: { alt_id: 'alt-1', menu_structure: [], core_flows: [], key_interactions: [], headline_features: [] },
  diff_hypothesis: { statement: validAlternatives.differentiation_hypothesis, key_threats: validAlternatives.key_threats },
  scenario_element: { ...validDimensions.dimensions.time[0], dim: 'time' },
  scenario: validScenarioDrafts.scenarios[0],
  matrix_cell: {
    scenario_id: 'sc-1', job_id: 'j1', frequency: 'high', importance: 'high', category: 'core', note: 'n',
  },
  extreme: validDeepAnalysis.extremes[0],
  hostile: validDeepAnalysis.hostiles[0],
  pain_point: validDeepAnalysis.pain_points[0],
  delight_point: { id: 'd1', scenario_id: 'sc-1', moment: 'm', feeling: 'f', root_reason: 'r', opportunity: 'o' },
  insight: validDeepAnalysis.design_insights[0],
  pillar: validPillars[0],
  feature: validFeature(1),
  not_doing: { name: 'n', reason: 'boundary', why: 'w' },
  first_principle: validLeap.first_principles[0],
  analogy: { ...validLeap.analogies[0], required_changes: ['c'] },
  constraint_flip: validLeap.constraint_flips[0],
  revision: { action: 'modified', feature_id: 'f-1', original_feature_id: 'f-1', reason: 'r' },
  design_section: { kind: 'flow', ...validDesign.user_flows[0] },
  module: validDesign.modules[0],
  subtask: validBreakdown.splits[0].subfeatures[0],
  summary: { topic: 'leap_timing', text: 'r', verdict: 'selective' },
  critique: { kind: 'critique', title: 't', body: 'b' },
  finding: {
    item_ids: ['ftr_1', 'red_1'], title: 't', description: 'd', severity: 'high', suggested_fix: 'f',
    stance: { verdict: 'recommend', reason: 'r' },
  },
};

describe('ITEM_TYPE_DEFS', () => {
  it('covers every ItemType with a unique id prefix', () => {
    expect(Object.keys(ITEM_TYPE_DEFS).sort()).toEqual([...ITEM_TYPES].sort());
    const prefixes = ITEM_TYPES.map((t) => ITEM_TYPE_DEFS[t].prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const p of prefixes) expect(p).toMatch(/^[a-z]{3,5}$/);
  });

  it('lets every type live on at least one node, and only on known nodes', () => {
    const kinds = new Set(NODES.map((n) => n.kind));
    for (const t of ITEM_TYPES) {
      const nodes = ITEM_TYPE_DEFS[t].nodes;
      if (nodes === 'any') continue;
      expect(nodes.length).toBeGreaterThan(0);
      for (const n of nodes) expect(kinds.has(n)).toBe(true);
    }
  });

  it('declares refs only to known item types', () => {
    for (const t of ITEM_TYPES) {
      for (const r of ITEM_TYPE_DEFS[t].refs) {
        for (const to of r.to) expect(ITEM_TYPES).toContain(to);
      }
    }
  });

  it.each(ITEM_TYPES.map((t) => [t]))('%s body accepts a raw AI entity from the task fixtures', (type) => {
    const r = parseBody(type, SAMPLES[type]);
    expect(r.ok ? [] : r.issues).toEqual([]);
  });
});

describe('parseBody', () => {
  it('strips the temp id and cross-ref fields (Links replace them)', () => {
    const r = parseBody('job', SAMPLES.job);
    expect(r.ok && r.body).toEqual({ title: 't', reach: 5, impact: 2, source: 's', dimension: 'functional' });
    const f = parseBody('feature', { ...validFeature(1), traces: { job_ids: ['j1'] }, suggested_priority: true });
    expect(f.ok && f.body).not.toHaveProperty('traces');
    expect(f.ok && f.body).not.toHaveProperty('suggested_priority');
    expect(f.ok && f.body).not.toHaveProperty('id');
  });

  it('keeps assumption highlights out of the brief body', () => {
    const bad = { ...(SAMPLES.brief as object), highlights: [{ text: 't', kind: 'assumption' }] };
    expect(parseBody('brief', bad).ok).toBe(false);
  });

  it('fills brief defaults for a human-typed draft', () => {
    const r = parseBody('brief', { raw_text: 'r', fields: validBrief.fields });
    expect(r.ok && r.body).toMatchObject({ highlights: [], answers: [], completeness: 0, follow_up_answers: {} });
  });

  it('accepts a blank human subtask (acceptance criteria relaxed)', () => {
    const r = parseBody('subtask', { title: '', description: '', layer: 'mixed', estimate: '' });
    expect(r.ok && r.body).toMatchObject({ acceptance_criteria: [], critical: false });
  });

  it('reports readable issues', () => {
    const r = parseBody('persona', { name: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.startsWith('name:'))).toBe(true);
  });

  it('rejects an unknown design section kind', () => {
    expect(parseBody('design_section', { kind: 'nope', title: 't', body: 'b' }).ok).toBe(false);
  });
});

describe('typeAllowedOn', () => {
  it('pins node-specific types and allows cross-node ones anywhere', () => {
    expect(typeAllowedOn('job', 'users')).toBe(true);
    expect(typeAllowedOn('job', 'stake')).toBe(false);
    expect(typeAllowedOn('feature', 'final')).toBe(true);
    expect(typeAllowedOn('critique', 'split')).toBe(true);
  });
});

describe('readRefValues', () => {
  it('normalises single ids, id arrays and nested paths', () => {
    expect(readRefValues({ scenario_id: 'sc-1' }, ['scenario_id'])).toEqual(['sc-1']);
    expect(readRefValues({ ids: ['a', '', 3, 'b'] }, ['ids'])).toEqual(['a', 'b']);
    expect(readRefValues({ traces: { job_ids: ['j1'] } }, ['traces', 'job_ids'])).toEqual(['j1']);
    expect(readRefValues({ traces: null }, ['traces', 'job_ids'])).toEqual([]);
    expect(readRefValues(undefined, ['x'])).toEqual([]);
  });
});
