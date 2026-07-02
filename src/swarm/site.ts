import type { DefSpec } from "./plan.ts";

/** The Strand website, decomposed for the swarm. Three levels: a pure HTML
 *  kit (Text combinators — exact-testable), the page components (wide — this
 *  is where parallel workers overlap), and the page assembly. All rendering
 *  is pure Text; the driver evaluates `pageIndex`/`siteStyles` and writes
 *  files. Strand has no substring primitives, so HTML-escaping is pinned as a
 *  convention (write entities in literals), not a definition.
 *
 *  Design direction (pinned below as conventions): phosphor-terminal
 *  editorial — near-black ink, phosphor green as THE semantic color (green =
 *  through the gate), JetBrains Mono for display/code/hashes, Spectral for
 *  prose. Every section carries the content hash of the definition that
 *  rendered it: the page displays its own provenance. */

export const WEBSITE: DefSpec[] = [
  // ---- level 1: the HTML kit (exact contracts, exact tests) ----------------
  {
    name: "el",
    intent: "plain element",
    deps: [],
    spec: 'el : Text -> Text -> Text — el name children = "<" ++ name ++ ">" ++ children ++ "</" ++ name ++ ">". Example: el "p" "hi" == "<p>hi</p>".',
  },
  {
    name: "elA",
    intent: "element with attributes",
    deps: [],
    spec: 'elA : Text -> Text -> Text -> Text — elA name attrs children = "<" ++ name ++ " " ++ attrs ++ ">" ++ children ++ "</" ++ name ++ ">". Example: elA "a" "href=\\"/x\\"" "go" == "<a href=\\"/x\\">go</a>".',
  },
  {
    name: "joinTexts",
    intent: "concatenate a list of Text",
    deps: [],
    spec: 'joinTexts : List Text -> Text — fold ++ over the list, empty list is "".',
  },
  {
    name: "divC",
    intent: "div with a class",
    deps: ["elA"],
    spec: 'divC : Text -> Text -> Text — divC cls children = elA "div" ("class=\\"" ++ cls ++ "\\"") children.',
  },
  {
    name: "sectionC",
    intent: "section with id and class",
    deps: ["elA"],
    spec: 'sectionC : Text -> Text -> Text -> Text — sectionC id cls children = elA "section" ("id=\\"" ++ id ++ "\\" class=\\"" ++ cls ++ "\\"") children.',
  },
  {
    name: "link",
    intent: "anchor",
    deps: ["elA"],
    spec: 'link : Text -> Text -> Text — link href label = elA "a" ("href=\\"" ++ href ++ "\\"") label.',
  },
  {
    name: "h1",
    intent: "h1 heading",
    deps: ["el"],
    spec: 'h1 : Text -> Text — h1 t = el "h1" t. Likewise-shaped helpers h2/h3 are separate defs.',
  },
  { name: "h2", intent: "h2 heading", deps: ["el"], spec: 'h2 : Text -> Text — h2 t = el "h2" t.' },
  { name: "h3", intent: "h3 heading", deps: ["el"], spec: 'h3 : Text -> Text — h3 t = el "h3" t.' },
  { name: "para", intent: "paragraph", deps: ["el"], spec: 'para : Text -> Text — para t = el "p" t.' },
  {
    name: "codeBlock",
    intent: "code block",
    deps: ["el"],
    spec: 'codeBlock : Text -> Text — codeBlock src = el "pre" (el "code" src).',
  },
  {
    name: "hashChip",
    intent: "content-hash badge",
    deps: ["elA"],
    spec: 'hashChip : Text -> Text — hashChip h = elA "span" "class=\\"hash\\"" ("#" ++ h). Renders a content-address badge.',
  },

  // ---- level 2: components (wide; copy is authored here) -------------------
  {
    name: "navbar",
    intent:
      'Site navbar: brand "strand" (mono, phosphor green) left; links right: Concept (#concept), Green-gate (#green-gate), Swarm (#swarm), Demo (#demo), GitHub (https://github.com/flogvit/strand). Wrap in elA "nav" with class "navbar"; links inside a divC "nav-links".',
    deps: ["elA", "divC", "link"],
    spec: "navbar : Text — zero-arg, the complete <nav> element.",
    test: false,
  },
  {
    name: "hero",
    intent:
      'Hero section, class "hero", id "top". Content: an eyebrow line (divC "eyebrow") reading "content-addressed &middot; coordinator-free &middot; green by construction"; h1: "Code as strands, not files."; a lead paragraph (class "lead"): Strand is a substrate where many AI agents author one codebase in parallel &mdash; definitions are identified by the hash of their structure, the type-checker is the gate, and the only conflict left is two agents binding the same name to different content. End with hashChip "02b3034b" and hashChip "36e5c408" in a divC "hero-hashes" plus a divC "hero-note" reading "every section on this page carries the hash of the definition that rendered it".',
    deps: ["sectionC", "divC", "h1", "para", "hashChip"],
    spec: "hero : Text — zero-arg, the complete hero <section>.",
    test: false,
  },
  {
    name: "statsBar",
    intent:
      'A stats strip, divC "stats", with four stat cells (each divC "stat" containing divC "stat-num" and divC "stat-label"): 22/22 "tasks green, one attempt each"; 0 "gate rejections"; 157 "model-written tests"; 1 "puzzle, independently verified". These are real numbers from the live claude swarm run.',
    deps: ["divC"],
    spec: "statsBar : Text — zero-arg, the stats strip element.",
    test: false,
  },
  {
    name: "conceptCards",
    intent:
      'Three cards (divC "cards" of divC "card"): (1) h3 "Identity is structure" — a definition&apos;s name is never its identity; its hash is. Two agents writing the same logic converge on the same hash. (2) h3 "References are pinned" — callers reference the hash, so rebinding a name can never silently break them. (3) h3 "Park, don&apos;t block" — the one true conflict (same name, different content) parks that name; everything else merges.',
    deps: ["divC", "h3", "para"],
    spec: "conceptCards : Text — zero-arg, the three concept cards.",
    test: false,
  },
  {
    name: "twoPlanes",
    intent:
      'Section id "concept", class "planes". h2 "Two planes". Prose: agents author a content-addressed graph; humans read a distilled TypeScript projection. Include a codeBlock showing this real Strand definition (entities for < and >): def rowOk (g: Grid) (row: Int) (v: Int) -&gt; Bool = rowHasFrom g row 0 v == false',
    deps: ["sectionC", "h2", "para", "codeBlock"],
    spec: "twoPlanes : Text — zero-arg section element.",
    test: false,
  },
  {
    name: "greenGate",
    intent:
      'Section id "green-gate", class "gate". h2 "The green-gate". Prose: nothing enters the namespace unless the whole namespace type-checks after it; correctness is the gate&apos;s job, not the agent&apos;s. A bad agent output is rejected and retried with the compiler&apos;s actual error &mdash; it can never corrupt the store. Include a divC "gate-badge" reading "green-gate: green".',
    deps: ["sectionC", "h2", "para", "divC"],
    spec: "greenGate : Text — zero-arg section element.",
    test: false,
  },
  {
    name: "swarmStory",
    intent:
      'Section id "swarm", class "swarm". h2 "A live swarm built this". Prose: a queue of 22 dependency-gated tasks, provider-agnostic workers, and a real claude model authored a complete Sudoku generator through the gate &mdash; every task landed green on its first attempt. The solver was then verified against a known puzzle by an oracle sharing zero code with the swarm, in both execution engines. Then include statsBar.',
    deps: ["sectionC", "h2", "para", "statsBar"],
    spec: "swarmStory : Text — zero-arg section element.",
    test: false,
  },
  {
    name: "sudokuDemo",
    intent:
      'Section id "demo", class "demo". h2 "The proof, running". Prose: the solver below is the swarm&apos;s own output &mdash; Strand transpiled to TypeScript, running in your browser. Then divC "demo-mount" "" as the mount point (a script fills it) and a divC "demo-hint" reading "press solve".',
    deps: ["sectionC", "h2", "para", "divC"],
    spec: "sudokuDemo : Text — zero-arg section element with an empty div.demo-mount inside.",
    test: false,
  },
  {
    name: "quickstart",
    intent:
      'Section id "quickstart", class "quickstart". h2 "Quickstart". A codeBlock with these lines separated by \\n: strand init / strand submit --as you --intent "add" --code "def double (n: Int) -&gt; Int = n * 2" / strand merge / strand eval "double 21" / strand-swarm plan &amp;&amp; strand-swarm work --as w1 --provider claude',
    deps: ["sectionC", "h2", "codeBlock"],
    spec: "quickstart : Text — zero-arg section element.",
    test: false,
  },
  {
    name: "footer",
    intent:
      'Footer, elA "footer" class "footer": left divC "footer-note" reading "authored by an agent swarm through the green-gate"; right a link to https://github.com/flogvit/strand labeled "source". Wrap both in divC "footer-inner".',
    deps: ["elA", "divC", "link"],
    spec: "footer : Text — zero-arg, the complete <footer> element.",
    test: false,
  },
  {
    name: "siteStyles",
    intent:
      'The complete stylesheet as one Text literal (lines joined with \\n). Design system: CSS vars on :root — --bg: #0b0f0e; --panel: #101714; --ink: #e8f2ec; --dim: #8aa396; --green: #3dfc9e; --amber: #ffb454; --line: #1d2a24. Fonts: body font-family "Spectral", serif; headings, nav, code, .hash, .stat-num font-family "JetBrains Mono", monospace. Dark page (background var(--bg), color var(--ink)), max-width 72rem centered content with generous padding. Navbar: sticky top, thin bottom border var(--line), brand in var(--green). Hero: large (min-height 70vh), h1 clamp(2.5rem,7vw,5rem) tight leading; .eyebrow small caps letter-spacing .2em color var(--green); .lead font-size 1.25rem color var(--dim) max-width 46rem; .hero-hashes gap row. .hash: mono, var(--green), background color-mix(in srgb, var(--green) 12%, transparent), border 1px solid var(--line), border-radius 999px, padding .2rem .7rem. .stats: grid 4 columns (2 on mobile), each .stat a panel (background var(--panel), border 1px solid var(--line), border-radius 12px, padding 1.2rem); .stat-num font-size 2.2rem color var(--green). .cards: grid 3 columns (1 on mobile) of .card panels. section padding 5rem 0; h2 mono with a leading "&gt; " rendered via h2::before { content: "> "; color: var(--green) }. pre: panel background, border, border-radius 12px, padding 1.2rem, overflow-x auto; code mono .95rem. .gate-badge: inline-block mono, color var(--green), border 1px solid var(--green), border-radius 8px, padding .3rem .8rem. .demo-mount table/grid styles: .sud { border-collapse: collapse } .sud td { width 2.2rem; height 2.2rem; text-align center; border 1px solid var(--line); font-family "JetBrains Mono", monospace } .sud td.given { color: var(--ink) } .sud td.solved { color: var(--green) } .demo-btn { mono, background var(--green), color #06110c, border none, border-radius 8px, padding .6rem 1.4rem, cursor pointer, font-weight 700 }. .footer: border-top 1px solid var(--line), padding 2rem 0, color var(--dim), .footer-inner flex space-between. Selection color: background var(--green), color #06110c. Responsive at 720px.',
    deps: [],
    spec: "siteStyles : Text — zero-arg, the full CSS file contents.",
    test: false,
  },

  // ---- level 3: assembly ----------------------------------------------------
  {
    name: "pageHead",
    intent:
      'The <head> element: meta charset utf-8; meta viewport width=device-width, initial-scale=1; title "Strand &mdash; code as strands, not files"; preconnect + stylesheet links for Google Fonts families JetBrains+Mono:wght@400;700 and Spectral:wght@400;600 (https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&amp;family=Spectral:wght@400;600&amp;display=swap); link rel="stylesheet" href="styles.css". Build void/link tags as raw literals.',
    deps: ["el"],
    spec: "pageHead : Text — zero-arg, the complete <head> element.",
    test: false,
  },
  {
    name: "pageBody",
    intent:
      'The <body>: navbar, then a main element (el "main") containing hero, conceptCards, twoPlanes, greenGate, swarmStory, sudokuDemo, quickstart; then footer; then a script tag: <script type="module" src="demo.js"></script> as a raw literal at the end.',
    deps: ["el", "navbar", "hero", "conceptCards", "twoPlanes", "greenGate", "swarmStory", "sudokuDemo", "quickstart", "footer"],
    spec: "pageBody : Text — zero-arg, the complete <body> element.",
    test: false,
  },
  {
    name: "pageIndex",
    intent: 'The full document: "<!DOCTYPE html>" ++ elA "html" "lang=\\"en\\"" (pageHead ++ pageBody).',
    deps: ["elA", "pageHead", "pageBody"],
    spec: "pageIndex : Text — zero-arg, the complete index.html contents.",
    test: false,
  },
];

