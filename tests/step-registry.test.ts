import { StepRegistry } from '../src/task/step-registry';
import type { StepFunction } from '../src/types/task';

const stubStep: StepFunction = async () => ({ status: 'success' as const });

describe('StepRegistry', () => {
  let registry: StepRegistry;

  beforeEach(() => {
    registry = new StepRegistry();
  });

  test('starts empty', () => {
    expect(registry.listSteps()).toEqual([]);
  });

  test('register and retrieve a step', () => {
    registry.register('my_step', stubStep);

    expect(registry.has('my_step')).toBe(true);
    expect(registry.get('my_step')).toBe(stubStep);
  });

  test('has returns false for unregistered step', () => {
    expect(registry.has('nonexistent')).toBe(false);
  });

  test('get returns undefined for unregistered step', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  test('listSteps returns all registered names', () => {
    registry.register('alpha', stubStep);
    registry.register('beta', stubStep);
    registry.register('gamma', stubStep);

    const steps = registry.listSteps().sort();
    expect(steps).toEqual(['alpha', 'beta', 'gamma']);
  });

  test('overwriting a step replaces the function', () => {
    const fn1: StepFunction = async () => ({ status: 'success' as const });
    const fn2: StepFunction = async () => ({ status: 'skip' as const });

    registry.register('step', fn1);
    expect(registry.get('step')).toBe(fn1);

    registry.register('step', fn2);
    expect(registry.get('step')).toBe(fn2);
  });

  test('step count matches registrations', () => {
    registry.register('a', stubStep);
    registry.register('b', stubStep);

    expect(registry.listSteps()).toHaveLength(2);
  });
});
