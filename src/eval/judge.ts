import { query } from "@anthropic-ai/claude-agent-sdk";

const SYSTEM = `You grade one answer produced by a Ukrainian Wikipedia research agent.
You are given the question, the grading criterion, and the agent's answer.
Reply with exactly one JSON object: {"pass": true|false, "reason": "<15 words"}.
Be strict: if the criterion is not clearly met, it fails.`;

export interface JudgeResult {
  pass: boolean;
  reason: string;
}

/**
 * The judge is a model too, so it is another thing that can be wrong.
 * Keep its job narrow — one criterion, one boolean — and it stays stable.
 *
 * It runs through the same Agent SDK as the agent: no tools, one turn,
 * and the same login — no separate API key.
 */
export async function judge(
  question: string,
  criterion: string,
  answer: string,
): Promise<JudgeResult> {
  let text = "";

  for await (const message of query({
    prompt: `QUESTION: ${question}\n\nCRITERION: ${criterion}\n\nANSWER:\n${answer || "(empty)"}`,
    options: {
      systemPrompt: SYSTEM,
      model: "claude-sonnet-5-5",
      tools: [],
      maxTurns: 1,
    },
  })) {
    if (message.type === "result" && message.subtype === "success") text = message.result;
  }

  try {
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return { pass: Boolean(parsed.pass), reason: String(parsed.reason ?? "") };
  } catch {
    return { pass: false, reason: "judge returned unparseable output" };
  }
}
