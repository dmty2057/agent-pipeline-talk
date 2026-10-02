import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runAgent } from "../agent.js";
import { startTelemetry, stopTelemetry, tracer } from "../telemetry/otel.js";
import { runChecks, type GoldenCase } from "./checks.js";
import { judge } from "./judge.js";

export interface CaseResult {
  id: string;
  category: string;
  passed: boolean;
  failures: string[];
  toolCalls: number;
  costUsd: number;
  answer: string;
}

export interface RunReport {
  promptVersion: string;
  startedAt: string;
  passed: number;
  total: number;
  totalCostUsd: number;
  totalToolCalls: number;
  cases: CaseResult[];
}

const promptVersion = process.env.PROMPT_VERSION ?? "v1";

const cases: GoldenCase[] = JSON.parse(
  await readFile(join(process.cwd(), "data", "golden.json"), "utf8"),
);

startTelemetry();

const results: CaseResult[] = [];

try {
  for (const c of cases) {
    // One span per case, so the whole run reads as a tree in Langfuse.
    const result = await tracer.startActiveSpan(`eval.${c.id}`, async (span) => {
      span.setAttribute("case.id", c.id);
      span.setAttribute("case.category", c.category);
      span.setAttribute("prompt.version", promptVersion);

      const failures: string[] = [];
      let run = { answer: "", toolCalls: [], turns: 0, costUsd: 0 } as Awaited<
        ReturnType<typeof runAgent>
      >;

      try {
        run = await runAgent(c.question, promptVersion);

        for (const r of runChecks(c, run)) {
          if (!r.passed) failures.push(`${r.check}${r.detail ? ` (${r.detail})` : ""}`);
        }

        if (c.judge) {
          const verdict = await judge(c.question, c.judge, run.answer);
          if (!verdict.pass) failures.push(`judge: ${verdict.reason}`);
        }
      } catch (error) {
        failures.push(`threw: ${error instanceof Error ? error.message : String(error)}`);
      }

      span.setAttribute("case.passed", failures.length === 0);
      span.end();

      return {
        id: c.id,
        category: c.category,
        passed: failures.length === 0,
        failures,
        toolCalls: run.toolCalls.length,
        costUsd: run.costUsd ?? 0,
        answer: run.answer,
      };
    });

    results.push(result);
    console.log(
      `${result.passed ? "PASS" : "FAIL"}  ${result.id}` +
        (result.passed ? "" : `  → ${result.failures.join("; ")}`),
    );
  }
} finally {
  await stopTelemetry();
}

const report: RunReport = {
  promptVersion,
  startedAt: new Date().toISOString(),
  passed: results.filter((r) => r.passed).length,
  total: results.length,
  totalCostUsd: results.reduce((s, r) => s + r.costUsd, 0),
  totalToolCalls: results.reduce((s, r) => s + r.toolCalls, 0),
  cases: results,
};

await mkdir(join(process.cwd(), "runs"), { recursive: true });
await writeFile(
  join(process.cwd(), "runs", `${promptVersion}.json`),
  JSON.stringify(report, null, 2),
);

console.log(
  `\n${report.passed}/${report.total} passed  ·  ${report.totalToolCalls} tool calls  ·  $${report.totalCostUsd.toFixed(4)}`,
);
console.log(`saved runs/${promptVersion}.json`);
