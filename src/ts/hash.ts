import { createHash } from "node:crypto";

/** Content address of a TypeScript definition: a hash of its canonically
 *  printed text (which includes its name). Two agents who write the same
 *  definition land on the same hash and converge. */
export function hashText(text: string): string {
  return "#" + createHash("sha256").update(text).digest("hex").slice(0, 8);
}
