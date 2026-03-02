import type { ContextName } from './common.js';

export interface UIStateChange {
  contextName: ContextName;
  type: 'dom_mutation' | 'form_change' | 'navigation' | 'dialog' | 'error';
  timestamp: number;
  selector?: string;
  details: Record<string, any>;
}
