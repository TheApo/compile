# Compile - Wichtige Spielregeln für KI-Entwicklung

## Grundlegendes Spielziel
- **Gewinn**: Alle 3 eigenen Protokolle auf "Compiled" drehen
- **Kompilieren**: 10+ Wert in einer Lane UND mehr als Gegner → MUSS kompilieren

## Protokolle und Kompilierung

### Protokoll-Status
Jedes Protokoll hat zwei Zustände:
- **Unkompiliert** ("Loading..." Seite): Wert startet bei 0
- **Kompiliert** ("Compiled" Seite): Protokoll wurde kompiliert

### Kompilierung
**Bedingungen** (Check Compile Phase):
- Stack hat 10+ Wert
- Stack hat mehr Wert als Gegner in gleicher Lane
- **MUSS kompilieren** wenn Bedingung erfüllt

**Ablauf**:
1. Falls Control Component vorhanden: Rearrange (optional)
2. ALLE Karten in der Lane werden gelöscht (beide Seiten, gleichzeitig)
3. Protokoll wird umgedreht auf "Compiled" Seite
4. Falls bereits kompiliert: Ziehe top card vom Gegnerdeck (ownership change!)

### Recompile
- Wenn bereits kompiliertes Protokoll nochmal kompiliert wird
- Karten werden gelöscht, aber STATT Protokoll umzudrehen → Draw 1 vom Gegnerdeck
- Diese Karte gehört jetzt DIR (ownership change!)

## Control Component (Wichtig!)

### Erlangen (Check Control Phase)
- Wenn du in **mindestens 2 Lanes** mehr Wert hast als Gegner
- Control Component wechselt zu dir (oder bleibt bei dir)

### Nutzen
Wenn du mit Control Component kompilierst ODER refresht:
1. Control Component geht zurück auf neutral
2. Du DARFST Protokolle rearrange (optional)

**KRITISCH**: Auch wenn du nicht rearrangest, geht Control auf neutral!

## Rearrange Protokolle

### Was wird getauscht?
**DER KOMPLETTE STATUS WIRD GETAUSCHT** - nicht nur die Werte!

### Beispiel
**Vorher**:
- Lane 1: Death-9 (kompiliert)
- Lane 2: Fire-4 (unkompiliert)

**Nach Rearrange Death ↔ Fire**:
- Lane 1: Fire-9 (unkompiliert) ← Status von Lane 2!
- Lane 2: Death-4 (kompiliert) ← Status von Lane 1!

**Ergebnis**: Fire braucht nur noch 1 Punkt um zu kompilieren!

### Strategie
- **Eigene Protokolle tauschen**: Hochkompiliertes (≥8) mit niedrigem unkompiliertem tauschen
  - Vorteil: Unkompiliertes bekommt hohen Wert → fast am Ziel!
  - Beispiel: Death-9 (komp) ↔ Fire-4 (unkomp) = Fire-9 (unkomp, nur 1 vom Ziel!)

- **Gegner-Protokolle tauschen**: Hochkompiliertes mit niedrigem tauschen
  - Vorteil: Gegner verliert Fortschritt in kompiliertem Protokoll
  - Beispiel: Gegner hat Gravity-8 (komp) ↔ Psychic-2 (unkomp) = Gravity-2 (komp), Psychic-8 (unkomp)

### Regeln
- **MUSS anders sein** als vorher (kein Identity-Swap)
- Nur innerhalb EINES Spielers (eigene ODER gegner)
- Karten in den Lanes bleiben wo sie sind, nur Protokolle wechseln Position

## Karten-Zonen und Ownership

### Zonen
- **Hand**: Privat, nur Besitzer kennt Karten
- **Deck**: Privat, randomisiert, niemand kennt Reihenfolge
- **Field**: Karten in Lanes
  - Face-up: Public information
  - Face-down: Privat, nur Besitzer darf schauen
- **Trash**: Public information, alle face-up

