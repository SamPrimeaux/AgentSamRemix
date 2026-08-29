import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLeadingSkillSlash,
  pipelineSlugsFromSkillMetadata,
  unionToolManifests,
} from './skill-slash-invoke.js';

describe('parseLeadingSkillSlash', () => {
  it('parses /launch with rest', () => {
    const p = parseLeadingSkillSlash('/launch Acme dental');
    assert.deepEqual(p, { trigger: 'launch', rest: 'Acme dental' });
  });

  it('ignores prose without slash', () => {
    assert.equal(parseLeadingSkillSlash('launch Acme'), null);
    assert.equal(parseLeadingSkillSlash('Hello world'), null);
  });

  it('parses /deck alone', () => {
    assert.deepEqual(parseLeadingSkillSlash('/deck'), { trigger: 'deck', rest: '' });
  });
});

describe('pipelineSlugsFromSkillMetadata', () => {
  it('reads pipeline array', () => {
    assert.deepEqual(
      pipelineSlugsFromSkillMetadata('{"pipeline":["a","b"]}'),
      ['a', 'b'],
    );
  });
});

describe('unionToolManifests', () => {
  it('dedupes by name', () => {
    const out = unionToolManifests(
      [{ name: 'a' }, { name: 'b' }],
      [{ name: 'b' }, { name: 'c' }],
    );
    assert.deepEqual(
      out.map((t) => t.name),
      ['a', 'b', 'c'],
    );
  });
});
