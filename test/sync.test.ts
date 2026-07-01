import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/core/store.ts";
import { compileProgram } from "../src/pipeline.ts";
import { emptyNamespace, observe, resolve, view } from "../src/distributed/crdt.ts";
import { missing, sync, type Peer } from "../src/distributed/sync.ts";

function peer(): Peer {
  return { store: new Store(), ns: emptyNamespace() };
}

/** Author definitions into a peer's own store + CRDT namespace; return the bindings. */
function author(p: Peer, by: string, src: string): { name: string; hash: string }[] {
  const binds = compileProgram(src, p.store, new Map(), []);
  for (const b of binds) p.ns = observe(p.ns, b.name, { hash: b.hash, by, intent: "" });
  return binds;
}

const names = (p: Peer) => [...view(p.ns).namespace.keys()].sort();

test("three peers gossiping in a ring all converge (no coordinator, no SPOF)", () => {
  const a = peer(), b = peer(), c = peer();
  author(a, "a", "def add (x: Int) (y: Int) -> Int = x + y");
  author(b, "b", "def neg (x: Int) -> Int = 0 - x");
  author(c, "c", "def sq (x: Int) -> Int = x * x");

  // ring gossip — no peer talks to every other directly
  sync(a, b);
  sync(b, c);
  sync(c, a);

  const all = ["add", "neg", "sq"];
  for (const p of [a, b, c]) {
    assert.deepEqual(names(p), all, "every peer resolved every name");
    assert.equal(p.store.hashes().length, 3, "every peer holds the union of objects");
  }
  assert.equal(missing(a.store, c.store.hashes()).length, 0, "a is missing nothing c has");
});

test("contention parks on all peers, and a resolution propagates by gossip", () => {
  const a = peer(), b = peer();
  const [fa] = author(a, "a", "def f (x: Int) -> Int = x + 1");
  author(b, "b", "def f (x: Int) -> Int = x + 2"); // same name, different content

  sync(a, b);
  for (const p of [a, b]) {
    assert.equal(view(p.ns).conflicts.length, 1, "f is parked on both peers");
    assert.equal(view(p.ns).namespace.has("f"), false);
  }

  // a human resolves on peer a; the decision gossips to b
  a.ns = resolve(a.ns, "f", fa.hash, "human", 1);
  sync(a, b);
  for (const p of [a, b]) {
    assert.equal(view(p.ns).conflicts.length, 0, "park settled everywhere");
    assert.equal(view(p.ns).namespace.get("f")?.hash, fa.hash);
  }
});
