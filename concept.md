# ai-git — konsept (levende dokument)

> Status: v0. Justeres fortløpende. Prioriteringen er ærlig etter **hva som faktisk
> hjelper Claude når den kjører mange agenter**, ikke etter hva som er kulest å bygge.

## Nordstjerne

La én person trygt la mange AI-agenter jobbe på samme kodebase samtidig, **uten** at
det rotet til det menneskene ser og godkjenner til slutt.

ai-git er ikke et nytt versjonssystem. Det er et **arbeids- og koordineringslag oppå git**.
Git eier historikk og upstream. ai-git eier arbeidsfasen.

## Ufravikelig invariant

To plan, alltid adskilt:

- **Arbeidsplanet** (maskinens): støyete, parallelt, kastbart. Lever i `refs/ai-git/...`.
  Går *aldri* upstream.
- **Fortellingsplanet** (menneskets): rene git-commits. Én logisk endring per commit,
  intensjon som melding, alt grønt. Det er *dette* mennesket reviewer.

> Regel som aldri brytes: fortellingsplanet er en **tapsfri projeksjon til ren git**.
> Arbeidsplanet rører aldri upstream.

---

## Prioritering

### P0 — bygg dette først (høy verdi, lav risiko, hjelper meg umiddelbart)

#### 1. Workspace-abstraksjon (`cell`)
- **Hva:** agenten ber om en *workspace*, ikke en worktree. Systemet velger worktree /
  overlay / copy-on-write bak kulissene. Delt build-cache (`node_modules`, `.venv`, `target`).
- **Hvorfor det hjelper:** worktree-oppsett/-riving og reinstall av avhengigheter per agent
  er ekte friksjon i dag. Dette fjerner den hver gang.
- **Åpne spørsmål:** hvilken default-strategi? Hvordan dele cache trygt mellom parallelle celler?

#### 2. Distillering (messy → rent)
- **Hva:** kollaps en agents tusen mikrosteg til 1–k rene commits, gruppert på intensjon,
  blindspor droppet. Broen fra arbeidsplanet til fortellingsplanet.
- **Hvorfor det hjelper:** i dag må jeg enten støye til historikken eller drive
  rebase/squash-akrobatikk manuelt. Dette automatiserer steget jeg gjør dårlig.
- **Åpne spørsmål:** gruppering er heuristisk — hvor mye styres av intensjon-metadata vs.
  filendringer? Hvordan presentere for menneskelig godkjenning før `land`?

### P1 — nyttig, men i praksis CI tettere koblet

#### 3. Grønn trunk + gated integrasjon
- **Hva:** svermen har en integrasjonsbranch som *alltid* er grønn. `integrate` kjører
  bygg+test; rødt spretter tilbake til agenten.
- **Hvorfor:** «aldri merge inn i grønt noe som gjør det rødt», håndhevet av systemet.
- **Forbehold:** dette er i hovedsak CI koblet tettere på. Verdi finnes, men ikke ny magi.

#### 4. Intensjon per endring
- **Hva:** hvert steg/commit bærer «hva jeg prøvde å oppnå» + testresultat.
- **Hvorfor:** trivielt å lagre, gull verdt for distillering og review.

### P2 — skeptisk (kostbart å bygge; suksess betyr ofte at noe annet gikk galt)

#### 5. Claims / leasing (koordinering før konflikt)
- **Hva:** agent reserverer en region (sti, etter hvert symbol-nivå) før skriving.
- **Hvorfor skeptisk:** hvis jeg *trenger* fingranulert låsing, har jeg som regel
  partisjonert arbeidet dårlig lenger oppe. Bedre å unngå overlapp enn å håndtere det elegant.
- **Reell risiko:** hver `claim`/`integrate` er en rundtur + protokoll jeg må følge riktig.
  For mye seremoni gjør meg tregere enn rå git worktrees.

#### 6. Semantisk merge
- **Hva:** merge som forstår om koden henger sammen på tvers av filer (AST/type-nivå).
- **Hvorfor skeptisk:** forskningsnær. Med god partisjonering trengs den sjelden.

---

## Den ærlige metakonklusjonen

Flaskehalsen er sjelden merge-mekanikk. «100 agenter på samme repo» er nesten alltid feil
*form*: når mange agenter er produktive, er det fordi oppgaven lot seg dele i smale,
uavhengige biter. Den største gevinsten ligger i **å hindre at agentene noensinne rører
samme kode** — et planleggings-/orkestreringslag — ikke i å håndtere kollisjonen elegant.

