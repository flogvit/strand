import { StrandSyntaxError } from "../errors.ts";

export interface Token {
  kind: "ident" | "int" | "text" | "sym" | "eof";
  value: string;
  pos: number;
}

const TWO_CHAR = new Set(["->", "==", "++"]);
const ONE_CHAR = new Set(["(", ")", ":", "=", "+", "-", "*", "<", ">", "{", "}", "|"]);

/** Turn Strand source into a token stream. Supports `#` line comments. */
export function lex(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "#") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== '"') {
        s += src[j];
        j++;
      }
      if (j >= src.length) throw new StrandSyntaxError("unterminated string", i);
      toks.push({ kind: "text", value: s, pos: i });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      toks.push({ kind: "int", value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push({ kind: "ident", value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR.has(two)) {
      toks.push({ kind: "sym", value: two, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR.has(c)) {
      toks.push({ kind: "sym", value: c, pos: i });
      i++;
      continue;
    }
    throw new StrandSyntaxError(`unexpected character '${c}'`, i);
  }
  toks.push({ kind: "eof", value: "", pos: src.length });
  return toks;
}
