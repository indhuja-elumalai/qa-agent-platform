import type { Action, QaRequest, RepositoryAnalysis, TestPlan, TestPlanItem } from "@qa/schemas";
import { testPlanSchema } from "@qa/schemas";
import { createId, nowIso } from "@qa/shared";

export interface PlanningAdapter {
  readonly name: string;
  createCases(input: {
    objective: string;
    text: string;
    analysis?: RepositoryAnalysis;
  }): Promise<TestPlanItem[]>;
}

function testId(index: number) {
  return `TEST-${String(index + 1).padStart(3, "0")}`;
}

function quotedValue(value: string) {
  return value.match(/["“](.+?)["”]/)?.[1];
}

function actionsForSentence(sentence: string): { actions: Action[]; warning?: string } {
  const lower = sentence.toLowerCase();
  const quoted = quotedValue(sentence);
  if (/error|reject|required|validation|invalid credentials?/.test(lower)) {
    const text = quoted ?? (lower.includes("required") ? "required" : "error");
    return {
      actions: [
        {
          type: "assertTextVisible",
          strategy: "text",
          name: text,
          timeoutMs: 10_000,
          redactValue: false,
          errorClassification: "ASSERTION",
        },
      ],
      warning: quoted
        ? undefined
        : "Expected text is inferred; edit it before approval if an exact message is required.",
    };
  }
  if (/(page loads?|open|visit|navigate)/.test(lower)) {
    const route = sentence.match(/\/[\w/-]*/)?.[0] ?? "/";
    return {
      actions: [
        {
          type: "goto",
          path: route,
          timeoutMs: 10_000,
          redactValue: false,
          errorClassification: "NAVIGATION",
        },
      ],
    };
  }
  if (/visible|shown|displayed/.test(lower)) {
    const buttonName = sentence.match(
      /(?:check that\s+)?(?:the\s+)?(.+?)\s+button\s+(?:is|should be)\s+(?:visible|shown|displayed)/i,
    )?.[1];
    const name =
      quoted ??
      buttonName?.trim() ??
      sentence
        .replace(/(check that|is visible|should be visible|visible|shown|displayed)/gi, "")
        .trim();
    return {
      actions: [
        {
          type: "assertElementVisible",
          strategy: /button/.test(lower) ? "role" : "text",
          role: /button/.test(lower) ? "button" : undefined,
          name,
          timeoutMs: 10_000,
          redactValue: false,
          errorClassification: "ASSERTION",
        },
      ],
    };
  }
  if (/redirect|reaches?|lands? on|url/.test(lower)) {
    const route = sentence.match(/\/[\w/-]+/)?.[0] ?? quoted;
    if (route) {
      return {
        actions: [
          {
            type: "assertUrlContains",
            value: route,
            timeoutMs: 10_000,
            redactValue: false,
            errorClassification: "ASSERTION",
          },
        ],
      };
    }
  }
  return {
    actions: [
      {
        type: "captureScreenshot",
        timeoutMs: 10_000,
        redactValue: false,
        errorClassification: "ASSERTION",
      },
    ],
    warning:
      "No deterministic assertion was inferred; this case requires human review unless edited.",
  };
}

function splitCases(text: string) {
  const rawLines = text.split(/\n+/).map((line) => line.trim());
  const hasListItems = rawLines.some((line) => /^(?:[-*]|\d+[.)])\s+/.test(line));
  return rawLines
    .filter((line) => !hasListItems || /^(?:[-*]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length >= 4 && !/^(test|check that)\s*:?\s*$/i.test(line));
}

export class RuleBasedPlanningAdapter implements PlanningAdapter {
  readonly name = "rule-based";

  async createCases(input: { objective: string; text: string; analysis?: RepositoryAnalysis }) {
    const lines = splitCases(input.text || input.objective);
    return lines.map((sentence, index) => {
      const inferred = actionsForSentence(sentence);
      const route = sentence.match(/\/[\w/-]*/)?.[0] ?? "/";
      return {
        schemaVersion: "test-plan-item/v1" as const,
        id: testId(index),
        source: "USER" as const,
        title: sentence.replace(/[.]+$/, "").slice(0, 200),
        category: /login|auth|credential/i.test(sentence) ? "Authentication" : "Functional",
        route,
        preconditions: [],
        steps: inferred.actions,
        expectedResult: sentence,
        assertionType: inferred.actions[0]?.type ?? "captureScreenshot",
        sideEffectLevel: "READ_ONLY" as const,
        estimatedManualMinutes: 2,
        rationale:
          "Parsed from user-supplied instructions using the documented rule-based template.",
        repositoryEvidence: [],
        validationWarnings: inferred.warning ? [inferred.warning] : [],
        approved: false,
        rejected: false,
        requiresStagingApproval: false,
      };
    });
  }
}

function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/\W+/g, " ").trim();
}

export function mergeCases(
  userCases: TestPlanItem[],
  proposedCases: TestPlanItem[],
  analysis?: RepositoryAnalysis,
) {
  const items = userCases.map((item) => {
    const evidence = analysis?.evidence.filter((entry) =>
      normalizeTitle(item.title)
        .split(" ")
        .some((word) => word.length > 4 && entry.path.toLowerCase().includes(word)),
    );
    return { ...item, repositoryEvidence: evidence?.length ? evidence : item.repositoryEvidence };
  });
  const seen = new Map<string, string>();
  for (const item of items) {
    const key = normalizeTitle(item.title);
    if (seen.has(key)) item.duplicateOf = seen.get(key);
    else seen.set(key, item.id);
  }
  const suggestions = proposedCases
    .filter((candidate) => !seen.has(normalizeTitle(candidate.title)))
    .map((item, index) => ({
      ...item,
      id: testId(items.length + index),
      source: "REPOSITORY_ANALYSIS" as const,
    }));
  return { items, suggestions };
}

