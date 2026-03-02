import type { TaskSpec } from '../types/task.js';

/**
 * Parses and validates a JSON task specification.
 *
 * For now accepts JSON only. YAML support can be added later
 * by importing js-yaml and detecting the input format.
 */
export function parseTaskSpec(input: string): TaskSpec {
  let raw: any;
  try {
    raw = JSON.parse(input);
  } catch {
    throw new Error('Task spec must be valid JSON');
  }

  return validateTaskSpec(raw);
}

export function validateTaskSpec(raw: any): TaskSpec {
  const errors: string[] = [];

  if (!raw.taskId || typeof raw.taskId !== 'string') {
    errors.push('taskId is required and must be a string');
  }
  if (!raw.context || typeof raw.context !== 'string') {
    errors.push('context is required and must be a string');
  }
  if (!raw.mode || !['auto', 'semi_auto', 'manual'].includes(raw.mode)) {
    errors.push('mode must be one of: auto, semi_auto, manual');
  }
  if (!raw.entities || typeof raw.entities !== 'object') {
    errors.push('entities is required and must be an object');
  } else if (!raw.entities.source || typeof raw.entities.source !== 'string') {
    errors.push('entities.source is required');
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    errors.push('steps must be a non-empty array of step names');
  }
  if (!Array.isArray(raw.onError)) {
    errors.push('onError must be an array of error handler names');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid task spec:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    taskId: raw.taskId,
    context: raw.context,
    mode: raw.mode,
    entities: {
      source: raw.entities.source,
      items: raw.entities.items,
      limit: raw.entities.limit,
    },
    steps: raw.steps,
    idempotency: raw.idempotency,
    onError: raw.onError,
  };
}
