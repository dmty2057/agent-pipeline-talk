import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { context, propagation, trace } from "@opentelemetry/api";

/**
 * One span processor, pointed at Langfuse. Swap it for any other OTLP
 * processor and the whole pipeline reports to a different backend —
 * nothing in the agent code changes.
 */
const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
});

let started = false;

export function startTelemetry(): void {
  if (started) return;
  sdk.start();
  started = true;
}

export async function stopTelemetry(): Promise<void> {
  if (!started) return;
  // A failed export must not crash the run on stage or lose the eval report.
  await sdk.shutdown().catch((e) => console.error("telemetry export failed:", e.code ?? e));
  started = false;
}

export const tracer = trace.getTracer("agent-pipeline-talk");

/**
 * Newer Claude Code versions read TRACEPARENT from their environment and parent
 * `claude_code.interaction` under it. The one bundled with SDK 0.1.x ignores it,
 * so here the spans are tied together by session.id instead (see agent.ts).
 */
export function traceContextEnv(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  const env: Record<string, string> = {};
  if (carrier.traceparent) env.TRACEPARENT = carrier.traceparent;
  if (carrier.tracestate) env.TRACESTATE = carrier.tracestate;
  return env;
}

/** Everything Claude Code needs to emit spans instead of staying silent. */
export function claudeCodeTelemetryEnv(): Record<string, string> {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
    // The Claude Code bundled with SDK 0.1.x reads the older name.
    ENABLE_ENHANCED_TELEMETRY_BETA: "1",
    OTEL_TRACES_EXPORTER: "otlp",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
    // Without these three, every span arrives as <REDACTED>.
    OTEL_LOG_USER_PROMPTS: "1",
    OTEL_LOG_TOOL_DETAILS: "1",
    OTEL_LOG_TOOL_CONTENT: "1",
  };
}
