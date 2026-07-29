import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import type { Action, EvidenceItem, TestPlanItem, TestResult } from "@qa/schemas";
import { actionSchema } from "@qa/schemas";
import { enforceSameBaseHost, redact, safeFilename } from "@qa/security";
import { createId, nowIso } from "@qa/shared";

const maxBrowserLogEntries = 200;
const maxBrowserLogBytes = 64 * 1024;
const browserLogTruncated = "[browser log truncated]";

export interface AuthenticationAdapter {
  readonly name: string;
  contextOptions(): Promise<{ storageState?: string }>;
  prepare?(page: Page, baseUrl: string): Promise<void>;
}

export class NoAuthenticationAdapter implements AuthenticationAdapter {
  readonly name = "none";
  async contextOptions() {
    return {};
  }
}

export class StorageStateAuthenticationAdapter implements AuthenticationAdapter {
  readonly name = "playwright-storage-state";
  constructor(private readonly path: string) {}
  async contextOptions() {
    return { storageState: this.path };
  }
}

export class EnvironmentCredentialsAuthenticationAdapter implements AuthenticationAdapter {
  readonly name = "environment-credentials";
  constructor(
    private readonly options: {
      email: string;
      password: string;
      loginPath?: string;
      emailLabel?: string;
      passwordLabel?: string;
      submitName?: string;
    },
  ) {}
  async contextOptions() {
    return {};
  }
  async prepare(page: Page, baseUrl: string) {
    const target = enforceSameBaseHost(baseUrl, this.options.loginPath ?? "/login");
    await page.goto(target.toString(), { waitUntil: "domcontentloaded" });
    await page.getByLabel(this.options.emailLabel ?? "Email").fill(this.options.email);
    await page.getByLabel(this.options.passwordLabel ?? "Password").fill(this.options.password);
    await page.getByRole("button", { name: this.options.submitName ?? "Login" }).click();
  }
}

export class DemoAuthenticationAdapter extends EnvironmentCredentialsAuthenticationAdapter {
  constructor() {
    super({ email: "demo@example.test", password: "demo-password" });
  }
}

export interface RunnerEvent {
  type: "case-started" | "action-completed" | "evidence" | "case-completed";
  testId: string;
  message: string;
  timestamp: string;
  evidence?: EvidenceItem;
}

function locatorFor(page: Page, action: Action): Locator {
  const name = action.name ?? "";
  switch (action.strategy) {
    case "role":
      return page.getByRole((action.role ?? "button") as any, { name });
    case "label":
      return page.getByLabel(name);
    case "text":
      return page.getByText(name, { exact: action.type === "assertExactText" });
    case "testId":
      return page.getByTestId(name);
    case "placeholder":
      return page.getByPlaceholder(name);
    default:
      throw new Error(`Selector strategy is required for ${action.type}`);
  }
}

