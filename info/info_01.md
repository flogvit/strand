Jeg ser Epic har gitt ut et eget nå, Lore. Hvor stort er egentlig markedet for et nytt versjonssystem?

Lore er ikke et angrep på Git på Gits hjemmebane. Det er rettet mot et helt annet segment, og det former hvor stort markedet egentlig er.

**Hva Lore faktisk konkurrerer mot**

Lore er sentralisert, binær-først, med fragment-nivå deduplisering, sparse/lazy working copies og fil-låsing — altså nettopp svakhetene jeg nevnte at Git har med store binærfiler. SOTA på dette området er Perforce (Helix Core), et proprietært system. Game dev bruker Perforce nesten 100 %; Git er knapt på radaren der, og LFS er ingen reell erstatning for native støtte. Så det reelle målet er Perforce, ikke Git.

**Hvor stort er det segmentet?**

To måter å tenke på markedet:

Det *brede* VCS-markedet domineres totalt av Git, og der har Lore null sjanse og prøver heller ikke. Git sitter på det aller meste av all programvareutvikling. Et nytt generelt VCS har i praksis ikke noe marked — nettverkseffektene (GitHub, GitLab, all tooling, alle utviklere som kan Git) er for sterke. Det er derfor Mercurial, Fossil, Pijul og lignende forblir nisjer tross tekniske fortrinn.

Det *smale* segmentet — store binær-tunge prosjekter — er derimot reelt og underbetjent:
- Spillindustrien (titusenvis av studioer globalt, fra indie til AAA)
- Film/VFX/animasjon
- Eventuelt CAD, arkitektur, medisinsk bildebehandling, ML-datasett

Det er et marked målt i tusenvis av team, ikke titalls millioner utviklere. Men det er et marked der den eneste seriøse aktøren (Perforce) er dyr, proprietær og krever en dedikert tools-engineer. Perforce er flott når det virker, men treffer nok knaster til at du trenger en tools-engineer som av og til må fikse ting manuelt.

**Epics reelle motivasjon (og hvorfor «marked» kanskje er feil spørsmål)**

Lore er allerede versjonssystemet bak UEFN (Unreal Editor for Fortnite). Epic bygger ikke dette for å selge — det er MIT-lisensiert og gratis. Strategien ser ut til å være å gjøre Unreal-økosystemet mer attraktivt og uavhengig av Perforce-lisenser, på samme måte som Unreal Engine selv er en plattform-magnet. For team som sliter med store binære assets, branching-smerte og fleruser-samarbeid er Lore det mest umiddelbart aktuelle fra Epic — og hvis det leverer, kan det bli relevant for et hvilket som helst studio med innholdstunge produksjonspipelines.

**Realistisk vurdering**

Som *generelt* versjonssystem: markedet er praktisk talt ikke-eksisterende, Git har vunnet.

Som *Perforce-erstatter for binær-tungt arbeid*: markedet er smalt men reelt, og her har Lore en faktisk sjanse — fordi den ikke kjemper mot Gits nettverkseffekt, men mot et dyrt proprietært system uten gratis open source-alternativ. Den største usikkerheten er adopsjon utenfor Epics eget økosystem: det er fortsatt pre-1.0, og bransjen er konservativ. De kommer ikke til å bytte ut greiene sine enkelt — det blir en lang vente-og-se-periode.

Så svaret på «hvor stort er markedet» avhenger helt av hvilket marked: enormt og lukket for Git-konkurrenter, men en åpen, underbetjent nisje for binær-først-systemer der Lore faktisk kan ta plass.