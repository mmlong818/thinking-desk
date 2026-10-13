import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AI_TASKS } from './types';

// Every task can be routed with AI_MODEL_<TASK>: .env.example documents it and docker-compose
// forwards it to the app container.
const read = (file: string) => readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');

describe('AI_MODEL_<TASK> documentation', () => {
  it.each([...AI_TASKS])('%s is in .env.example and passed through by docker-compose.yml', (task) => {
    expect(read('.env.example')).toMatch(new RegExp(`^AI_MODEL_${task}=`, 'm'));
    expect(read('docker-compose.yml')).toContain(`AI_MODEL_${task}: \${AI_MODEL_${task}`);
  });
});