async function executeAction(page: Page, actionInput: Action, baseUrl: string) {
  const action = actionSchema.parse(actionInput);
  const timeout = action.timeoutMs;
  switch (action.type) {
    case "goto": {
      const target = enforceSameBaseHost(baseUrl, action.path!);
      await page.goto(target.toString(), { timeout, waitUntil: "domcontentloaded" });
      break;
    }
    case "click":
      await locatorFor(page, action).click({ timeout });
      break;
    case "fill":
      await locatorFor(page, action).fill(action.value!, { timeout });
      break;
    case "selectOption":
      await locatorFor(page, action).selectOption(action.option ?? action.value ?? "", { timeout });
      break;
    case "check":
      await locatorFor(page, action).check({ timeout });
      break;
    case "uncheck":
      await locatorFor(page, action).uncheck({ timeout });
      break;
    case "press":
      await page.keyboard.press(action.key!, { delay: 20 });
      break;
    case "waitForElement":
    case "assertTextVisible":
    case "assertElementVisible":
      await locatorFor(page, action).waitFor({ state: "visible", timeout });
      break;
    case "assertExactText": {
      const text = await locatorFor(page, action).textContent({ timeout });
      if (text?.trim() !== action.value && text?.trim() !== action.name) {
        throw new Error(
          `Expected exact text ${action.value ?? action.name}, received ${text ?? "<none>"}`,
        );
      }
      break;
    }
    case "assertElementHidden":
      await locatorFor(page, action).waitFor({ state: "hidden", timeout });
      break;
    case "assertElementEnabled":
      if (!(await locatorFor(page, action).isEnabled({ timeout })))
        throw new Error("Expected element to be enabled");
      break;
    case "assertElementDisabled":
      if (await locatorFor(page, action).isEnabled({ timeout }))
        throw new Error("Expected element to be disabled");
      break;
    case "assertUrlEquals": {
      const target = enforceSameBaseHost(baseUrl, action.value ?? action.path ?? "/").toString();
      if (page.url() !== target) throw new Error(`Expected URL ${target}, received ${page.url()}`);
      break;
    }
    case "assertUrlContains":
      if (!page.url().includes(action.value ?? ""))
        throw new Error(`Expected URL to contain ${action.value}`);
      break;
    case "assertPageTitle": {
      const title = await page.title();
      if (title !== (action.value ?? action.name))
        throw new Error(`Expected title ${action.value ?? action.name}, received ${title}`);
      break;
    }
    case "assertFieldValidation": {
      const validity = await locatorFor(page, action).evaluate((element: HTMLInputElement) => ({
        valid: element.validity.valid,
        message: element.validationMessage,
      }));
      if (validity.valid) throw new Error("Expected field to be invalid");
      break;
    }
    case "captureScreenshot":
      break;
  }
}

async function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function evidenceItem(input: {
  runId: string;
  testId: string;
  type: EvidenceItem["type"];
  path: string;
  mimeType: string;
  description: string;
  available?: boolean;
  unavailableReason?: string;
}): EvidenceItem {
  return {
    schemaVersion: "evidence-item/v1",
    id: createId("evidence"),
    runId: input.runId,
    testId: input.testId,
    type: input.type,
    path: input.path,
    mimeType: input.mimeType,
    description: input.description,
    available: input.available ?? true,
    unavailableReason: input.unavailableReason,
    createdAt: nowIso(),
  };
}

export class PlaywrightQaRunner {
  constructor(
    private readonly options: {
      evidenceRoot: string;
      timeoutMs: number;
      retries: number;
      authentication?: AuthenticationAdapter;
    },
  ) {}

