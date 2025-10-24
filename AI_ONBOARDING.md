# AI Onboarding Guide - Compile Game

Diese Datei beschreibt die optimale Reihenfolge zum Einlesen des Projekts für schnelles Verständnis.

---

## 🚀 Schnellstart-Reihenfolge

### Phase 1: Spielregeln & Konzepte (IMMER ZUERST!)

**Ziel:** Verstehen wie das Spiel funktioniert

1. **`beschreibung.txt`** (Text-Datei)
   - Enthält: Grundregeln, wichtige Konzepte, Spezialfälle
   - **Warum wichtig:** Definiert was face-up/face-down, covered/uncovered, Effekt-Typen bedeuten
   - **Lesen:** Komplett durchlesen

2. **`COMP-MN01_Rulesheet_Updated.pdf`** (PDF-Datei)
   - Enthält: Offizielle Spielregeln, Card Anatomy, Gameplay-Flow
   - **Warum wichtig:** Zeigt wie Turns ablaufen, was Compile bedeutet, Victory-Bedingungen
   - **Lesen:** Seite 1-2 vollständig

3. **`GAME_RULES.md`** (MD-Datei)
   - Enthält: Kompilierung, Recompile, Control Mechanic, Phase-Ablauf
   - **Warum wichtig:** Ergänzt PDF mit wichtigen Details für KI-Entwicklung
   - **Lesen:** Komplett (kurz)

---

### Phase 2: System-Dokumentation (DANN!)

**Ziel:** Verstehen wie der Code strukturiert ist

4. **`LOGGING_SYSTEM.md`** ⭐ (MD-Datei)
   - Enthält: Indent-Management, Context-Tracking, Kritische Regeln, Typische Fehler
   - **Warum wichtig:** Logging ist komplex und fehleranfällig - diese Datei verhindert Bugs!
   - **Lesen:** Komplett - enthält viele Fix-Beispiele

5. **`CARD_TARGETING_RULES.md`** ⭐ (MD-Datei)
   - Enthält: Targeting-Regeln für ALLE Karten (DELETE, FLIP, SHIFT, etc.)
   - **Warum wichtig:** Definiert UNCOVERED vs COVERED, Spezialfälle (Apathy-4, Death-2)
   - **Lesen:** Tabellen durchscannen, bei Bedarf nachschlagen

6. **`DEBUG_TOOL_GUIDE.md`** (MD-Datei)
   - Enthält: Wie man Test-Szenarien lädt, Debug-Panel benutzt
   - **Warum wichtig:** Nützlich zum Testen von Fixes
   - **Lesen:** Optional, bei Bedarf

---

### Phase 3: Code-Struktur (NUR BEI BEDARF!)

**Ziel:** Spezifische Systeme verstehen

**Nur lesen wenn du an diesen Systemen arbeiten musst:**

#### 3.1 Karten-System

7. **`data/cards.ts`** (TypeScript)
   - Enthält: Alle 84 Karten mit top/middle/bottom Commands
   - **Wann lesen:** Wenn du wissen musst, was eine Karte genau macht
   - **Wie lesen:** Suche nach spezifischer Karte (z.B. "Anarchy-0")

#### 3.2 Effekt-System

8. **`logic/effects/`** Ordner
   - Struktur:
     - `effectRegistry.ts` - Middle Commands (on-play)
     - `effectRegistryStart.ts` - Start-Phase Effekte
     - `effectRegistryEnd.ts` - End-Phase Effekte
     - `effectRegistryOnCover.ts` - "When covered" Effekte
     - `{protocol}/` Ordner - Einzelne Karten-Effekte
   - **Wann lesen:** Wenn du einen spezifischen Karten-Effekt debuggen musst
   - **Wie lesen:**
     1. Finde Registry-Eintrag
     2. Lies die spezifische Effect-Datei (z.B. `anarchy/Anarchy-0.ts`)

#### 3.3 Game-Logic

