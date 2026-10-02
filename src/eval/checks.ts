import type { AgentRun } from "../agent.js";

export interface Check {
  type: string;
  tool?: string;
  field?: string;
  value?: string | number;
  min?: number;
}

export interface GoldenCase {
  id: string;
  category: string;
  question: string;
  checks?: Check[];
  judge?: string;
}

export interface CheckResult {
  check: string;
  passed: boolean;
  detail?: string;
}

/** A citation is an article title in square brackets: [Говерла]. Markdown links count too. */
const ARTICLE_REF = /\[[^\]\n]+\]/g;

/**
 * Deterministic checks first. They are cheap, they never flake, and most
 * regressions show up here — reach for a model judge only for what is left.
 */
export function runChecks(c: GoldenCase, run: AgentRun): CheckResult[] {
  const calls = run.toolCalls;
  const shortName = (n: string) => n.replace(/^mcp__wiki__/, "");
  const cites = run.answer.match(ARTICLE_REF) ?? [];

  return (c.checks ?? []).map((check): CheckResult => {
    switch (check.type) {
      case "tool_called": {
        const passed = calls.some((x) => shortName(x.name) === check.tool);
        return {
          check: `tool_called:${check.tool}`,
          passed,
          detail: passed ? undefined : `called: ${calls.map((x) => shortName(x.name)).join(", ") || "none"}`,
        };
      }
      case "tool_input_contains": {
        const match = calls.find((x) => shortName(x.name) === check.tool);
        const input = (match?.input ?? {}) as Record<string, unknown>;
        const actual = String(input[check.field!] ?? "");
        const passed = actual.toLowerCase() === String(check.value).toLowerCase();
        return {
          check: `${check.tool}.${check.field}=${check.value}`,
          passed,
          detail: passed ? undefined : `got "${actual || "(absent)"}"`,
        };
      }
      case "cites_article": {
        const need = check.min ?? 1;
        const passed = cites.length >= need;
        return {
          check: `cites_article>=${need}`,
          passed,
          detail: passed ? undefined : `found ${cites.length}`,
        };
      }
      case "must_not_cite": {
        const passed = cites.length === 0;
        return {
          check: "must_not_cite",
          passed,
          detail: passed ? undefined : `cited ${cites.join(", ")}`,
        };
      }
      case "max_tool_calls": {
        const passed = calls.length <= Number(check.value);
        return {
          check: `max_tool_calls<=${check.value}`,
          passed,
          detail: passed ? undefined : `made ${calls.length}`,
        };
      }
      case "min_tool_calls": {
        const passed = calls.length >= Number(check.value);
        return {
          check: `min_tool_calls>=${check.value}`,
          passed,
          detail: passed ? undefined : `made ${calls.length}`,
        };
      }
      case "max_words": {
        const words = run.answer.trim().split(/\s+/).filter(Boolean).length;
        const passed = words <= Number(check.value);
        return {
          check: `max_words<=${check.value}`,
          passed,
          detail: passed ? undefined : `${words} words`,
        };
      }
      default:
        return { check: check.type, passed: false, detail: "unknown check type" };
    }
  });
}
