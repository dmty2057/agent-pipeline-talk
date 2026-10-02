import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { wikiServer, WIKI_TOOLS } from "./tools/wiki.js";
import {
  tracer,
  traceContextEnv,
  claudeCodeTelemetryEnv,
} from "./telemetry/otel.js";

export interface AgentRun {
  answer: string;
  toolCalls: { name: string; input: unknown }[];
  turns: number;
  costUsd?: number;
}

/** Prompt versions live as files, so a change is a diff in git — not a mystery. */
export async function loadPrompt(version: string): Promise<string> {
  return readFile(join(process.cwd(), "prompts", `${version}.md`), "utf8");
}

export async function runAgent(
  userQuestion: string,
  promptVersion = process.env.PROMPT_VERSION ?? "v1",
): Promise<AgentRun> {
  const systemPrompt = await loadPrompt(promptVersion);

  // Our own span. Everything Claude Code emits nests inside it.
  return tracer.startActiveSpan("agent.run", async (span) => {
    span.setAttribute("prompt.version", promptVersion);
    span.setAttribute("question", userQuestion);

    const toolCalls: AgentRun["toolCalls"] = [];
    let answer = "";
    let turns = 0;
    let costUsd: number | undefined;

    try {
      for await (const message of query({
        prompt: userQuestion,
        options: {
          systemPrompt,
          mcpServers: { wiki: wikiServer },
          allowedTools: WIKI_TOOLS,
          tools: [], // drop every built-in: the agent sees only our two tools
          maxTurns: 8,
          env: {
            ...process.env,
            ...claudeCodeTelemetryEnv(),
            ...traceContextEnv(),
          },
        },
      })) {
        if (message.type === "system" && message.subtype === "init") {
          // Claude Code tags all of its spans with this id. Same id on ours, and
          // Langfuse shows the whole run as one session.
          span.setAttribute("session.id", message.session_id);
        } else if (message.type === "assistant") {
          turns += 1;
          for (const block of message.message.content) {
            if (block.type === "tool_use") {
              toolCalls.push({ name: block.name, input: block.input });
            }
          }
        } else if (message.type === "result") {
          if (message.subtype === "success") answer = message.result;
          costUsd = (message as { total_cost_usd?: number }).total_cost_usd;
        }
      }

      span.setAttribute("tool_calls", toolCalls.length);
      span.setAttribute("turns", turns);
      if (costUsd !== undefined) span.setAttribute("cost_usd", costUsd);

      return { answer, toolCalls, turns, costUsd };
    } finally {
      span.end();
    }
  });
}
