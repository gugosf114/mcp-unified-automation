import type { StepFunction } from '../../types/task.js';
import type { StepRegistry } from '../step-registry.js';

/**
 * LinkedIn Easy Apply step implementations.
 *
 * These are the domain-specific steps for the first vertical slice.
 * Each step receives a StepContext with the current entity (job listing)
 * and returns a StepResult.
 *
 * Entity shape expected:
 *   { url: string, jobId: string, title?: string, company?: string }
 */
export function registerLinkedInSteps(registry: StepRegistry): void {

  // open_job — navigate to the job listing page
  const openJob: StepFunction = async (ctx, executor) => {
    const url = ctx.entity.url;
    if (!url) {
      return { status: 'error', error: 'Entity missing "url" field' };
    }

    const result = await executor.goto(ctx.contextName, url, {
      waitUntil: 'domcontentloaded',
    });

    if (result.status !== 'success') {
      return { status: 'error', error: result.error };
    }

    return { status: 'success', data: { navigated: url } };
  };
  registry.register('open_job', openJob);

  // validate_requirements — extract job requirements text
  const validateRequirements: StepFunction = async (ctx, executor) => {
    const result = await executor.extractContent(
      ctx.contextName,
      '.jobs-description-content, .jobs-box__html-content, .description__text',
      'text'
    );

    if (result.status !== 'success') {
      // Non-fatal: some jobs don't show requirements in a standard selector
      return { status: 'success', data: { requirements: 'Could not extract', raw: result.error } };
    }

    return {
      status: 'success',
      data: { requirements: result.data },
    };
  };
  registry.register('validate_requirements', validateRequirements);

  // fill_easy_apply_fields — click Easy Apply and fill modal fields
  const fillEasyApply: StepFunction = async (ctx, executor, sessionManager) => {
    // Click the Easy Apply button
    const clickResult = await executor.click(ctx.contextName, '.jobs-apply-button, button[aria-label*="Easy Apply"]', {
      waitForNav: false,
    });

    if (clickResult.status !== 'success') {
      return { status: 'error', error: `Could not click Easy Apply: ${clickResult.error}` };
    }

    // Wait for the modal to appear
    await executor.waitForState(ctx.contextName, {
      selector: '.jobs-easy-apply-modal, .artdeco-modal',
      state: 'visible',
      timeout: 5000,
    });

    // Fill any visible form fields from entity data or formState
    const page = await sessionManager.getPage(ctx.contextName);
    const filledFields: string[] = [];

    // Try to fill common fields
    const fieldMap = ctx.entity.formFields || {};
    for (const [selector, value] of Object.entries(fieldMap) as [string, string][]) {
      try {
        await sessionManager.humanDelay();
        await page.fill(selector, value);
        filledFields.push(selector);
      } catch { /* field may not exist on this form */ }
    }

    return {
      status: 'success',
      formState: { ...ctx.formState, ...fieldMap },
      data: { filled: filledFields },
    };
  };
  registry.register('fill_easy_apply_fields', fillEasyApply);

  // attach_resume_if_missing — check for resume upload, upload if needed
  const attachResume: StepFunction = async (ctx, executor, sessionManager) => {
    const page = await sessionManager.getPage(ctx.contextName);

    // Check if there's already a resume attached
    const hasResume = await page.evaluate(() => {
      const uploaded = document.querySelector('.jobs-document-upload__uploaded-filename');
      return !!uploaded;
    });

    if (hasResume) {
      return { status: 'success', data: { resumeStatus: 'already_attached' } };
    }

    // Check for upload input
    const resumePath = ctx.entity.resumePath;
    if (!resumePath) {
      return { status: 'success', data: { resumeStatus: 'no_resume_path_provided' } };
    }

    const uploadResult = await executor.upload(
      ctx.contextName,
      'input[type="file"]',
      resumePath,
    );

    return uploadResult.status === 'success'
      ? { status: 'success', data: { resumeStatus: 'uploaded' } }
      : { status: 'error', error: `Resume upload failed: ${uploadResult.error}` };
  };
  registry.register('attach_resume_if_missing', attachResume);

  // pre_submit_snapshot — capture evidence before submission
  // (This is a marker step — evidence capture is also handled by TaskRunner,
  //  but this step explicitly captures the pre-submit state.)
  const preSubmitSnapshot: StepFunction = async (ctx, executor) => {
    const result = await executor.screenshot(ctx.contextName);
    return result.status === 'success'
      ? { status: 'success', data: { snapshotPath: result.data?.path } }
      : { status: 'error', error: result.error };
  };
  registry.register('pre_submit_snapshot', preSubmitSnapshot);

  // submit — click the submit/send button in the Easy Apply modal
  const submit: StepFunction = async (ctx, executor) => {
    const clickResult = await executor.click(
      ctx.contextName,
      'button[aria-label*="Submit"], button[aria-label*="Send"], .artdeco-button--primary',
      { waitForNav: false },
    );

    if (clickResult.status !== 'success') {
      return { status: 'error', error: `Submit failed: ${clickResult.error}` };
    }

    // Wait briefly for confirmation
    await executor.waitForState(ctx.contextName, {
      selector: '.artdeco-modal .artdeco-inline-feedback--success, .jpac-modal-header',
      state: 'visible',
      timeout: 5000,
    }).catch(() => {});

    return { status: 'success', data: { submitted: true } };
  };
  registry.register('submit', submit);

  // capture_confirmation — screenshot the confirmation page/modal
  const captureConfirmation: StepFunction = async (ctx, executor) => {
    const page = await executor.getPageInfo(ctx.contextName);
    const screenshot = await executor.screenshot(ctx.contextName);

    return {
      status: 'success',
      data: {
        pageInfo: page.data,
        confirmationScreenshot: screenshot.data?.path,
      },
    };
  };
  registry.register('capture_confirmation', captureConfirmation);
}
