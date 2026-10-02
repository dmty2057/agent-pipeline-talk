import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunReport } from "./run-eval.js";

const [a = "v1", b = "v2"] = process.argv.slice(2);

async function load(v: string): Promise<RunReport> {
  return JSON.parse(await readFile(join(process.cwd(), "runs", `${v}.json`), "utf8"));
}

const [left, right] = await Promise.all([load(a), load(b)]);
const byId = new Map(right.cases.map((c) => [c.id, c]));

const regressions: string[] = [];
const fixes: string[] = [];

console.log(`\n  case                    ${a.padEnd(6)} ${b.padEnd(6)}`);
console.log("  " + "-".repeat(40));

for (const l of left.cases) {
  const r = byId.get(l.id);
  if (!r) continue;

  const mark = (p: boolean) => (p ? " ok " : "FAIL");
  let flag = "";

  if (l.passed && !r.passed) {
    flag = "  ← REGRESSION";
    regressions.push(`${l.id}: ${r.failures.join("; ")}`);
  } else if (!l.passed && r.passed) {
    flag = "  ← fixed";
    fixes.push(l.id);
  }

  console.log(`  ${l.id.padEnd(24)}${mark(l.passed)}  ${mark(r.passed)}${flag}`);
}

const pct = (r: RunReport) => `${r.passed}/${r.total}`;

console.log("\n  " + "-".repeat(40));
console.log(`  score        ${pct(left).padEnd(10)} ${pct(right)}`);
console.log(`  tool calls   ${String(left.totalToolCalls).padEnd(10)} ${right.totalToolCalls}`);
console.log(
  `  cost         $${left.totalCostUsd.toFixed(4).padEnd(9)} $${right.totalCostUsd.toFixed(4)}`,
);

const costDelta = left.totalCostUsd
  ? (right.totalCostUsd / left.totalCostUsd - 1) * 100
  : 0;

console.log(
  `\n  fixed: ${fixes.length}   regressed: ${regressions.length}` +
    `   cost: ${costDelta > 0 ? "+" : ""}${costDelta.toFixed(0)}%`,
);

if (regressions.length) {
  console.log("\n  regressions:");
  for (const r of regressions) console.log(`    - ${r}`);
  const trend =
    right.passed > left.passed ? "went up" : right.passed < left.passed ? "went down" : "did not change";
  const broken = regressions.length === 1 ? "One case that worked now does not" : `${regressions.length} cases that worked now do not`;
  console.log(
    `\n  The aggregate score ${trend}. ${broken}.\n` +
      "  That is the whole reason this harness exists.",
  );
}
