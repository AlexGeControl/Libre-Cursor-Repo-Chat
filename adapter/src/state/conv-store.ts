import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export interface ConvAgentRow {
  cursorAgentId: string;
  skillId: string;
  createdAt: number;
  lastUsedAt: number;
}

/**
 * SQLite-backed mapping between LibreChat conversation keys and
 * Cursor `agentId`s. The convKey is derived once per request from
 * `(userId, conversationId)` in chat-completions.ts; this store
 * neither cares how it's constructed nor mutates it.
 *
 * Schema is intentionally tiny — Phase 1 doesn't need LRU eviction
 * or quotas. When (if) we scale beyond one host, swap this for the
 * same shape backed by Redis. Idle TTL can live in a sweeper later.
 */
export class ConvStore {
  private db: Database.Database;
  private getStmt: Database.Statement;
  private putStmt: Database.Statement;
  private touchStmt: Database.Statement;
  private deleteStmt: Database.Statement;
  private listStaleStmt: Database.Statement;
  private deleteStaleStmt: Database.Statement;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conv_agents (
        conv_key TEXT PRIMARY KEY,
        cursor_agent_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conv_agents_last_used
        ON conv_agents(last_used_at);
    `);

    this.getStmt = this.db.prepare(
      "SELECT cursor_agent_id AS cursorAgentId, skill_id AS skillId, " +
        "created_at AS createdAt, last_used_at AS lastUsedAt " +
        "FROM conv_agents WHERE conv_key = ?",
    );
    this.putStmt = this.db.prepare(
      "INSERT INTO conv_agents (conv_key, cursor_agent_id, skill_id, created_at, last_used_at) " +
        "VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(conv_key) DO UPDATE SET " +
        "  cursor_agent_id = excluded.cursor_agent_id, " +
        "  skill_id        = excluded.skill_id, " +
        "  last_used_at    = excluded.last_used_at",
    );
    this.touchStmt = this.db.prepare(
      "UPDATE conv_agents SET last_used_at = ? WHERE conv_key = ?",
    );
    this.deleteStmt = this.db.prepare("DELETE FROM conv_agents WHERE conv_key = ?");
    this.listStaleStmt = this.db.prepare(
      "SELECT conv_key FROM conv_agents WHERE last_used_at < ? ORDER BY last_used_at ASC",
    );
    this.deleteStaleStmt = this.db.prepare("DELETE FROM conv_agents WHERE last_used_at < ?");
  }

  /**
   * Delete every row whose `last_used_at` is strictly less than
   * `beforeMs`. Returns the deleted `convKey`s in ascending
   * `last_used_at` order (oldest first), so callers can log a
   * representative sample without re-sorting.
   *
   * Boundary is strict: a row with `last_used_at === beforeMs` is NOT
   * deleted. See sweeper.spec.md → S5.
   *
   * Atomic via a single SQLite transaction.
   */
  deleteStale(beforeMs: number): string[] {
    const tx = this.db.transaction((before: number): string[] => {
      const rows = this.listStaleStmt.all(before) as Array<{ conv_key: string }>;
      if (rows.length === 0) return [];
      this.deleteStaleStmt.run(before);
      return rows.map((r) => r.conv_key);
    });
    return tx(beforeMs);
  }

  get(convKey: string): ConvAgentRow | null {
    const row = this.getStmt.get(convKey) as ConvAgentRow | undefined;
    return row ?? null;
  }

  put(convKey: string, cursorAgentId: string, skillId: string): void {
    const now = Date.now();
    this.putStmt.run(convKey, cursorAgentId, skillId, now, now);
  }

  touch(convKey: string): void {
    this.touchStmt.run(Date.now(), convKey);
  }

  delete(convKey: string): void {
    this.deleteStmt.run(convKey);
  }

  close(): void {
    this.db.close();
  }
}