Dette dokumentet bør derfor vurdere om et **orkestreringslag** (deler arbeidet riktig)
hører hjemme her, ved siden av versjonslaget.

## To veier: pragmatisk lag vs. agent-native substrat

Spørsmål: kunne problemet løses med et eget språk/substrat? Merge-konflikt er et *symptom*;
rotårsaken er at vanlige språk tillater implisitt kobling (kall, delte mutbare typer, globale
registre) og lagrer kode som tekstfiler. Et substrat kan hindre at konflikten oppstår i det hele tatt.

**Reneste spaker (et substrat, ikke et git-lag):**
1. Innholds-adressert kode i stedet for tekstfiler — **Unison** beviser at dette dreper tekstuelle
   merge-konflikter HELT. To planene i dette dokumentet blir da bokstavelige: agenter forfatter i
   konflikt-fri representasjon, mennesket leser en projeksjon.
2. Eksplisitte, håndhevede modulgrenser.
3. Type-/effektsystem som *er* grønn-gaten (kompilatoren = semantisk sjekk).

**Den nye variabelen (det som gjør dette mulig NÅ, ikke i 2005):** hvis AGENTEN er forfatteren,
faller innvendingen som drepte alle tidligere språk — «mennesker må lære det, økosystemet finnes
ikke». Agenten bryr seg ikke om syntaks; mennesket leser en auto-generert projeksjon.

**Knaggen som avgjør oppfinnelse vs. enda-en-Unison:** radikal omtenkning vinner bare med et
BROHODE der den gamle tingen er katastrofalt dårlig (Git hadde Linux-kjernen; Unison fant aldri
sitt → vant ikke tross teknisk briljans). Det avgjørende spørsmålet er derfor ikke «klarer vi det
teknisk» men **hvor er brohodet** — hvor er agent-skrevet kode eneste fornuftige måte, så vi ikke
kjemper mot Pythons nettverkseffekt? Kandidater: rent greenfield agent-genererte tjenester (ingen
menneskelig forfatter), eller svermer der 2–4-taket er en hard blokker og smerten er akutt.

**To veier å velge mellom (ikke avgjort):**
- *Pragmatisk lag:* lån språk-ideene som håndhevede konvensjoner på eksisterende språk (strenge
  modulgrenser, append-only definisjoner, type-checker som grønn-gate). ~60 % gevinst på EKTE kode.
- *Agent-native substrat:* den dristige veien. Større gevinst, men lever/dør på brohodet.

## Wedge 1 — BEVIST (kjørbar prototype)

Kjernepåstanden er nå demonstrert i kode (`src/`, `test/`, TypeScript): flere agenter som
forfatter parallelt mot samme kodebase, der **kun det ene navnet to agenter faktisk strides om
parkeres** og alt annet auto-merger. Approach B (innholds-adresserte defs som refererer hverandre
ved hash). Kjør: `npx tsx src/demo.ts` og `npx tsx --test test/merge.test.ts` (6/6 grønt).

Bevist av prototypen:
- puts kommuterer (innholds-adressert union — rekkefølge spiller ingen rolle). [krav 1, 2]
- uavhengige navn merges urørt; eneste konflikt = samme navn → ulik hash. [krav 1, 2, 7]
- konvergente edits (samme navn, samme innhold) er IKKE konflikt.
- pinnet hash overlever navne-churn (referanse ved identitet). [krav 3]
- bind til uoppløselig innhold avvises, forgifter ikke resten («grønt ved konstruksjon», minimal). [krav 4]
- parkert konflikt er løsbar i ettertid uten å spole tilbake. [krav 7]

Ennå ikke bevist (neste kiler): ekte type-/kontrakt-sjekk (Approach C, krav 4 fullt), trofast
projeksjon til ekte syntaks (krav 6 utover triviell listing), og ytelse/skala.

## Ikke-mål (foreløpig)

- Erstatte git.
- Eget lagringsformat / egen objektmodell.
- Egen merge-motor for tekst (vi faller tilbake på git).
- Et UI. CLI først.

## Åpne hovedbeslutninger

1. **Claim-granularitet:** sti-nivå (enkelt, mye unødig serialisering) vs. symbol-nivå
   (tree-sitter, løser det, men språk-parsing per fil).
