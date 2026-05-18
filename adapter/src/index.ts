import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import Fastify from "fastify";
import { loadWorkspaces } from "./workspaces/registry.ts";
import { models } from "./routes/models.ts";
import { chatCompletions } from "./routes/chat-completions.ts";
import { ensureRipgrepOnPath } from "./cursor/runtime.ts";
import { sdkCursorAdapter } from "./cursor/cursor-adapter.ts";
import { ConvStore } from "./state/conv-store.ts";
import { startIdleSweeper } from "./state/sweeper.ts";

if (!process.env.CURSOR_API_KEY) {
  throw new Error("CURSOR_API_KEY is required (load via --env-file=../.env or set in process env)");
}

const { rgDir } = ensureRipgrepOnPath();
if (!rgDir) {
  console.warn(
    "[adapter] No bundled rg found under ~/.local/share/cursor-agent/versions. " +
      "Cursor SDK tool-use will crash with 'Ripgrep path not configured'. " +
      "Install cursor-agent CLI or set PATH to include an rg binary.",
  );
}

const PORT = Number(process.env.ADAPTER_PORT ?? 8080);
const HOST = process.env.ADAPTER_HOST ?? "0.0.0.0";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACES_DIR = process.env.WORKSPACES_DIR
  ? resolve(process.env.WORKSPACES_DIR)
  : resolve(__dirname, "..", "..", "workspaces");
const STATE_DIR = process.env.ADAPTER_STATE_DIR
  ? resolve(process.env.ADAPTER_STATE_DIR)
  : resolve(__dirname, "..", "..", ".run", "adapter");

const app = Fastify({
  logger: {
    transport:
      process.env.NODE_ENV === "production"
        ? undefined
        : {
            target: "pino-pretty",
            options: { translateTime: "HH:MM:ss.l", ignore: "pid,hostname" },
          },
  },
  bodyLimit: 5 * 1024 * 1024,
});

const workspaces = await loadWorkspaces(WORKSPACES_DIR);
app.log.info(
  {
    workspacesDir: WORKSPACES_DIR,
    count: workspaces.length,
    ids: workspaces.map((w) => w.id),
  },
  "workspaces registry loaded",
);

if (workspaces.length === 0) {
  app.log.warn("no workspaces found — adapter will reject every chat completion request");
}

const convStore = new ConvStore(join(STATE_DIR, "conv-state.sqlite"));
app.log.info({ stateDir: STATE_DIR }, "conv store opened");

// Idle-agent sweeper. Defaults: 24h TTL, 30min interval. Tunable for
// smoke tests via fractional values (e.g. ADAPTER_IDLE_TTL_HOURS=0.001).
const idleTtlHours = parseFloat(process.env.ADAPTER_IDLE_TTL_HOURS ?? "24");
const sweeperIntervalMin = parseFloat(process.env.ADAPTER_SWEEPER_INTERVAL_MIN ?? "30");
const sweeper = startIdleSweeper({
  store: convStore,
  ttlMs: idleTtlHours * 3600 * 1000,
  intervalMs: sweeperIntervalMin * 60 * 1000,
  log: {
    info: (obj, msg) => app.log.info(obj, msg),
    warn: (obj, msg) => app.log.warn(obj, msg),
  },
});
app.log.info(
  { idleTtlHours, sweeperIntervalMin },
  "idle-agent sweeper started",
);

app.get("/health", async () => ({
  ok: true,
  workspaces: workspaces.length,
  workspacesDir: WORKSPACES_DIR,
  stateDir: STATE_DIR,
}));

await app.register(models, { workspaces });
await app.register(chatCompletions, { workspaces, convStore, cursorAdapter: sdkCursorAdapter });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  try {
    sweeper.stop();
    await app.close();
  } finally {
    convStore.close();
    process.exit(0);
  }
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: PORT, host: HOST });
