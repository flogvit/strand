Nå tenker jeg mer på AI koding. Ville du, eller claude cli, foretrukket at versjonssystemet fungerte annerledes? I dag brukes jo git workflow endel, men når 100 agenter skal jobbe på samme kode så blir det fort et problem med git?

Dette er et reelt og ganske spennende problem, og du har rett i at Git begynner å knake når man skalerer fra «noen få mennesker» til «mange parallelle agenter». La meg svare ærlig på hva som faktisk gjør vondt og hva jeg — som faktisk jobber gjennom Git i Claude Code — ville ønsket meg annerledes.

**Hvor Git-modellen faktisk skraper når agenter skalerer**

*Branch/merge-modellen antar sjeldne, koordinerte integrasjoner.* Git er bygget for at mennesker integrerer med jevne mellomrom og snakker sammen rundt det. Hundre agenter som jobber samtidig genererer enten hundre branches som må merges (og merge-konflikter vokser kvadratisk med antall parallelle endringer som rører samme filer), eller de tråkker på hverandre i samme tre. Konfliktraten er ikke et verktøyproblem du kan optimere bort — det er iboende når mange aktører endrer overlappende tilstand uten koordinering.

*Linjebasert konfliktløsning er feil abstraksjonsnivå.* Git ser to agenter endre de samme linjene og roper «konflikt», selv om endringene er semantisk uavhengige (to funksjoner lagt til i samme fil) — eller verre, lar en merge gå rent igjennom selv om de to endringene er *logisk* inkompatible (agent A endrer en funksjonssignatur, agent B kaller den gamle signaturen fra en annen fil). Git forstår tekst, ikke at koden fortsatt kompilerer og består testene. Det er nettopp den semantiske inkompatibiliteten på tvers av filer som dreper deg ved høy parallellitet.

*Commit som enhet passer dårlig for agentarbeid.* En menneskelig commit er en kuratert, meningsbærende enhet. Agentarbeid er mer som en strøm av eksperimentelle steg — prøv noe, kjør testene, angre, prøv noe annet. Gits lineære commit-historikk tvinger meg til å enten støye til historikken eller drive med rebase/squash-akrobatikk for å late som arbeidet var rent fra starten.

*Ingen innebygd forståelse av «er denne tilstanden gyldig».* Det jeg egentlig vil vite før en merge er ikke «kolliderer linjene» men «kompilerer det, og består testene». Det lever helt utenfor Git, i CI, og kobles løst på etterpå.

**Hva jeg faktisk ville foretrukket**

*Semantiske, ikke tekstuelle, merges.* En merge burde operere på syntakstreet og helst på typenivå: forstå at to endringer rører ulike funksjoner og merge dem trivielt, og *nekte* en merge som tekstmessig er ren men bryter et kall et annet sted. I praksis ville en LLM-assistert merge-resolver — som forstår intensjonen bak begge endringene — vært langt mer nyttig enn `<<<<<<< HEAD`-markører jeg må gjette meg gjennom.

*Test-/byggtilstand som en del av versjonsobjektet.* En «commit» burde kunne bære med seg «denne tilstanden er grønn» som en verifiserbar egenskap, ikke noe CI sjekker løskoblet etterpå. Da blir integrasjonsregelen «aldri merge inn i en grønn tilstand noe som gjør den rød», håndhevet av systemet.

*Optimistisk parallellitet med automatisk re-basering.* Modeller som Jujutsu (jj) peker allerede i retningen jeg liker: arbeidskopien *er* en commit, historikken kan omskrives trygt og kontinuerlig, og konflikter er førsteklasses objekter som kan eksistere i historikken uten å blokkere alt annet. For agenter er det enormt — jeg kan parkere en konflikt, fortsette annet arbeid, og la den løses senere i stedet for at alt stopper.

*Intensjon, ikke bare diff.* Hvis en agent kunne committe «hva jeg prøvde å oppnå» sammen med endringen, kunne en merge-resolver — menneskelig eller modell — ta langt bedre avgjørelser enn ved å stirre på linjene alene.

**Den ærlige motvekten**

Men her er det viktige: mye av dette er egentlig ikke et argument for et *nytt versjonssystem*. Det er et argument for en *annen koordineringsmodell oppå* versjonssystemet:

- *Hundre agenter på én delt tilstand er ofte feil arkitektur.* Den mer robuste løsningen er som regel å partisjonere arbeidet — gi hver agent en avgrenset oppgave med smalt grensesnitt, slik at de sjelden rører samme kode. Det speiler hvordan menneskelige team unngår merge-helvete: ikke ved bedre merge-verktøy, men ved modulgrenser og eierskap. Det reelle problemet ved 100 agenter er like mye *orkestrering* som *versjonering*.
- *Determinisme og reviewbarhet betyr fortsatt noe.* Git vant ikke bare på treghet. Den uforanderlige, innholds-adresserte historikken, evnen til å gå tilbake til nøyaktig en tilstand, og en diff et menneske kan revidere — det blir *viktigere*, ikke mindre viktig, når en maskin genererte koden. Et menneske må fortsatt kunne forstå og godkjenne hva flåten av agenter gjorde.
- *Lagdeling vinner trolig her også.* Akkurat som med AI-data-versjonering tror jeg ikke svaret er «Git erstattes», men at det legges et orkestreringslag oppå: jobbkø, automatisk worktree/branch per oppgave, kontinuerlig integrasjon mot en grønn hovedtilstand, og en semantisk merge-resolver som faller tilbake på Gits faktiske lagring. Det er talende at agent-rammeverk akkurat nå løser dette med git worktrees og isolerte branches — de jobber *rundt* Git, ikke uten det.

**Kort svar**

Ja, jeg ville foretrukket noe annerledes — men ikke nødvendigvis et nytt VCS. Det jeg savner mest konkret er tre ting: semantisk merge som forstår om koden fortsatt henger sammen, byggtilstand som en håndhevet egenskap ved en versjon, og en jj-aktig modell der konflikter ikke blokkerer alt annet. Gits tekst-linje-commit-modell er det dårligste passet, og jj viser at man kan beholde Gits lagring men bytte arbeidsmodellen.

Men selve premisset — «100 agenter på samme kode» — er like mye et orkestreringsproblem som et versjonsproblem. Den største gevinsten ligger sannsynligvis ikke i å fikse merge, men i å strukturere arbeidet slik at færre merges trengs i utgangspunktet. Det mest spennende uløste rommet er overlappet: et koordineringslag som *vet* hva hver agent prøver å oppnå og bruker det til både å fordele arbeidet og løse de konfliktene som likevel oppstår.

Vil du at jeg går nærmere inn på hvordan jj faktisk skiller seg fra Git i praksis, eller hvordan dagens agent-oppsett bruker worktrees for å isolere parallelt arbeid?