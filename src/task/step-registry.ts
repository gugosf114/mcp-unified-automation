import type { StepFunction } from '../types/task.js';

/**
 * StepRegistry — maps step names from the DSL to executable functions.
 *
 * Steps are registered at boot time (generic + domain-specific).
 * The TaskRunner looks up step names here during execution.
 */
export class StepRegistry {
  private steps: Map<string, StepFunction> = new Map();

  register(name: string, fn: StepFunction): void {
    this.steps.set(name, fn);
  }

  get(name: string): StepFunction | undefined {
    return this.steps.get(name);
  }

  has(name: string): boolean {
    return this.steps.has(name);
  }

  listSteps(): string[] {
    return Array.from(this.steps.keys());
  }
}
