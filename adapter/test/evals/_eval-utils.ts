/**
 * Shared helpers for evals against the running adapter. Not a test
 * file itself — the leading underscore in the filename signals
 * "support/infrastructure, not a spec."
 *
 * Evals POST to a live adapter on the host and assert on the assistant
 * text in the OpenAI-shape response. They are inherently slower and
 * softer than unit tests (real LLM, real Cursor, sometimes real
 * external services). See workspaces/eval-context-mgmt-configured-v1/eval.spec.md
 * for the spec and `adapter/test/README.md` for the eval discipline.
 */

const ADAPTER_URL = process.env.ADAPTER_URL ?? "http://127.0.0.1:8080";
const DEFAULT_WORKSPACE = "eval-context-mgmt-configured-v1";
const DEFAULT_USER = "eval-bot";

export interface AskOptions {
  /** Override the adapter URL for a single call. */
  adapterUrl?: string;
  /** Override the workspace id. Defaults to the context-mgmt-eval workspace. */
  workspace?: string;
  /** Provide a stable convId, or let one be generated per call. */
  convId?: string;
  /** Override the user id (rarely needed). */
  user?: string;
  /** Per-request timeout in ms. Defaults to 120s — Cursor agents can take a while on tool use. */
  timeoutMs?: number;
}

export interface AskResult {
  content: string;
  raw: unknown;
}

export async function askEval(prompt: string, opts: AskOptions = {}): Promise<AskResult> {
  const adapterUrl = opts.adapterUrl ?? ADAPTER_URL;
  const workspace = opts.workspace ?? DEFAULT_WORKSPACE;
  const convId = opts.convId ?? `eval-${Math.random().toString(36).slice(2, 10)}`;
  const user = opts.user ?? DEFAULT_USER;
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const resp = await fetch(`${adapterUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LibreChat-Conversation-Id": convId,
      },
      body: JSON.stringify({
        model: workspace,
        stream: false,
        user,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: ctrl.signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "<no body>");
      throw new Error(`adapter ${resp.status} ${resp.statusText}: ${body}`);
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    return { content, raw: json };
  } finally {
    clearTimeout(timer);
  }
}

export async function adapterAvailable(adapterUrl: string = ADAPTER_URL): Promise<boolean> {
  try {
    const r = await fetch(`${adapterUrl}/health`, { signal: AbortSignal.timeout(2_000) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Format an assistant response into a short preview suitable for
 * assertion error messages — collapses whitespace, caps at 400 chars.
 */
export function preview(text: string, maxChars = 400): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > maxChars ? flat.slice(0, maxChars - 3) + "..." : flat;
}