  async runCase(input: {
    runId: string;
    item: TestPlanItem;
    baseUrl: string;
    signal?: AbortSignal;
    onEvent?: (event: RunnerEvent) => void;
  }): Promise<TestResult> {
    const startedAt = nowIso();
    const started = Date.now();
    input.onEvent?.({
      type: "case-started",
      testId: input.item.id,
      message: input.item.title,
      timestamp: startedAt,
    });
    if (["EXTERNAL_SIDE_EFFECT", "PRODUCTION_MUTATION"].includes(input.item.sideEffectLevel)) {
      return this.result(input, startedAt, started, {
        status: "BLOCKED",
        actualResult: "Side-effect policy prohibits execution",
        evidence: [],
        retryCount: 0,
      });
    }
    if (input.item.sideEffectLevel === "STAGING_TEST_DATA" && input.item.requiresStagingApproval) {
      return this.result(input, startedAt, started, {
        status: "BLOCKED",
        actualResult: "Additional staging-data approval is missing",
        evidence: [],
        retryCount: 0,
      });
    }
    const requiresHumanReview =
      input.item.steps.some((step) => step.type === "captureScreenshot") &&
      input.item.steps.every((step) => step.type === "captureScreenshot" || step.type === "goto");
    const containsSensitiveValues = input.item.steps.some(
      (step) => step.redactValue && step.value !== undefined,
    );
    const directory = join(
      this.options.evidenceRoot,
      safeFilename(input.runId),
      safeFilename(input.item.id),
    );
    await mkdir(directory, { recursive: true });
    let attempts = 0;
    while (attempts <= this.options.retries) {
      if (input.signal?.aborted) {
        return this.result(input, startedAt, started, {
          status: "NOT_EXECUTED",
          actualResult: "Run was cancelled",
          evidence: [],
          retryCount: attempts,
        });
      }
      let browser: Browser | undefined;
      let context: BrowserContext | undefined;
      const evidence: EvidenceItem[] = [];
      const browserLogs: string[] = [];
      let browserLogBytes = 0;
      const appendBrowserLog = (message: string) => {
        if (browserLogs.length >= maxBrowserLogEntries || browserLogBytes >= maxBrowserLogBytes) {
          if (browserLogs.at(-1) !== browserLogTruncated) browserLogs.push(browserLogTruncated);
          return;
        }
        const remainingBytes = maxBrowserLogBytes - browserLogBytes;
        const bounded = Buffer.from(message).subarray(0, remainingBytes).toString("utf8");
        browserLogs.push(bounded);
        browserLogBytes += Buffer.byteLength(bounded);
        if (bounded !== message) browserLogs.push(browserLogTruncated);
      };
      let tracingStarted = false;
      try {
        browser = await chromium.launch({ headless: true });
        const auth: AuthenticationAdapter =
          this.options.authentication ?? new NoAuthenticationAdapter();
        context = await browser.newContext(await auth.contextOptions());
        const page = await context.newPage();
        if (auth.prepare) {
          await abortable(auth.prepare(page, input.baseUrl), input.signal);
        }
        page.on("console", (message) => appendBrowserLog(`[${message.type()}] ${message.text()}`));
        page.on("pageerror", (error) => appendBrowserLog(`[pageerror] ${error.message}`));
        if (!containsSensitiveValues) {
          await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
          tracingStarted = true;
        }
        if (input.item.steps[0]?.type !== "goto") {
          const route = enforceSameBaseHost(input.baseUrl, input.item.route || "/");
          await abortable(
            page.goto(route.toString(), {
              timeout: this.options.timeoutMs,
              waitUntil: "domcontentloaded",
            }),
            input.signal,
          );
        }
        for (const action of input.item.steps) {
          if (input.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
          await abortable(executeAction(page, action, input.baseUrl), input.signal);
          input.onEvent?.({
            type: "action-completed",
            testId: input.item.id,
            message: `${action.type} completed`,
            timestamp: nowIso(),
          });
        }
        const screenshotPath = join(directory, "final.png");
        const screenshotEvidence = evidenceItem({
          runId: input.runId,
          testId: input.item.id,
          type: "SCREENSHOT",
          path: screenshotPath,
          mimeType: "image/png",
          description: "Final page state",
        });
        if (containsSensitiveValues) {
          evidence.push({
            ...screenshotEvidence,
            available: false,
            unavailableReason: "Suppressed because the case contains redacted input values",
          });
        } else {
          await page.screenshot({ path: screenshotPath, fullPage: true });
          evidence.push(screenshotEvidence);
        }
        const tracePath = join(directory, "trace.zip");
        if (tracingStarted) {
          await context.tracing.stop({ path: tracePath });
          tracingStarted = false;
        }
        evidence.push(
          containsSensitiveValues
            ? {
                ...evidenceItem({
                  runId: input.runId,
                  testId: input.item.id,
                  type: "TRACE",
                  path: tracePath,
                  mimeType: "application/zip",
                  description: "Playwright trace",
                }),
                available: false,
                unavailableReason: "Suppressed because the case contains redacted input values",
              }
            : evidenceItem({
                runId: input.runId,
                testId: input.item.id,
                type: "TRACE",
                path: tracePath,
                mimeType: "application/zip",
                description: "Playwright trace",
              }),
        );
        const logPath = join(directory, "browser.log");
        await writeFile(
          logPath,
          containsSensitiveValues
            ? "[REDACTED: browser logs suppressed for a credential-bearing case]"
            : browserLogs.map((message) => String(redact(message))).join("\n"),
          {
            mode: 0o600,
          },
        );
        evidence.push(
          evidenceItem({
            runId: input.runId,
            testId: input.item.id,
            type: "BROWSER_LOG",
            path: logPath,
            mimeType: "text/plain",
            description: "Redacted browser console log",
          }),
        );
        const status = requiresHumanReview ? "NEEDS_HUMAN_REVIEW" : "PASS";
        const actual =
          status === "PASS"
            ? "All deterministic actions and assertions completed"
            : "Navigation completed; no deterministic assertion was configured";
        const result = this.result(input, startedAt, started, {
          status,
          actualResult: actual,
          evidence,
          retryCount: attempts,
        });
        input.onEvent?.({
          type: "case-completed",
          testId: input.item.id,
          message: result.status,
          timestamp: nowIso(),
        });
        return result;
      } catch (error) {
        if (context) {
          const tracePath = join(directory, `trace-attempt-${attempts + 1}.zip`);
          const traceEvidence = evidenceItem({
            runId: input.runId,
            testId: input.item.id,
            type: "TRACE",
            path: tracePath,
            mimeType: "application/zip",
            description: "Failure trace",
          });
          try {
            if (!tracingStarted) throw new Error("Trace capture was not started");
            await context.tracing.stop({ path: tracePath });
            tracingStarted = false;
            evidence.push(traceEvidence);
          } catch (captureError) {
            evidence.push({
              ...traceEvidence,
              available: false,
              unavailableReason:
                captureError instanceof Error ? captureError.message : String(captureError),
            });
          }
          const page = context.pages()[0];
          if (page && !containsSensitiveValues) {
            const screenshotPath = join(directory, `failure-attempt-${attempts + 1}.png`);
            const screenshotEvidence = evidenceItem({
              runId: input.runId,
              testId: input.item.id,
              type: "SCREENSHOT",
              path: screenshotPath,
              mimeType: "image/png",
              description: "Failure page state",
            });
            try {
              await page.screenshot({ path: screenshotPath, fullPage: true });
              evidence.push(screenshotEvidence);
            } catch (captureError) {
              evidence.push({
                ...screenshotEvidence,
                available: false,
                unavailableReason:
                  captureError instanceof Error ? captureError.message : String(captureError),
              });
            }
          }
        }
        const logPath = join(directory, `browser-attempt-${attempts + 1}.log`);
        const logEvidence = evidenceItem({
          runId: input.runId,
          testId: input.item.id,
          type: "BROWSER_LOG",
          path: logPath,
          mimeType: "text/plain",
          description: "Redacted failure browser console log",
        });
        try {
          await writeFile(
            logPath,
            containsSensitiveValues
              ? "[REDACTED: browser logs suppressed for a credential-bearing case]"
              : browserLogs.map((message) => String(redact(message))).join("\n"),
            { mode: 0o600 },
          );
          evidence.push(logEvidence);
        } catch (captureError) {
          evidence.push({
            ...logEvidence,
            available: false,
            unavailableReason:
              captureError instanceof Error ? captureError.message : String(captureError),
          });
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          return this.result(input, startedAt, started, {
            status: "NOT_EXECUTED",
            actualResult: "Run was cancelled",
            evidence,
            retryCount: attempts,
          });
        }
        if (attempts >= this.options.retries) {
          const message = error instanceof Error ? error.message : String(error);
          return this.result(input, startedAt, started, {
            status: "FAIL",
            actualResult: message,
            evidence,
            retryCount: attempts,
            error: message,
          });
        }
        attempts += 1;
        continue;
      } finally {
        await context?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
      }
    }
    throw new Error("Unreachable retry state");
  }

  private result(
    input: { runId: string; item: TestPlanItem },
    startedAt: string,
    started: number,
    outcome: {
      status: TestResult["status"];
      actualResult: string;
      evidence: EvidenceItem[];
      retryCount: number;
      error?: string;
    },
  ): TestResult {
    return {
      schemaVersion: "test-result/v1",
      id: createId("result"),
      runId: input.runId,
      testId: input.item.id,
      status: outcome.status,
      expectedResult: input.item.expectedResult,
      actualResult: String(redact(outcome.actualResult)),
      evidence: outcome.evidence,
      error: outcome.error ? String(redact(outcome.error)) : undefined,
      retryCount: outcome.retryCount,
      durationMs: Date.now() - started,
      startedAt,
      completedAt: nowIso(),
    };
  }
}