9. **Kern-Dateien** (in dieser Reihenfolge):

   **a) `logic/game/stateManager.ts`**
   - Enthält: `recalculateAllLaneValues`, `getEffectiveCardValue`, `calculateCompilableLanes`
   - **Wann lesen:** Wenn du verstehen musst, wie Werte berechnet werden

   **b) `logic/game/phaseManager.ts`**
   - Enthält: `advancePhase`, `processEndOfAction`, `processQueuedActions`
   - **Wann lesen:** Wenn du Phase-Übergänge oder queued actions debuggen musst
   - **Wichtig:** Zeilen 261-277 (anarchy_0_conditional_draw), Zeile 111-140 (hand_limit phase)

   **c) `logic/game/actionResolver.ts`**
   - Enthält: Haupt-Dispatcher für alle Actions
   - **Wann lesen:** Wenn du verstehen musst, wie Actions verarbeitet werden

   **d) `logic/game/resolvers/`** Ordner
   - `cardResolver.ts` - Karten-Aktionen (flip, delete, return, etc.)
   - `laneResolver.ts` - Shift-Aktionen (alle Shift-Typen)
   - `discardResolver.ts` - Discard-Aktionen
   - `promptResolver.ts` - Prompts (Rearrange, Compile, etc.)
   - **Wann lesen:** Wenn du einen spezifischen Action-Typ debuggen musst

#### 3.4 AI-System

10. **`logic/ai/`** Ordner
    - `easy.ts` - Einfache AI (spielt höchsten Wert)
    - `normal.ts` - Mittlere AI (strategisch mit Fehlern)
    - `hardImproved.ts` - Schwere AI (Memory-System, Strategie)
    - **Wann lesen:** Nur wenn du AI-Bugs fixen musst
    - **Wichtig:** Ignoriere `hard.ts` (veraltet)

---

## 📋 Checkliste für neue Session

Beim Start einer neuen Programmier-Session:

- [ ] Lies `beschreibung.txt` (2 min)
- [ ] Lies `COMP-MN01_Rulesheet_Updated.pdf` Seite 1-2 (3 min)
- [ ] Lies `LOGGING_SYSTEM.md` (5 min) ⭐
- [ ] Scanne `CARD_TARGETING_RULES.md` Tabellen (2 min)
- [ ] **DANN:** Melde dich beim User zurück!

**Geschätzte Zeit:** ~12 Minuten

---

## 🎯 Schnell-Referenz: Wo finde ich was?

| Was suchst du? | Wo findest du es? |
|----------------|-------------------|
| **Spielregeln** | `beschreibung.txt`, PDF, `GAME_RULES.md` |
| **Karten-Effekte** | `data/cards.ts` → `logic/effects/{protocol}/{Card}.ts` |
| **Logging-Regeln** | `LOGGING_SYSTEM.md` ⭐ |
| **Targeting-Regeln** | `CARD_TARGETING_RULES.md` |
| **Phase-Management** | `logic/game/phaseManager.ts` |
| **Shift-Logic** | `logic/game/resolvers/laneResolver.ts` |
| **Delete/Flip/Return** | `logic/game/resolvers/cardResolver.ts` |
| **AI-Entscheidungen** | `logic/ai/easy.ts`, `normal.ts`, `hardImproved.ts` |
| **Uncover-Logic** | `logic/game/helpers/actionUtils.ts` → `handleUncoverEffect` |
| **Queued Actions** | `logic/game/phaseManager.ts` → `processQueuedActions` |

---

## 🔥 Häufige Bug-Kategorien & Wo schauen

### Softlock nach Effekt
→ **Check:** `laneResolver.ts` (queued actions processing), `phaseManager.ts` (processQueuedActions)

### Falsches Logging (Einrückung/Source)
→ **Check:** `LOGGING_SYSTEM.md`, `actionUtils.ts` (handleUncoverEffect), `cardResolver.ts` (Context-Management)

### Effekt wird nicht ausgeführt / falsche Bedingung
→ **Check:**
1. `logic/effects/{protocol}/{Card}.ts` (Effect-Datei)
2. `cardResolver.ts` oder `phaseManager.ts` (Aufruf-Stelle)
3. Ist Karte face-up? Ist Karte uncovered?

### AI macht dumme Entscheidung
→ **Check:** `logic/ai/{difficulty}.ts`, validiere mit `CARD_TARGETING_RULES.md`

