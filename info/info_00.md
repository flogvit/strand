Hva vil du si er manglene og problemene med dagens git

Git har en del kjente svakheter, både i design og i bruk:

**Brukervennlighet**
- Inkonsekvent og forvirrende kommandogrensesnitt. Samme verb (`checkout`, `reset`) gjør vidt forskjellige ting avhengig av flagg og argumenter.
- Bratt læringskurve. Den mentale modellen (staging area, HEAD, refs, objektmodellen) må forstås før mye gir mening.
- Feilmeldinger er ofte kryptiske og hjelper sjelden brukeren videre.
- Terminologi som «detached HEAD», «fast-forward» og «rebase vs merge» skremmer nybegynnere.

**Store filer og store repoer**
- Git håndterer binærfiler dårlig — hele historikken lagres, og repoet vokser ukontrollert. Git LFS er en plaster-løsning, ikke en integrert del.
- Ytelsen faller på svært store monorepoer. Dette har drevet fram egne løsninger som Microsofts VFS for Git / Scalar og Metas Sapling.
- Hele historikken klones som standard, noe som er tungt for store prosjekter (shallow/partial clone hjelper, men er ikke standard).

**Datamodell og arkitektur**
- SHA-1 var lenge standard og er kryptografisk svak; overgangen til SHA-256 har gått tregt og er fortsatt ikke utbredt.
- Ingen innebygd håndtering av fil-låsing, noe som gjør samarbeid om ikke-mergebare filer (design, binærdata) vanskelig.
- Submodules er beryktet upraktiske; mange unngår dem helt.
- Ingen førsteklasses støtte for delvis utsjekking av deler av et tre (sparse-checkout finnes, men er klønete).

**Samarbeid og arbeidsflyt**
- Git i seg selv har ingen mening om pull requests, code review eller tilgangsstyring — alt dette er bygget oppå av GitHub/GitLab, noe som låser folk til plattformer.
- Konflikthåndtering ved merge er fortsatt manuell og linjebasert, uten semantisk forståelse av koden.

**Sikkerhet og opprydding**
- Sensitive data (passord, nøkler) som havner i historikken er vanskelig å fjerne fullstendig.
- Det er lett å «ødelegge» ting med farlige kommandoer hvis man ikke forstår hva man gjør.

Flere av disse driver fram alternativer og påbygg — Jujutsu (jj), Sapling, Pijul og Fossil prøver hver på sin måte å løse noe av dette.

Vil du at jeg går dypere på noe spesielt — for eksempel datamodellen, ytelse på store repoer, eller alternativene?