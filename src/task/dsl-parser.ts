import type { TaskSpec, StepEntry } from '../types/task.js';

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
    errors.push('steps must be a non-empty array of step entries');
  } else {
    for (let i = 0; i < raw.steps.length; i++) {
      const entry = raw.steps[i];
      if (typeof entry === 'string') continue;
      if (typeof entry === 'object' && entry !== null && typeof entry.step === 'string') {
        if (entry.when !== undefined && typeof entry.when !== 'string') {
          errors.push(`steps[${i}].when must be a string expression`);
        }
      } else {
        errors.push(`steps[${i}] must be a string or { step: string, when?: string }`);
      }
    }
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
    steps: raw.steps as StepEntry[],
    concurrency: typeof raw.concurrency === 'number' && raw.concurrency > 0 ? raw.concurrency : undefined,
    idempotency: raw.idempotency,
    onError: raw.onError,
  };
}

/**
 * Resolve a StepEntry to a step name, or null if the `when` condition is falsy.
 *
 * The `when` expression supports simple {{field}} interpolation from the entity,
 * plus basic comparisons: "{{field}} == value", "{{field}} != value", "{{field}}".
 * A bare "{{field}}" is truthy if the value is non-empty and not "false"/"0".
 */
export function resolveStepEntry(
  entry: StepEntry,
  entity: Record<string, any>,
  formState: Record<string, string>,
): { stepName: string; skip: boolean } {
  if (typeof entry === 'string') {
    return { stepName: entry, skip: false };
  }

  const stepName = entry.step;
  if (!entry.when) {
    return { stepName, skip: false };
  }

  const interpolated = entry.when.replace(/\{\{(\w+)\}\}/g, (_match, field) => {
    return String(entity[field] ?? formState[field] ?? '');
  });

  // Check for comparison operators
  const eqMatch = interpolated.match(/^(.+?)\s*==\s*(.+)$/);
  if (eqMatch) {
    return { stepName, skip: eqMatch[1].trim() !== eqMatch[2].trim() };
  }

  const neqMatch = interpolated.match(/^(.+?)\s*!=\s*(.+)$/);
  if (neqMatch) {
    return { stepName, skip: neqMatch[1].trim() === neqMatch[2].trim() };
  }

  // Bare value — truthy check
  const val = interpolated.trim();
  const isFalsy = !val || val === 'false' || val === '0' || val === 'null' || val === 'undefined';
  return { stepName, skip: isFalsy };
}
