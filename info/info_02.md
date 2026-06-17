I dagens AI verden, ville det være bedre system for AI som kunne vært utviklet?

Godt spørsmål. Hvis man designet et versjonssystem fra bunnen for AI-tidens arbeidsflyter — ikke menneskelig kode skrevet linje for linje, men maskingenerert innhold, modeller, datasett og agenter som jobber parallelt — ville en del av de grunnleggende antagelsene i Git (og for så vidt Lore) sett annerledes ut.

La meg dele det i hvor dagens systemer kommer til kort, og hva et AI-orientert system kunne gjort.

**Hvor Git/Lore-modellen ikke passer AI-arbeid**

Git er bygget rundt en antagelse: endringer er små, tekstbaserte, menneskeskapte diffs der linjen er den meningsbærende enheten. Nesten ingenting i AI-stacken oppfører seg slik:

- *Modellvekter* er gigantiske binærfiler der en finjustering endrer nær sagt hver byte. Diffing på byte- eller linjenivå er meningsløst. Selv Lores fragment-deduplisering hjelper lite når hele vektmatrisen skifter.
- *Datasett* er enorme, ofte versjonert på rad-/sample-nivå, og det interessante er ikke «hvilke bytes endret seg» men «hvilke samples ble lagt til, fjernet eller relabelt, og hvordan påvirker det nedstrøms modeller».
- *Prompter, konfigurasjoner og agent-definisjoner* er små, men endres hyppig og semantisk — to prompter kan være byte-identiske og likevel oppføre seg ulikt avhengig av modellversjon.
- *Avhengigheten mellom artefakter* — denne modellen ble trent på det datasettet med den konfigurasjonen og ga de evalueringsresultatene — er selve kjernen, men Git har ingen førsteklasses representasjon av den. Det er nettopp dette MLOps-verktøy som DVC, MLflow, Weights & Biases og lakeFS prøver å løse, hver med sin bit.

**Hva et AI-native system kunne gjort annerledes**

*Semantisk diffing fremfor tekstdiffing.* For kode betyr det å forstå AST-nivå endringer (funksjon flyttet, ikke «50 linjer slettet og 50 lagt til»). Dette er aktuelt allerede nå som LLM-er genererer store kodeendringer der den linjebaserte diffen blir ulesbar støy.

*Innholds- og semantikk-adressering av modeller.* I stedet for å lagre vekter som ugjennomsiktige blobs, kunne systemet forstå at to checkpoints er «samme modell, ett finjusteringssteg fra hverandre» og lagre/representere forholdet, ikke bare bytene.

*Proveniens som førsteklasses borger.* En commit i AI-verden er ikke bare «hva endret seg» — det er en hel lineage: kildedata → preprosessering → treningskonfigurasjon → modell → eval. Et AI-native VCS ville sporet denne grafen eksplisitt og gjort den spørrbar: «hvilke modeller i produksjon ble berørt av at vi fjernet disse 10 000 samplene fra treningssettet?»

*Reproduserbarhet bygget inn.* Ikke bare «her er koden», men «her er det nøyaktige miljøet, datasnapshot, seed og maskinvarekontekst som ga dette resultatet». Determinismen Git gir for tekst, men utvidet til hele beregningspipelinen.

*Agent-vennlige operasjoner.* Hvis AI-agenter genererer hundrevis av endringer parallelt, blir mennesket en reviewer av maskinarbeid, ikke forfatteren. Da trenger man bedre verktøy for å gruppere, oppsummere og semantisk merge'e maskingenererte endringer — kanskje merge-konflikter løst av en modell som forstår intensjonen, ikke bare linjekollisjonen.

**Den ærlige motvekten**

Det er gode grunner til at dette ikke allerede har erstattet Git, og de er ikke bare treghet:

- *Lagdeling vinner ofte over monolitt.* Det kan være at den riktige arkitekturen ikke er ett nytt VCS, men spesialiserte lag oppå objektlagring (slik DVC, lakeFS, Hugging Face Hub gjør) — fordi modeller, data og kode har så ulike behov at ett system som prøver å gjøre alt blir dårligere på hver enkelt ting.
- *Modellvekter egner seg kanskje bedre for artefakt-registre enn for versjonering.* Man trenger ofte ikke hele historikken til en modell på samme måte som kodehistorikk; man trenger sporbar lagring av spesifikke checkpoints. Det er et annet problem enn det Git løser.
- *Nettverkseffekten igjen.* Som med Lore: kode kommer til å bli i Git uansett, fordi all tooling, CI/CD og folks vaner sitter der. Et AI-native system må sannsynligvis integrere *med* Git, ikke erstatte det.
- *Standardene finnes ennå ikke.* Hva «en versjon av en agent» engang betyr, er ikke avklart. Det er vanskelig å bygge et modent versjonssystem for artefakter bransjen ikke er enig om hvordan ser ut.

**Kort svar**

Ja — det er reelt rom for et system designet for AI-arbeidsflyter, og behovet er åpenbart underdekket akkurat nå (fragmenteringen i MLOps-verktøy er beviset). Men det mest sannsynlige utfallet er ikke «Git for AI» som én ny monolitt, men et lag for proveniens, reproduserbarhet og semantisk forståelse av modeller/data som lever oppå eksisterende objektlagring og snakker med Git for koden. Den virkelig interessante uløste biten er proveniens-grafen — koblingen mellom data, konfigurasjon, modell og resultat — fordi det er der ingen har en god generell løsning ennå.

Vil du at jeg ser nærmere på en spesifikk del — for eksempel hvordan dagens verktøy som DVC og lakeFS faktisk løser data-/modellversjonering, eller hva semantisk merging av AI-generert kode ville krevd?