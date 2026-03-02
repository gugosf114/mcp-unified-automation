import type { StepFunction } from '../../types/task.js';
import type { StepRegistry } from '../step-registry.js';

/**
 * Generic steps usable in any task DSL.
 *
 * These are the building blocks — domain-specific steps (linkedin.ts, etc.)
 * compose these primitives with domain logic.
 */
export function registerGenericSteps(registry: StepRegistry): void {

  // goto — navigate to entity.url
  const goto: StepFunction = async (ctx, executor) => {
    const url = ctx.entity.url;
    if (!url) return { status: 'error', error: 'Entity has no "url" field for goto step' };

    const result = await executor.goto(ctx.contextName, url);
    return result.status === 'success'
      ? { status: 'success', data: result.data }
      : { status: 'error', error: result.error };
  };
  registry.register('goto', goto);

  // screenshot — capture current page state
  const screenshot: StepFunction = async (ctx, executor) => {
    const result = await executor.screenshot(ctx.contextName);
    return result.status === 'success'
      ? { status: 'success', data: result.data }
      : { status: 'error', error: result.error };
  };
  registry.register('screenshot', screenshot);

  // wait — wait for a selector or URL pattern
  const wait: StepFunction = async (ctx, executor) => {
    const selector = ctx.entity.waitSelector;
    const url = ctx.entity.waitUrl;
    if (!selector && !url) {
      return { status: 'error', error: 'Entity needs waitSelector or waitUrl for wait step' };
    }
    const result = await executor.waitForState(ctx.contextName, { selector, url });
    return result.status === 'success'
      ? { status: 'success', data: result.data }
      : { status: 'error', error: result.error };
  };
  registry.register('wait', wait);

  // extract — extract content using entity.selector and entity.extractMode
  const extract: StepFunction = async (ctx, executor) => {
    const selector = ctx.entity.selector || 'body';
    const mode = ctx.entity.extractMode || 'text';
    const result = await executor.extractContent(ctx.contextName, selector, mode);
    return result.status === 'success'
      ? { status: 'success', data: result.data }
      : { status: 'error', error: result.error };
  };
  registry.register('extract', extract);

  // fill_form — fill fields from entity.formFields
  const fillForm: StepFunction = async (ctx, executor, sessionManager) => {
    const fields: Record<string, string> = ctx.entity.formFields || ctx.formState;
    if (!fields || Object.keys(fields).length === 0) {
      return { status: 'skip', data: 'No form fields to fill' };
    }

    const page = await sessionManager.getPage(ctx.contextName);
    for (const [selector, value] of Object.entries(fields)) {
      await sessionManager.humanDelay();
      await page.fill(selector, value);
    }

    return {
      status: 'success',
      formState: { ...ctx.formState, ...fields },
      data: { filled: Object.keys(fields) },
    };
  };
  registry.register('fill_form', fillForm);

  // dom_dump — capture DOM snapshot (used in onError)
  const domDump: StepFunction = async (ctx, _executor, sessionManager) => {
    const page = await sessionManager.getPage(ctx.contextName);
    const html = await page.content();
    return { status: 'success', data: { htmlLength: html.length } };
  };
  registry.register('dom_dump', domDump);

  // checkpoint_and_continue — no-op marker (checkpoint is handled by TaskRunner)
  registry.register('checkpoint_and_continue', async () => {
    return { status: 'success', data: 'checkpoint marker' };
  });

  // approval_gate — no-op marker (approval is handled by TaskRunner via PolicyGate)
  registry.register('approval_gate', async () => {
    return { status: 'success', data: 'approval gate passed' };
  });
}