### Ownership Change
- Karten können Besitzer wechseln (z.B. Recompile)
- **Behalten neue Ownership** bis Spielende oder erneuter Wechsel
- Auch wenn in Trash oder Deck, gehören sie neuem Besitzer

## Karten-Targeting (SEHR WICHTIG!)

### Default: Nur UNCOVERED
"Flip 1 card" = "Flip 1 uncovered card"
- Nur Top-Karten (oberste in Stack) können gewählt werden
- **COVERED Karten NICHT wählbar** außer explizit angegeben

### Uncovered vs Covered
- **Uncovered**: Oberste Karte in Stack (lane[lane.length - 1])
- **Covered**: Alle Karten darunter

### Ausnahmen
- "Flip 1 covered card" → Nur covered wählbar
- "All cards" → Covered UND uncovered
- "that card" → Spezifische Karte, egal ob covered (z.B. Gravity-2)

### Beide Seiten wählbar
- "Flip 1 card" → Eigene ODER Gegner uncovered
- "Flip 1 of your cards" → Nur eigene uncovered
- "Flip 1 opponent card" → Nur Gegner uncovered

## Committed Cards (Zwischen Zonen)

### Was ist "committed"?
Wenn Karte zwischen Zonen wechselt (Hand→Field, Field→Trash, Shift):
1. Karte verlässt alte Zone ("committed")
2. Effekte durch Verlassen werden abgehandelt (z.B. uncover)
3. Karte landet in neuer Zone

### Regeln
- **NICHTS kann committed card manipulieren** während des Wechsels
- Behält Orientation (face-up/face-down)
- Behält Zielzone
- **KANN NICHT verhindert werden**

### Bottom Command "When covered"
- Wenn Karte committed wird die eine andere covered
- **ZUERST** Bottom Command der soon-to-be-covered Karte
- Committed card ist **NICHT wählbar** während diesem Trigger

## Text und Effekte

### Text Types
1. **Top Command** (Persistent): Immer aktiv wenn face-up, **NIEMALS covered**
2. **Middle Command** (Immediate): Triggert bei Play/Flip/Uncover
3. **Bottom Command** (Auxiliary): Oft triggered effects, **nur wenn uncovered**

### Wann triggert Text?
- **Play face-up**: Middle Command sofort
- **Flip face-up**: Middle Command sofort
- **Uncover** (Karte drüber wird entfernt): Middle Command sofort
- **Flip covered face-up**: Middle Command **NICHT** weil covered bleibt

### Interrupt System
"Last in, first out" - Neueste Effekte zuerst:
1. Karte A wird gespielt → Middle Command A startet
2. Middle Command A sagt "Flip 1 card"
3. Karte B wird geflippt → Middle Command B **unterbricht** A
4. Middle Command B wird komplett abgehandelt
5. Dann erst wird Middle Command A weiter abgehandelt

### Text Owner bestimmt
- **Owner der Karte** entscheidet wie Text resolved wird
- Bei mehreren gleichzeitigen Triggers: **Current Player** entscheidet Reihenfolge

## Start/End Effects

### Wann notiert?
- **Start Phase BEGIN**: Alle sichtbaren "Start:" Commands notieren
- **End Phase BEGIN**: Alle sichtbaren "End:" Commands notieren

### Wichtig
- **NUR notierte** Commands werden ausgeführt
- Wenn Command das Feld verlässt vor Ausführung: **Passiert nicht**
- Wenn Command **NACH** Begin der Phase ins Feld kommt: **Passiert nicht**
- Owner wählt Reihenfolge

## Werte und Kartenwerte

### Karte hat zwei Werte
- **Face-up**: Angezeigter Wert (0-6+)
- **Face-down**: Wert 2 (immer!)

### Face-down Karten spielen
- Können in **jede Lane** gespielt werden
- Wert 2 wird zur Lane addiert
- Kein Middle Command trigger

