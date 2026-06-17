import { Store } from "./store.ts";
import { hashOf } from "./hash.ts";
import { merge, resolveConflict } from "./merge.ts";
import { project } from "./project.ts";
import type { DefinitionContent, Namespace, Transaction } from "./model.ts";

const def = (deps: string[], body: string): DefinitionContent => ({ deps, body });
const H = hashOf;

const store = new Store();

// --- base: a tiny existing "codebase" three agents will work against ---
const auth = def([], "fn auth() {...}");
const authH = store.put(auth);
const base: Namespace = new Map([
  ["auth", { hash: authH, intent: "core auth primitive", by: "seed" }],
  ["signup", { hash: store.put(def([authH], "fn signup(){ auth() }")), intent: "v0 signup", by: "seed" }],
  ["login", { hash: store.put(def([authH], "fn login(){ auth() }")), intent: "v0 login", by: "seed" }],
]);

// --- three agents author in parallel against `base` ---

// agent-12: add validateEmail, rebind signup to use it
const validateEmail = def([], "fn validateEmail() {...}");
const signupA = def([authH, H(validateEmail)], "fn signup(){ validateEmail(); auth() }");
const tx12: Transaction = {
  by: "agent-12",
  puts: [validateEmail, signupA],
  binds: [
    { name: "validateEmail", hash: H(validateEmail), intent: "email validation" },
    { name: "signup", hash: H(signupA), intent: "validate email on signup" },
  ],
};

// agent-37: add hashPassword, ALSO rebind signup (collides with agent-12 on `signup`)
const hashPassword = def([], "fn hashPassword() {...}");
const signupB = def([authH, H(hashPassword)], "fn signup(){ hashPassword(); auth() }");
const tx37: Transaction = {
  by: "agent-37",
  puts: [hashPassword, signupB],
  binds: [
    { name: "hashPassword", hash: H(hashPassword), intent: "password hashing" },
    { name: "signup", hash: H(signupB), intent: "hash password on signup" },
  ],
};

// agent-50: add rateLimit, rebind login (independent — must auto-merge clean)
const rateLimit = def([], "fn rateLimit() {...}");
const loginC = def([authH, H(rateLimit)], "fn login(){ rateLimit(); auth() }");
const tx50: Transaction = {
  by: "agent-50",
  puts: [rateLimit, loginC],
  binds: [
    { name: "rateLimit", hash: H(rateLimit), intent: "rate limiting" },
    { name: "login", hash: H(loginC), intent: "rate-limit login" },
  ],
};

const result = merge(base, store, [tx12, tx37, tx50]);

console.log("=== after parallel merge of agent-12, agent-37, agent-50 ===\n");
console.log(project(result.namespace, result.conflicts));
console.log("\napplied  :", result.applied.sort().join(", "));
console.log("conflicts:", result.conflicts.map((c) => c.name).join(", ") || "none");
console.log("rejected :", result.rejected.map((r) => `${r.name}(${r.reason})`).join(", ") || "none");

console.log(
  "\nNote: validateEmail, hashPassword, rateLimit, login all merged with zero ceremony.",
);
console.log("Only `signup` — the one name two agents truly fought over — is parked.");

// settle the parked conflict later, in favour of agent-37, without rewinding anything
const signupConflict = result.conflicts.find((c) => c.name === "signup")!;
const resolved = resolveConflict(result.namespace, signupConflict, H(signupB));
console.log("\n=== after resolving `signup` -> agent-37 ===\n");
console.log(project(resolved));
