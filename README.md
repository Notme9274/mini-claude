# Mini Claude: offline AI-chat voor je iPad

Een kleine chat-app die een open-source taalmodel (Llama, Qwen, Gemma, Phi, SmolLM) volledig op je iPad draait, met WebLLM en WebGPU. Het is geen Claude: Claude-modellen zijn niet te downloaden. Na de eerste download werkt alles zonder internet en verlaten je gesprekken het apparaat niet.

## Wat je nodig hebt
- iPadOS 26 of nieuwer (Safari met WebGPU). iPadOS 27 voldoet.
- Een iPad met bij voorkeur 8 GB RAM of meer. Met 4 GB: houd het bij modellen van ongeveer 1B.
- Eenmalig wifi voor het downloaden van de app en het model (ongeveer 0,5 tot 2 GB).

## Stap 1: de app online zetten (eenmalig)
Service workers en WebGPU werken alleen via **https**. Een los bestand openen of een lokaal netwerkadres (http://192.168...) werkt dus niet. Zet de map daarom op een gratis hostingdienst. De app bevat geen geheimen en niets van jou.

**Optie A: GitHub Pages (kan volledig op de iPad)**
1. Pak `mini-claude.zip` uit in de app Bestanden (tik op het zipbestand).
2. Maak een gratis account op github.com en maak een nieuwe **publieke** repository, bijvoorbeeld `mini-claude`.
3. Kies **Add file → Upload files** en upload alle uitgepakte bestanden (zonder de map zelf).
4. Ga naar **Settings → Pages**, kies *Deploy from a branch*, branch `main`, map `/ (root)`, en bewaar.
5. Na een minuut staat de app op `https://<jouwnaam>.github.io/mini-claude/`.

**Optie B: Netlify Drop of Cloudflare Pages**
Je sleept de uitgepakte map naar de uploadpagina en krijgt direct een https-adres. Dat gaat het gemakkelijkst vanaf een computer. De schermen kunnen er anders uitzien dan hier beschreven.

## Stap 2: installeren op je iPad
1. Open het adres in **Safari**.
2. Tik op **Deel** en kies **Zet op beginscherm**.
3. Open Mini Claude voortaan via het icoon. Dit is belangrijk: iPadOS wist opgeslagen data van gewone websites na een tijd, maar niet van apps op het beginscherm.

## Stap 3: eerste start
1. Laat de app even laden. Ze haalt eenmalig de AI-bibliotheek op en bewaart die voor offline gebruik.
2. Kies een model en tik op **Downloaden en starten**. Blijf op wifi en houd het scherm open.
3. Daarna kun je vliegtuigmodus aanzetten en gewoon doorchatten.

Bij een volgende start laadt de app het laatst gebruikte model vanzelf uit de opslag.

## Modelkeuze
De app toont de modellen met het geheugen dat ze nodig hebben. Start klein en ga omhoog.

| Je iPad | Probeer |
|---|---|
| 4 GB RAM | Llama-3.2-1B, Qwen2.5-0.5B of SmolLM2 |
| 8 GB RAM | Llama-3.2-3B, Qwen2.5-3B, Gemma-2-2B |
| 16 GB RAM (M-chip) | de zwaarste modellen in de lijst, zoals Phi-3.5-mini of Phi-3.5-vision |

Safari mag maar een deel van het totale RAM gebruiken. Een model dat op papier past, kan dus toch vastlopen. De app merkt dat de volgende keer en stelt dan een kleiner model voor.

## Opslaan en onthouden
- **Gesprekken** worden automatisch op je iPad bewaard. Via het menu-icoon linksboven open of wis je oude gesprekken, met **+** begin je een nieuw gesprek.
- **Geheugen:** onder Instellingen kun je invullen wat Mini Claude over jou moet weten (naam, voorkeuren). Dat gaat bij elk gesprek mee. Typ in de chat *"Onthoud dat ik …"* om er snel iets aan toe te voegen.
- Alles blijft lokaal in Safari. Wis je de websitegegevens van de app, dan zijn de gesprekken weg.

## Afbeeldingen lezen
Kies in de modellijst **Phi-3.5-vision** (het enige beeldmodel in de lijst) en tik op het plaatje-icoon naast het invoerveld. Je kunt een foto nemen of er een uit je bibliotheek kiezen.
- Eén afbeelding per bericht. De afbeelding wordt verkleind voor het model; in het gesprek blijft alleen een miniatuur bewaard.
- Het model is zwaar (ongeveer 4 tot 6 GB geheugen). Het is bedoeld voor iPads met 8 GB RAM of meer en kan op een kleinere iPad crashen.
- Tekst in foto's lezen en beschrijven gaat redelijk; verwacht geen perfecte uitkomst.

## Opdrachten en theorie (foto's en bestanden)
Tik op het plaatje-icoon naast het invoerveld. Je hebt drie keuzes:
- **Foto van een opdracht of theorie:** de app leest de tekst uit de foto en geeft die aan de AI. Dit werkt met elk model en op elke iPad, ook zonder beeldmodel. Via **Bekijk** kun je leesfouten verbeteren voordat je verstuurt. De eerste keer is internet nodig om de leesfunctie te downloaden (enkele tientallen MB); daarna werkt het offline.
- **Foto laten bekijken door de AI:** alleen met het beeldmodel Phi-3.5-vision, handig voor tekeningen of grafieken.
- **Tekstbestand:** een .txt, .md of .csv, bijvoorbeeld je samenvatting. Lange bestanden worden ingekort tot wat het model aankan.

Zet bovenaan het invoerveld **Studiehulp** aan voor uitleg stap voor stap, met controle van rekenwerk en een controlevraag. De AI antwoordt dan ook rustiger (minder creatief, dus minder fouten).

Tips voor betere antwoorden:
- Een groter model (Llama-3.2-3B of Qwen2.5-3B) begrijpt theorie merkbaar beter dan het 1B-model.
- Maak foto's recht van boven, scherp en met veel licht. Handgeschreven tekst wordt slecht gelezen.
- Bij lange teksten: zet onder Instellingen **Lange teksten** aan en start het model opnieuw. Dit kost meer geheugen.
- Controleer rekenwerk en feiten altijd zelf. Kleine modellen maken fouten, ook in wiskunde.

## Goed om te weten
- Kleine modellen maken vaker fouten en verzinnen sneller dingen dan grote. Controleer belangrijke antwoorden.
- Nederlands werkt het best met Llama-3.2, Qwen2.5 en Gemma. De kleinste modellen zijn in het Nederlands zwakker.
- Instellingen (tandwiel) bevatten de systeemprompt, creativiteit, antwoordlengte en het verwijderen van modellen om ruimte vrij te maken.
- Gesprekken worden lokaal in de browser opgeslagen. Met **+** begin je een nieuw gesprek.

## Als het niet werkt
- **"WebGPU niet beschikbaar":** controleer of je op iPadOS 26 of nieuwer zit en open de app in Safari of via het beginscherm-icoon.
- **"Bibliotheek niet geladen":** open de app één keer met internet. Pas daarna staat de bibliotheek in de cache.
- **App crasht tijdens laden:** kies een kleiner model.
- **Na een update van de app ziet het er nog oud uit:** sluit de app helemaal en open hem twee keer.

## Bestanden
- `index.html`: de interface
- `app.js`: de logica, met modelkeuze, streaming en opslag
- `sw.js`: de service worker voor offline gebruik
- `manifest.webmanifest` en de `*.png`-bestanden: het beginscherm-icoon

Bij het aanpassen van bestanden verhoog je `VERSION` bovenin `sw.js`, zodat iPads de nieuwe versie ophalen.
