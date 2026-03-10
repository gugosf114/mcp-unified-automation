import { parseTaskSpec, validateTaskSpec, resolveStepEntry } from '../src/task/dsl-parser';

describe('parseTaskSpec', () => {
  const validSpec = {
    taskId: 'test-1',
    context: 'default',
    mode: 'auto',
    entities: { source: 'provided', items: [{ name: 'Alice' }] },
    steps: ['navigate', 'fill_form', 'submit'],
    onError: ['screenshot'],
  };

  test('parses valid JSON spec', () => {
    const spec = parseTaskSpec(JSON.stringify(validSpec));
    expect(spec.taskId).toBe('test-1');
    expect(spec.steps.length).toBe(3);
  });

  test('rejects non-JSON input', () => {
    expect(() => parseTaskSpec('not json')).toThrow('Task spec must be valid JSON');
  });

  test('rejects missing taskId', () => {
    const bad = { ...validSpec, taskId: undefined };
    expect(() => parseTaskSpec(JSON.stringify(bad))).toThrow('taskId is required');
  });

  test('rejects missing context', () => {
    const bad = { ...validSpec, context: undefined };
    expect(() => parseTaskSpec(JSON.stringify(bad))).toThrow('context is required');
  });

  test('rejects invalid mode', () => {
    const bad = { ...validSpec, mode: 'turbo' };
    expect(() => parseTaskSpec(JSON.stringify(bad))).toThrow('mode must be one of');
  });

  test('rejects empty steps array', () => {
    const bad = { ...validSpec, steps: [] };
    expect(() => parseTaskSpec(JSON.stringify(bad))).toThrow('steps must be a non-empty array');
  });

  test('rejects missing entities', () => {
    const bad = { ...validSpec, entities: undefined };
    expect(() => parseTaskSpec(JSON.stringify(bad))).toThrow('entities is required');
  });

  test('rejects missing onError', () => {
    const bad = { ...validSpec, onError: undefined };
    expect(() => parseTaskSpec(JSON.stringify(bad))).toThrow('onError must be an array');
  });

  test('accepts concurrency field', () => {
    const withConc = { ...validSpec, concurrency: 4 };
    const spec = parseTaskSpec(JSON.stringify(withConc));
    expect(spec.concurrency).toBe(4);
  });

  test('ignores invalid concurrency', () => {
    const withBadConc = { ...validSpec, concurrency: -1 };
    const spec = parseTaskSpec(JSON.stringify(withBadConc));
    expect(spec.concurrency).toBeUndefined();
  });
});

describe('conditional steps', () => {
  test('validates mixed string and object steps', () => {
    const spec = {
      taskId: 'cond-1',
      context: 'default',
      mode: 'auto',
      entities: { source: 'provided', items: [] },
      steps: [
        'navigate',
        { step: 'upload_resume', when: '{{hasResume}} == true' },
        'submit',
      ],
      onError: [],
    };
    const parsed = parseTaskSpec(JSON.stringify(spec));
    expect(parsed.steps.length).toBe(3);
    expect(typeof parsed.steps[0]).toBe('string');
    expect(typeof parsed.steps[1]).toBe('object');
  });

  test('rejects object step without step field', () => {
    const spec = {
      taskId: 'bad-1',
      context: 'default',
      mode: 'auto',
      entities: { source: 'provided', items: [] },
      steps: [{ when: 'true' }],
      onError: [],
    };
    expect(() => parseTaskSpec(JSON.stringify(spec))).toThrow('must be a string or');
  });

  test('rejects non-string when clause', () => {
    const spec = {
      taskId: 'bad-2',
      context: 'default',
      mode: 'auto',
      entities: { source: 'provided', items: [] },
      steps: [{ step: 'foo', when: 42 }],
      onError: [],
    };
    expect(() => parseTaskSpec(JSON.stringify(spec))).toThrow('when must be a string');
  });
});

describe('resolveStepEntry', () => {
  test('string entry always runs', () => {
    const result = resolveStepEntry('navigate', {}, {});
    expect(result.stepName).toBe('navigate');
    expect(result.skip).toBe(false);
  });

  test('object entry without when always runs', () => {
    const result = resolveStepEntry({ step: 'click', when: '' }, {}, {});
    expect(result.stepName).toBe('click');
    expect(result.skip).toBe(false);
  });

  test('when == comparison matches', () => {
    const result = resolveStepEntry(
      { step: 'upload', when: '{{type}} == resume' },
      { type: 'resume' },
      {},
    );
    expect(result.skip).toBe(false);
  });

  test('when == comparison skips on mismatch', () => {
    const result = resolveStepEntry(
      { step: 'upload', when: '{{type}} == resume' },
      { type: 'cover_letter' },
      {},
    );
    expect(result.skip).toBe(true);
  });

  test('when != comparison works', () => {
    const result = resolveStepEntry(
      { step: 'skip_step', when: '{{status}} != done' },
      { status: 'pending' },
      {},
    );
    expect(result.skip).toBe(false);
  });

  test('when != skips when equal', () => {
    const result = resolveStepEntry(
      { step: 'skip_step', when: '{{status}} != done' },
      { status: 'done' },
      {},
    );
    expect(result.skip).toBe(true);
  });

  test('bare truthy value runs', () => {
    const result = resolveStepEntry(
      { step: 'action', when: '{{hasFeature}}' },
      { hasFeature: 'yes' },
      {},
    );
    expect(result.skip).toBe(false);
  });

  test('bare falsy value skips', () => {
    const result = resolveStepEntry(
      { step: 'action', when: '{{hasFeature}}' },
      { hasFeature: '' },
      {},
    );
    expect(result.skip).toBe(true);
  });

  test('bare "false" string skips', () => {
    const result = resolveStepEntry(
      { step: 'action', when: '{{enabled}}' },
      { enabled: 'false' },
      {},
    );
    expect(result.skip).toBe(true);
  });

  test('falls back to formState for missing entity fields', () => {
    const result = resolveStepEntry(
      { step: 'action', when: '{{mode}} == fast' },
      {},
      { mode: 'fast' },
    );
    expect(result.skip).toBe(false);
  });

  test('missing field resolves to empty string', () => {
    const result = resolveStepEntry(
      { step: 'action', when: '{{nonexistent}}' },
      {},
      {},
    );
    expect(result.skip).toBe(true);
  });
});
