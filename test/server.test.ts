import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";
import { MemoryStore } from "../src/store.ts";

async function connect() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(new MemoryStore(":memory:"), "okut").connect(serverSide);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    return { text: (res.content as { text: string }[])[0].text, isError: res.isError === true };
  };
  return { client, call };
}

test("exposes the four memory tools", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["forget", "recall", "recent", "remember"]);
});

test("remember, recall and forget over the MCP protocol", async () => {
  const { call } = await connect();
  assert.match((await call("remember", { content: "Escrow deposits go HELD -> REFUNDED or FORFEITED", tags: ["escrow"] })).text, /Saved as #1/);
  await call("remember", { content: "Penpick uses Neon Postgres", project: "penpick" });

  const own = await call("recall", { query: "escrow deposit" });
  assert.match(own.text, /#1 \[okut\].*\(escrow\)\nEscrow deposits/);
  assert.equal((await call("recall", { query: "postgres" })).text, "No memories found.");
  assert.match((await call("recall", { query: "postgres", project: "*" })).text, /\[penpick\]/);

  assert.equal((await call("forget", { id: 1 })).text, "Forgot #1.");
  assert.equal((await call("recent", {})).text, "No memories found.");
});

test("refuses to save into every project at once", async () => {
  const { call } = await connect();
  const res = await call("remember", { content: "x", project: "*" });
  assert.equal(res.isError, true);
});
