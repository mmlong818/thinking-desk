import { describe, expect, it } from 'vitest';
import { JsonParseError, parseJsonLoose } from './json';

describe('parseJsonLoose', () => {
  it('parses plain and fenced JSON', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('```\n[1,2]\n```')).toEqual([1, 2]);
  });

  it('recovers JSON wrapped in prose', () => {
    expect(parseJsonLoose('Here it is: {"a":{"b":2}} — done')).toEqual({ a: { b: 2 } });
  });

  it('throws a JsonParseError for anything else', () => {
    expect(() => parseJsonLoose('no json here')).toThrow(JsonParseError);
    expect(() => parseJsonLoose('{"a": ')).toThrow(JsonParseError);
  });
});
