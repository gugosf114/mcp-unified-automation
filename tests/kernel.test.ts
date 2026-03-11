import { Kernel } from '../src/kernel';

describe('Kernel', () => {
  let kernel: Kernel;

  beforeAll(() => {
    kernel = new Kernel();
  });

  afterAll(async () => {
    await kernel.shutdown();
  });

  // ── Component instantiation ──────────────────────────────────────

  test('instantiates all L0 foundation components', () => {
    expect(kernel.sessionManager).toBeDefined();
    expect(kernel.cdpBridge).toBeDefined();
    expect(kernel.checkpointStore).toBeDefined();
    expect(kernel.evidenceLedger).toBeDefined();
    expect(kernel.policyGate).toBeDefined();
    expect(kernel.metricsEngine).toBeDefined();
    expect(kernel.stepRegistry).toBeDefined();
  });

  test('instantiates all L1 components', () => {
    expect(kernel.actionExecutor).toBeDefined();
    expect(kernel.observerBus).toBeDefined();
    expect(kernel.networkOrchestrator).toBeDefined();
  });

  test('instantiates L2 recovery daemon', () => {
    expect(kernel.recoveryDaemon).toBeDefined();
  });

  test('instantiates L3 task engine', () => {
    expect(kernel.taskEngine).toBeDefined();
  });

  // ── Step registration ────────────────────────────────────────────

  test('registers generic steps at boot', () => {
    const steps = kernel.stepRegistry.listSteps();
    expect(steps.length).toBeGreaterThan(0);

    // Generic steps from steps/generic.ts
    const expectedGeneric = ['goto', 'screenshot', 'wait', 'extract', 'fill_form', 'dom_dump', 'checkpoint_and_continue', 'approval_gate'];
    for (const name of expectedGeneric) {
      expect(kernel.stepRegistry.has(name)).toBe(true);
    }
  });

  test('registers LinkedIn steps at boot', () => {
    // LinkedIn-specific steps from steps/linkedin.ts
    const expectedLinkedIn = ['open_job', 'validate_requirements', 'fill_easy_apply_fields', 'attach_resume_if_missing', 'pre_submit_snapshot', 'submit', 'capture_confirmation'];
    for (const name of expectedLinkedIn) {
      expect(kernel.stepRegistry.has(name)).toBe(true);
    }
  });

  test('all registered steps are functions', () => {
    for (const name of kernel.stepRegistry.listSteps()) {
      const fn = kernel.stepRegistry.get(name);
      expect(typeof fn).toBe('function');
    }
  });
});
