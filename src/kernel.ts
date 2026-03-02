import { SessionManager } from './session/session-manager.js';
import { CDPBridge } from './cdp/cdp-bridge.js';
import { ActionExecutor } from './action/action-executor.js';
import { ObserverBus } from './observer/observer-bus.js';
import { NetworkOrchestrator } from './network/network-orchestrator.js';
import { CheckpointStore } from './checkpoint/checkpoint-store.js';
import { EvidenceLedger } from './evidence/evidence-ledger.js';
import { PolicyGate } from './policy/policy-gate.js';
import { RecoveryDaemon } from './recovery/recovery-daemon.js';
import { MetricsEngine } from './metrics/metrics-engine.js';
import { TaskEngine } from './task/task-engine.js';
import { StepRegistry } from './task/step-registry.js';
import { registerGenericSteps } from './task/steps/generic.js';
import { registerLinkedInSteps } from './task/steps/linkedin.js';

/**
 * Kernel — central dependency container and lifecycle manager.
 *
 * Instantiates all 10 components in dependency order and exposes
 * them as readonly fields for tool registration functions.
 *
 * Dependency layers:
 *   L0 (foundation): SessionManager, CDPBridge, CheckpointStore,
 *                     EvidenceLedger, PolicyGate, MetricsEngine, StepRegistry
 *   L1:              ActionExecutor, ObserverBus, NetworkOrchestrator
 *   L2:              RecoveryDaemon
 *   L3:              TaskEngine
 */
export class Kernel {
  // L0 — foundation (no inter-dependencies)
  readonly sessionManager: SessionManager;
  readonly cdpBridge: CDPBridge;
  readonly checkpointStore: CheckpointStore;
  readonly evidenceLedger: EvidenceLedger;
  readonly policyGate: PolicyGate;
  readonly metricsEngine: MetricsEngine;
  readonly stepRegistry: StepRegistry;

  // L1 — depends on L0
  readonly actionExecutor: ActionExecutor;
  readonly observerBus: ObserverBus;
  readonly networkOrchestrator: NetworkOrchestrator;

  // L2 — depends on L0 + L1
  readonly recoveryDaemon: RecoveryDaemon;

  // L3 — depends on all
  readonly taskEngine: TaskEngine;

  constructor() {
    // L0
    this.sessionManager = new SessionManager();
    this.cdpBridge = new CDPBridge();
    this.checkpointStore = new CheckpointStore();
    this.evidenceLedger = new EvidenceLedger();
    this.policyGate = new PolicyGate();
    this.metricsEngine = new MetricsEngine();
    this.stepRegistry = new StepRegistry();

    // L1
    this.actionExecutor = new ActionExecutor(this.sessionManager, this.metricsEngine);
    this.observerBus = new ObserverBus();
    this.networkOrchestrator = new NetworkOrchestrator(this.sessionManager, this.cdpBridge);

    // L2
    this.recoveryDaemon = new RecoveryDaemon(
      this.sessionManager,
      this.actionExecutor,
      this.evidenceLedger,
      this.metricsEngine,
    );

    // L3
    this.taskEngine = new TaskEngine(
      this.sessionManager,
      this.actionExecutor,
      this.checkpointStore,
      this.evidenceLedger,
      this.policyGate,
      this.recoveryDaemon,
      this.metricsEngine,
      this.stepRegistry,
    );

    // Register step implementations
    registerGenericSteps(this.stepRegistry);
    registerLinkedInSteps(this.stepRegistry);
  }

  async shutdown(): Promise<void> {
    this.recoveryDaemon.stopAllMonitoring();
    await this.sessionManager.close();
  }
}
