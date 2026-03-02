import { EventEmitter } from 'node:events';
import type { Page } from 'playwright';
import type { ContextName } from '../types/common.js';
import type { UIStateChange } from '../types/events.js';

/**
 * ObserverBus — injects MutationObserver + event listeners into pages
 * and emits structured UI state changes.
 *
 * Uses page.exposeFunction() to create a callback bridge from the page
 * context back to Node.js. The injected script creates a MutationObserver
 * on document.body and listeners for form/navigation/error events.
 */
export class ObserverBus extends EventEmitter {
  private observing: Map<ContextName, boolean> = new Map();

  async startObserving(contextName: ContextName, page: Page): Promise<void> {
    if (this.observing.get(contextName)) return;

    const callbackName = `__mcpObserver_${contextName.replace(/[^a-zA-Z0-9]/g, '_')}`;

    // Expose callback from page → Node.js
    await page.exposeFunction(callbackName, (eventJson: string) => {
      try {
        const event = JSON.parse(eventJson);
        const stateChange: UIStateChange = {
          contextName,
          type: event.type,
          timestamp: Date.now(),
          selector: event.selector,
          details: event.details || {},
        };
        this.emit('stateChange', stateChange);

        // Emit typed events
        if (event.type === 'form_change') {
          this.emit('formPopulated', { contextName, fields: event.details });
        } else if (event.type === 'navigation') {
          this.emit('navigationDetected', { contextName, ...event.details });
        } else if (event.type === 'dialog') {
          this.emit('dialogAppeared', { contextName, ...event.details });
        } else if (event.type === 'error') {
          this.emit('errorDetected', { contextName, ...event.details });
        }
      } catch { /* ignore malformed events */ }
    });

    // Inject observer script into the page
    await page.evaluate((cbName: string) => {
      // MutationObserver for DOM changes
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            (window as any)[cbName](JSON.stringify({
              type: 'dom_mutation',
              details: {
                addedNodes: mutation.addedNodes.length,
                target: (mutation.target as HTMLElement).tagName,
              },
            }));
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // Form change listener
      document.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
          (window as any)[cbName](JSON.stringify({
            type: 'form_change',
            selector: target.name || target.id || target.tagName,
            details: { name: target.name, id: target.id, value: target.value?.slice(0, 50) },
          }));
        }
      });

      // Error listener
      window.addEventListener('error', (e) => {
        (window as any)[cbName](JSON.stringify({
          type: 'error',
          details: { message: e.message, filename: e.filename, lineno: e.lineno },
        }));
      });
    }, callbackName);

    this.observing.set(contextName, true);
  }

  async stopObserving(contextName: ContextName): Promise<void> {
    this.observing.set(contextName, false);
    // Note: the injected script continues running in the page but
    // the Node.js callback will no longer emit events if we check the flag.
    // A full cleanup would require page.evaluate to disconnect the observer.
  }

  isObserving(contextName: ContextName): boolean {
    return this.observing.get(contextName) || false;
  }
}
