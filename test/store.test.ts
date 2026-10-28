import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { MemoryStore, toFtsQuery } from "../src/store.ts";

test("recall finds memories by word prefix", () => {
  const store = new MemoryStore(":memory:");
  store.remember("okut", "Bids are applied atomically with a Redis Lua script", ["redis"]);
  store.remember("okut", "First 100 members get the perk under Postgres advisory locks");
  const hits = store.recall("lock", "okut");
  assert.equal(hits.length, 1);
  assert.match(hits[0].content, /advisory locks/);
});

test("tags are searchable and normalized", () => {
  const store = new MemoryStore(":memory:");
  store.remember("p", "Use pnpm, not npm", ["Package Manager"]);
  assert.deepEqual(store.recall("package-manager", "p")[0].tags, ["package-manager"]);
});

test("saving the same text twice refreshes instead of duplicating", () => {
  const store = new MemoryStore(":memory:");
  const a = store.remember("p", "  Tests run with node --test  ");
  const b = store.remember("p", "Tests run with node --test", ["testing"]);
  assert.equal(a.id, b.id);
  assert.deepEqual(b.tags, ["testing"]);
  assert.equal(store.recent("p").length, 1);
});

test("project scoping, with null meaning every project", () => {
  const store = new MemoryStore(":memory:");
  store.remember("okut", "Deploys go to Vercel");
  store.remember("penpick", "Deploys go to Vercel too");
  assert.equal(store.recall("vercel", "okut").length, 1);
  assert.equal(store.recall("vercel", null).length, 2);
});

test("forget removes the memory from search", () => {
  const store = new MemoryStore(":memory:");
  const m = store.remember("p", "Temporary note about migrations");
  assert.equal(store.forget(m.id), true);
  assert.equal(store.forget(m.id), false);
  assert.deepEqual(store.recall("migrations", "p"), []);
});

test("diacritics fold, so ascii queries find Turkish text", () => {
  const store = new MemoryStore(":memory:");
  store.remember("p", "Ağaç yapısı DAG olarak modellenir");
  assert.equal(store.recall("agac", "p").length, 1);
});

test("punctuation and FTS operators in queries are harmless", () => {
  const store = new MemoryStore(":memory:");
  store.remember("p", "The redis-lua bid engine");
  assert.equal(store.recall(`what's the "redis-lua" thing? NOT AND (*`, "p").length, 1);
  assert.equal(toFtsQuery("?!"), "");
  assert.equal(store.recall("?!", "p").length, 1, "empty query falls back to recent");
});

test("recency breaks ties between equally relevant memories", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-memory-"));
  const path = join(dir, "m.db");
  try {
    const store = new MemoryStore(path);
    const old = store.remember("p", "Cache invalidation uses version keys");
    const fresh = store.remember("p", "Cache warmup runs on deploy");
    const raw = new DatabaseSync(path);
    raw.prepare("update memories set updated_at = datetime('now', '-90 days') where id = ?").run(old.id);
    raw.close();
    assert.deepEqual(store.recall("cache", "p").map((m) => m.id), [fresh.id, old.id]);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
