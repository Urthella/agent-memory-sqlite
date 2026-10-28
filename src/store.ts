import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface Memory {
  id: number;
  project: string;
  content: string;
  tags: string[];
  updatedAt: string;
}

type Row = { id: number; project: string; content: string; tags: string; updated_at: string; relevance?: number };

const HALF_LIFE_DAYS = 30;

// memories_fts is an external-content index kept in sync by triggers,
// so the text is stored once and every write path updates search.
const SCHEMA = `
create table if not exists memories (
  id         integer primary key,
  project    text not null,
  content    text not null,
  tags       text not null default '',
  hash       text not null,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  unique (project, hash)
);
create virtual table if not exists memories_fts using fts5(
  content, tags, content = 'memories', content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);
create trigger if not exists memories_ai after insert on memories begin
  insert into memories_fts (rowid, content, tags) values (new.id, new.content, new.tags);
end;
create trigger if not exists memories_ad after delete on memories begin
  insert into memories_fts (memories_fts, rowid, content, tags) values ('delete', old.id, old.content, old.tags);
end;
create trigger if not exists memories_au after update on memories begin
  insert into memories_fts (memories_fts, rowid, content, tags) values ('delete', old.id, old.content, old.tags);
  insert into memories_fts (rowid, content, tags) values (new.id, new.content, new.tags);
end;
`;

export class MemoryStore {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    // Several agent sessions can share one file: WAL lets them read while one writes.
    this.db.exec("pragma journal_mode = wal; pragma busy_timeout = 5000;");
    this.db.exec(SCHEMA);
  }

  /** Saves a memory. Saving the same text in the same project refreshes it instead of duplicating. */
  remember(project: string, content: string, tags: string[] = []): Memory {
    const text = content.trim();
    if (!text) throw new Error("content is empty");
    const hash = createHash("sha256").update(text).digest("hex");
    const row = this.db
      .prepare(
        `insert into memories (project, content, tags, hash) values (?, ?, ?, ?)
         on conflict (project, hash) do update set tags = excluded.tags, updated_at = datetime('now')
         returning *`,
      )
      .get(project, text, normalizeTags(tags), hash) as Row;
    return toMemory(row);
  }

  /** Keyword search, best BM25 match first, boosted by recency. `project = null` searches all projects. */
  recall(query: string, project: string | null, limit = 5): Memory[] {
    const match = toFtsQuery(query);
    if (!match) return this.recent(project, limit);
    // ponytail: rerank only the top limit*4 BM25 hits; an embedding index is the upgrade if keyword recall falls short.
    const rows = this.db
      .prepare(
        `select m.*, -bm25(memories_fts) as relevance
         from memories_fts join memories m on m.id = memories_fts.rowid
         where memories_fts match ? and (? is null or m.project = ?)
         order by bm25(memories_fts) limit ?`,
      )
      .all(match, project, project, limit * 4) as Row[];
    const now = Date.now();
    return rows
      .map((r) => ({ r, score: r.relevance! * (1 + recency(r.updated_at, now)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ r }) => toMemory(r));
  }

  recent(project: string | null, limit = 10): Memory[] {
    const rows = this.db
      .prepare(`select * from memories where ? is null or project = ? order by updated_at desc, id desc limit ?`)
      .all(project, project, limit) as Row[];
    return rows.map(toMemory);
  }

  forget(id: number): boolean {
    return this.db.prepare("delete from memories where id = ?").run(id).changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

/** Turns free text into a safe FTS5 query: every word becomes a quoted prefix term, OR-ed together. */
export function toFtsQuery(query: string): string {
  const words = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return words.map((w) => `"${w}"*`).join(" OR ");
}

function normalizeTags(tags: string[]): string {
  return tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean).join(" ");
}

/** 1 for a memory touched just now, 0.5 after HALF_LIFE_DAYS, approaching 0 after that. */
function recency(updatedAt: string, now: number): number {
  const ageDays = (now - Date.parse(updatedAt.replace(" ", "T") + "Z")) / 86_400_000;
  return 0.5 ** (Math.max(ageDays, 0) / HALF_LIFE_DAYS);
}

function toMemory(r: Row): Memory {
  return { id: r.id, project: r.project, content: r.content, tags: r.tags ? r.tags.split(" ") : [], updatedAt: r.updated_at };
}
