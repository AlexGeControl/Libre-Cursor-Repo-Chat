/**
 * Build the single-`agent.send` prompt used when we have to start a
 * fresh Cursor agent for a conversation that LibreChat thinks is
 * ongoing — either because the convKey was never mapped (e.g. our
 * SQLite was wiped) or the mapped Cursor agent has been GC'd
 * server-side (UnknownAgentError on resume).
 *
 * The agent gets the prior turns as context, then the latest user
 * message clearly marked as the question to actually answer.
 *
 * Contract:
 *   - `messages` must be non-empty.
 *   - The final message must be `role: "user"` (the message the user
 *     just sent).
 *   - Returns the bare latest text (no preamble) when there is
 *     effectively no prior history — either `messages.length === 1`,
 *     or every prior turn is empty/unsupported. This keeps the
 *     happy path (first turn of a new conversation) free of
 *     rehydration ceremony.
 *
 * Behavior is exercised by `test/cursor/rehydration.test.ts`.
 */

type ChatMessage = { role: string; content: unknown };

export function buildRehydrationPrompt(messages: ChatMessage[]): string {
  if (messages.length === 0) {
    throw new Error("buildRehydrationPrompt: requires at least one message");
  }

  const last = messages[messages.length - 1];
  if (last.role !== "user") {
    throw new Error("buildRehydrationPrompt: last message must be from the user");
  }

  const latestText = extractText(last.content);

  const priorLines = messages
    .slice(0, -1)
    .map((m) => {
      const text = extractText(m.content);
      if (!text) return null;
      return `${m.role.toUpperCase()}: ${text}`;
    })
    .filter((line): line is string => line !== null);

  if (priorLines.length === 0) {
    return latestText;
  }

  return [
    "The following is a prior exchange from a conversation you participated in",
    "but no longer have in memory. Use it as context only — do not respond to",
    "any of the prior user turns.",
    "",
    "=== Prior conversation ===",
    priorLines.join("\n"),
    "=== End prior conversation ===",
    "",
    "The user has now sent a new message. Respond to this message only:",
    "",
    latestText,
  ].join("\n");
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("");
  }
  return "";
}