### Face-up Karten spielen
- **NUR** in matching Protocol Lane (außer Spirit-1 Top Command aktiv)
- Wert wird zur Lane addiert
- Middle Command triggert sofort

## AI Strategie-Grundlagen

### Rearrange Bewertung
1. **Eigener Vorteil**: Kann ich kompiliertes High-Value (≥8) mit unkompiliertem Low-Value tauschen?
   - Score: Wie nah am Gewinn? (10 - neuer_unkompilierter_wert)
   - Beispiel: Death-9 (komp) ↔ Fire-4 (unkomp) → Fire-9 (unkomp) → nur 1 Punkt fehlt!

2. **Gegner-Schaden**: Wie viel verzögere ich Gegner?
   - Score: Differenz zwischen altem und neuem kompilierten Wert
   - Beispiel: Gravity-8 (komp) ↔ Hate-2 (unkomp) → Gravity-2 (komp) → Gegner verliert 6 Punkte!

3. **Vergleich**: Beste Option wählen (höchster Score)

### Flip Bewertung (Gegner-Karten)
Wenn eigene Karte face-up flippen (auf face-down):
- **Value Delta** = 2 - card.value
  - Value 0: delta = +2 (Gegner gewinnt 2 Punkte - SEHR SCHLECHT!)
  - Value 1: delta = +1 (Gegner gewinnt 1 Punkt - SCHLECHT!)
  - Value 2: delta = 0 (Neutral)
  - Value 6: delta = -4 (Gegner verliert 4 Punkte - SEHR GUT!)
- **Score** = -valueDelta * 100 + effectPower * 10
- **NIEMALS** niedrige Werte (0-1) flippen, immer hohe Werte (4-6)!

### Shift/Delete Target Selection
- **NUR UNCOVERED** Karten wählbar (außer explizit "covered" im Text)
- Iterate über `lane[lane.length - 1]` NICHT über `lane.flat()`

### Effect Validation
Vor Effekt ausführen prüfen:
1. Existiert Source-Karte noch?
2. Ist Source-Karte face-up?
3. Ist Source-Karte uncovered?
4. Gibt es valide Targets?

Falls NEIN → Effect canceln oder skip

## Spezielle Regeln

### "All" vs "Each"
- **All**: Gleichzeitig, alle matching cards, **covered + uncovered**
- **Each**: Nacheinander, nur uncovered (außer "each covered")

### "May" vs Required
- **"May"**: Optional
- **Kein "May"**: MUSS so viel wie möglich resolven

### Cards aus Top Deck spielen
- **Face-down**: Darfst NICHT schauen bevor committed
- Erst NACH im Feld darfst du schauen

### Reshuffle
- **NUR** beim Draw wenn Deck leer
- **NICHT** bei anderen Top-Deck Effekten

### Invalid Effects
- Face-down Karten nicht in Stack: Können nicht geflippt/deleted/shifted werden
- Müssen im Stack sein für Manipulation

## Wichtige Kartenmechaniken

### Gravity-2 Beispiel
"Flip 1 card. Shift that card."
- "that card" = spezifische Karte
- **KANN shifted werden auch wenn covered** nach flip!
- Aber: Wenn deleted/returned → kann nicht shifted werden

### Fire-1 Beispiel (Chained Effects Queue Order)
"Discard 1 card. Delete 1 card."
- Discard triggert Darkness-1 shift (interrupt)
- **Queue Order**: Chained effects (Delete) BEFORE shifts
- Sonst würde shift vor delete kommen

### Death-0 / Life-0 "Each line"
- Owner notiert alle Lanes
- **Nacheinander** abhandeln (nicht gleichzeitig!)
- Owner wählt Reihenfolge
- Wenn Card während Process covered/deleted: Stoppt

---

**WICHTIGSTE REGEL FÜR KI**:
Beim Rearrange immer prüfen ob eigene High-Value kompilierte mit Low-Value unkompilierten tauschen kann!
Das bringt dich dem Sieg viel näher als Gegner zu schaden!