export function repositoryProposals(analysis?: RepositoryAnalysis): TestPlanItem[] {
  if (!analysis) return [];
  const candidates: Array<{
    title: string;
    route: string;
    evidence: TestPlanItem["repositoryEvidence"];
    category: string;
  }> = [];
  for (const route of analysis.routes.slice(0, 8)) {
    const routePath = route.path
      .replace(/^.*(?:app|pages)\//, "/")
      .replace(/\/?(page|index)\.(tsx?|jsx?)$/, "")
      .replace(/\[(.+?)\]/g, ":$1");
    candidates.push({
      title: `Page loads for ${routePath || "/"}`,
      route: routePath || "/",
      evidence: [route],
      category: "Routing",
    });
  }
  if (analysis.riskAreas.some((risk) => /Authentication/.test(risk))) {
    candidates.push({
      title: "Unauthenticated access is handled safely",
      route: "/",
      evidence: analysis.evidence.filter((entry) => /auth|login|session/i.test(entry.path)),
      category: "Authentication",
    });
  }
  return candidates.map((candidate, index) => ({
    schemaVersion: "test-plan-item/v1",
    id: testId(index),
    source: "REPOSITORY_ANALYSIS",
    title: candidate.title,
    category: candidate.category,
    route: candidate.route,
    preconditions: [],
    steps: [
      {
        type: "goto",
        path: candidate.route,
        timeoutMs: 10_000,
        redactValue: false,
        errorClassification: "NAVIGATION",
      },
      {
        type: "captureScreenshot",
        timeoutMs: 10_000,
        redactValue: false,
        errorClassification: "ASSERTION",
      },
    ],
    expectedResult: `${candidate.route} loads without a navigation failure`,
    assertionType: "navigation",
    sideEffectLevel: "READ_ONLY",
    estimatedManualMinutes: 2,
    rationale: `Proposed from ${candidate.evidence.map((entry) => entry.path).join(", ") || "repository risk evidence"}. Selectors are intentionally unresolved.`,
    repositoryEvidence: candidate.evidence,
    validationWarnings: [
      "This proposal confirms navigation only; add a deterministic page assertion before approval.",
    ],
    approved: false,
    rejected: false,
    requiresStagingApproval: false,
  }));
}

export async function createCandidatePlan(input: {
  request: QaRequest;
  analysis?: RepositoryAnalysis;
  adapter?: PlanningAdapter;
  maxCases?: number;
}): Promise<TestPlan> {
  const adapter = input.adapter ?? new RuleBasedPlanningAdapter();
  const userCases = input.request.existingCasesText
    ? await adapter.createCases({
        objective: input.request.objective,
        text: input.request.existingCasesText,
        analysis: input.analysis,
      })
    : [];
  const proposed = repositoryProposals(input.analysis);
  let merged: { items: TestPlanItem[]; suggestions: TestPlanItem[] };
  if (userCases.length > 0) {
    merged = mergeCases(userCases, proposed, input.analysis);
  } else if (proposed.length > 0) {
    merged = { items: proposed, suggestions: [] };
  } else {
    merged = {
      items: await adapter.createCases({
        objective: input.request.objective,
        text: input.request.objective,
      }),
      suggestions: [],
    };
  }
  const maxCases = input.maxCases ?? 100;
  const truncated = merged.items.length + merged.suggestions.length > maxCases;
  const items = merged.items.slice(0, maxCases);
  const suggestions = merged.suggestions.slice(0, Math.max(0, maxCases - items.length));
  if (truncated) {
    const lastCase = suggestions.at(-1) ?? items.at(-1);
    if (lastCase) {
      lastCase.validationWarnings = [
        ...lastCase.validationWarnings,
        `Candidate plan was truncated to the configured limit of ${maxCases} cases.`,
      ];
    }
  }
  const now = nowIso();
  return testPlanSchema.parse({
    schemaVersion: "test-plan/v1",
    id: createId("plan"),
    requestId: input.request.id,
    version: 1,
    status: "WAITING_FOR_APPROVAL",
    objective: input.request.objective,
    items,
    suggestions,
    createdAt: now,
    updatedAt: now,
  });
}

export function editPlanItem(
  plan: TestPlan,
  itemId: string,
  update: Partial<TestPlanItem>,
): TestPlan {
  const now = nowIso();
  const items = plan.items.map((item) => {
    if (item.id !== itemId) return item;
    const steps =
      update.route && !update.steps
        ? item.steps.map((step, index) =>
            index === 0 && step.type === "goto" ? { ...step, path: update.route } : step,
          )
        : (update.steps ?? item.steps);
    return { ...item, ...update, steps, approved: false };
  });
  return testPlanSchema.parse({
    ...plan,
    version: plan.version + 1,
    status: "WAITING_FOR_APPROVAL",
    items,
    approvalInvalidatedAt: now,
    updatedAt: now,
  });
}
