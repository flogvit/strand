import { createHash } from "node:crypto";
import type { DefinitionContent, Hash } from "./model.ts";

/** Content address of a definition: a hash of its *structure* (deps + body),
 *  deliberately NOT its name or intent — those are binding-level metadata,
 *  exactly as in Unison. Two agents that independently write identical content
 *  land on the same hash and therefore cannot conflict. Deps are sorted so the
 *  address is stable regardless of the order an agent happened to list them. */
export function hashOf(content: DefinitionContent): Hash {
  const canonical = JSON.stringify({
    deps: [...content.deps].sort(),
    body: content.body,
  });
  return "#" + createHash("sha256").update(canonical).digest("hex").slice(0, 8);
}