2. **Coordinator:** stateful daemon = ett sted kompleksiteten samler seg. Krasj-sikkerhet?
3. **Orkestrering vs. versjonering:** hører arbeidsdelingen hjemme i ai-git, eller utenfor?
4. **Hvor mye git ser agenten direkte** vs. bare ai-gits workspace-modell?

## Prior art (sjekket juni 2026)

Romet er aktivt. Deler seg i de samme to lagene som dette dokumentet:

**Lag 1 — workspace-orkestrering over worktrees (vår P0). Mettet:**
- Conductor — isolerte workspaces + worktree-håndtering for Claude Code (macOS).
- Crystal → Nimbalyst — Electron-app, én worktree per parallell sesjon.
- Vibe Kanban — web-dashboard, én worktree per task (Apache-2.0; Bloop la ned 2026).

**Lag 2 — VCS-redesign for agenter (vår P1/P2). Grønnere, hardere:**
- **agentjj** (2389-research) — nærmest vårt konsept. Koeksisterer med git (`.git/`+`.agent/`),
  checkpoint/undo, typede endringer m/ intensjon, tree-sitter symbol-analyse, `validate`+invarianter,
  git-native ren historikk. Startet på jj, fjernet det pga. single-working-copy-kollisjoner.
  **MIT, men ARKIVERT/read-only siden 17. feb 2026 (v0.3.1, 32 commits) → kan ikke bidra, kun forke/lære.**
  **Løste de PER-AGENT-primitivene, men IKKE kryss-agent-koordinering/låsing — den harde delen står åpen.**
  → Fork/lær primitivene; bygg koordineringslaget de hoppet over.
- Aura — semantisk VCS oppå git, sporer AST i stedet for tekstlinjer (vår P2 semantisk merge).
- Pedro Piñera, «Rethinking Version Control for an Agentic World» — sessions i stedet for branches,
  «prompt requests» i stedet for pull requests (intensjon som førsteklasses).
- Agentic Jujutsu — jj-basert agent-VC med first-class conflicts (Claude Code-skill + npm).

**Koordinering finnes — men bare grovkornet:**
- Claude Code «Agent Teams» (eksperimentell): delt task-liste, claim-before-execute på task-nivå,
  fil-isolasjon via worktrees, dependency-sekvensering.
- Fast.io / Claude Cowork: pessimistisk/optimistisk/lease-basert fil-låsing m/ stale-lock-håndtering.
- Conductor / Vibe Kanban: INGEN koordinering — ren isolasjon + merge-review til slutt.

**To grenser INGEN krysser (= det udekkede rommet):**
1. Granularitet: all koordinering er fil-/modul-nivå («scope tasks til ulike filer»). Ingen gjør
   symbol-/funksjon-nivå → derfor treffer alle taket på 2–4 agenter.
2. Semantisk korrekthet: selv Agent Teams «validerer ikke semantisk korrekthet»; feil antakelser
   forplanter seg, tester/kompilering forblir menneske-reviewet etterpå. Ingen håndhever
   «kompilerer + grønt på tvers av filer» som del av integrasjonen.

**Lærdom (korrigert):** P0 (workspace/orkestrering) OG grovkornet koordinering er bygget av flere.
Det faktisk udekkede er kombinasjonen **symbol-nivå claims + håndhevet semantisk grønn-gate på tvers
av filer** — det er dét som ville flyttet taket fra 2–4 til mange agenter.

## CLI-skisse (referanse — detaljert i tidligere diskusjon)

```
ai-git init        --workspace-strategy worktree|overlay|cow --shared-cache ...
ai-git swarm start <name> --base <ref> --agents <N> --gate "<bygg+test>"
ai-git cell open   <agent> --task "<intensjon>" --from swarm:<name>
ai-git claim       <pathspec|symbol> --mode read|write --ttl <dur> [--wait|--no-wait]
ai-git step        -m "<hva jeg prøvde>" [--intent "..."] [--test "<cmd>"]
ai-git checkpoint  --green
ai-git integrate   <agent> --into swarm:<name> --require-green --on-conflict park
ai-git status      --swarm <name> [--watch] [--format human|json]
ai-git distill     swarm:<name> --into <branch> --group-by intent --drop-dead-ends
ai-git land        swarm:<name> --branch <name> [--pr] --require-green --summary
ai-git abort       <agent|swarm:name>
ai-git gc
```