/** Conventions every website task's agent must see (recorded for all names). */
export const SITE_CONVENTIONS: { subject: string; body: string }[] = [
  {
    subject: "html-safety",
    body: "Strand has no substring primitives, so there is no escapeHtml. Content literals must be HTML-safe as written: use &amp; &lt; &gt; &quot; &middot; &mdash; &apos; entities directly in the source text. Never emit a raw & or < inside text content.",
  },
  {
    subject: "css-and-classes",
    body: 'Semantic kebab-case classes only (hero, nav-links, stat-num). Design tokens are CSS vars: --bg --panel --ink --dim --green --amber --line. Display/code/hash text is "JetBrains Mono", prose is "Spectral". Phosphor green (--green) is the semantic color for "through the gate" — use it for brand, hashes, stat numbers and the gate badge, sparingly elsewhere.',
  },
  {
    subject: "voice",
    body: "Copy is terse, precise, systems-engineering register. No exclamation marks, no marketing adjectives, lowercase brand name 'strand' in the navbar. Sentences carry facts (hashes, counts, guarantees), not hype.",
  },
  {
    subject: "test-shape",
    body: 'Kit functions get exact-equality tests (e.g. tst_el = el "p" "hi" == "<p>hi</p>"). Zero-arg component defs get a single smoke test comparing against their own full literal ONLY if short; otherwise the component is verified by the external oracle — do not fabricate a long duplicate literal just to have a test.',
  },
];
