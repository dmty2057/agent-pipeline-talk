import { runAgent } from "./agent.js";
import { startTelemetry, stopTelemetry } from "./telemetry/otel.js";

const question = process.argv.slice(2).join(" ");

if (!question) {
  console.error('Usage: npm run ask -- "Яка висота Говерли?"');
  process.exit(1);
}

startTelemetry();

try {
  const run = await runAgent(question);

  console.log("\n--- tool calls ---");
  for (const call of run.toolCalls) {
    console.log(`  ${call.name}`, JSON.stringify(call.input));
  }
  console.log(`\n--- answer (${run.turns} turns, $${run.costUsd?.toFixed(4) ?? "?"}) ---`);
  console.log(run.answer);
} finally {
  await stopTelemetry();
}