### Information Leak (Spieler sieht Gegner-Karte)
→ **Check:** Log-Messages in Effect-Dateien, siehe `LOGGING_SYSTEM.md` Regel 3

### Karte targetiert falsch (covered statt uncovered)
→ **Check:** `CARD_TARGETING_RULES.md`, dann AI-Handler oder Resolver

---

## 💡 Wichtige Konzepte (Kurzform)

### Face-Up vs Face-Down
- **Face-Up:** Alle Effekte aktiv (Top/Middle/Bottom), Wert sichtbar
- **Face-Down:** Keine Effekte, Wert = 2 (oder 4 mit Darkness-2)

### Covered vs Uncovered
- **Uncovered:** Oberste Karte im Stack → Middle + Bottom aktiv
- **Covered:** Darunter → nur Top aktiv (wenn face-up)

### Effekt-Typen
- **Top (Persistent):** Immer aktiv wenn face-up (auch wenn covered)
- **Middle (Immediate):** Beim Spielen/Aufdecken/Uncovern
- **Bottom (Auxiliary):** Nur wenn uncovered (triggered effects)

### Turn-Interrupt
- Wenn Effekt für anderen Spieler Action benötigt
- `_interruptedTurn` speichert ursprünglichen Turn
- Nach Interrupt: Resume original turn

### Queued Actions
- Actions die nach aktueller Action ausgeführt werden
- Beispiel: `anarchy_0_conditional_draw`, `speed_3_self_flip_after_shift`
- Werden in `phaseManager.ts` → `processQueuedActions` verarbeitet

---

## ⚠️ Kritische Warnungen

1. **NIEMALS** `actionRequired = null` setzen ohne zu prüfen, ob queued actions verarbeitet werden müssen!

2. **IMMER** `decreaseLogIndent` symmetrisch zu `increaseLogIndent` aufrufen!

3. **IMMER** prüfen ob Karte face-up UND uncovered ist, bevor Follow-up-Effekt ausgeführt wird!

4. **NIEMALS** Gegner-Karten-Details im Log zeigen (Information Leak)!

5. **IMMER** `setLogSource` und `setLogPhase` bei queued actions neu setzen!

---

## 🛠️ Debugging-Workflow

Wenn etwas nicht funktioniert:

1. **Reproduziere Bug** (am besten mit Debug-Tool)
2. **Lies Log** (drücke "Log" Button im Spiel)
3. **Identifiziere Problem:**
   - Softlock? → Check queued actions / actionRequired
   - Falsches Logging? → Check Indent-Level / Source
   - Effekt nicht ausgeführt? → Check face-up / uncovered
   - Falscher Actor? → Check `actionRequired.actor` vs `state.turn`
4. **Finde relevante Datei** (siehe "Wo finde ich was?" Tabelle oben)
5. **Lies Code-Kontext** (nur betroffene Funktion)
6. **Finde Root Cause**
7. **Implementiere Fix**
8. **Teste mit Debug-Tool**

---

## 📚 Zusätzliche Notizen

### Was NICHT einlesen
- ❌ `node_modules/` (Dependencies)
- ❌ `dist/` oder `docs/` (Build-Artifacts)
- ❌ `logic/ai/hard.ts` (veraltet, benutze `hardImproved.ts`)
- ❌ UI-Code (`screens/`, `components/`) außer bei UI-Bugs

### Nützliche Grep-Patterns
```bash
# Finde alle Effekte einer Karte
grep -r "Anarchy-0" logic/effects/

# Finde wo Action-Type verwendet wird
grep -r "select_card_to_shift" logic/

# Finde Log-Messages
grep -r "log(" logic/ | grep "Anarchy-0"
```

---

## ✅ Nach dem Einlesen

Wenn du diese Anleitung befolgt hast, solltest du:

✅ Die Spielregeln verstehen (face-up, uncovered, compile)
✅ Das Logging-System verstehen (indent, source, phase)
✅ Wissen wo Code für spezifische Features liegt
✅ Häufige Bug-Kategorien kennen
✅ Bereit sein zum Programmieren!

**Melde dich beim User und frage nach der Aufgabe!** 🚀
