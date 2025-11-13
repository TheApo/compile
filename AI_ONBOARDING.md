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

7. **`CSS_STRUCTURE.md`** ⭐ (MD-Datei)
   - Enthält: CSS-Organisation, Responsive-Design, Tablet-Optimierung, wo man was findet
   - **Warum wichtig:** CSS ist modular aufgeteilt + enthält Tablet-Responsive Regeln
   - **Lesen:** Bei CSS/Layout-Änderungen - hat komplette Dokumentation aller Screens
   - **Besonders wichtig:** Tablet Media Queries (Breakpoints, Grid-Dimensionen)

---

### Phase 3: Code-Struktur (NUR BEI BEDARF!)

**Ziel:** Spezifische Systeme verstehen

**Nur lesen wenn du an diesen Systemen arbeiten musst:**

#### 3.1 Karten-System

8. **`data/cards.ts`** (TypeScript)
   - Enthält: Alle Original-Karten (18 Protokolle × 6 Karten = 108 Karten)
   - **Wann lesen:** Wenn du wissen musst, was eine Original-Karte genau macht
   - **Wie lesen:** Suche nach spezifischer Karte (z.B. "Anarchy-0")
   - **Wichtig:** Custom Protocol Karten sind NICHT hier, sondern in localStorage

#### 3.2 Effekt-System (Original Karten)

9. **`logic/effects/`** Ordner
   - Struktur:
     - `effectRegistry.ts` - Middle Commands (on-play)
     - `effectRegistryStart.ts` - Start-Phase Effekte
     - `effectRegistryEnd.ts` - End-Phase Effekte
     - `effectRegistryOnCover.ts` - "When covered" Effekte
     - `{protocol}/` Ordner - Einzelne Karten-Effekte (z.B. `anarchy/Anarchy-0.ts`)
   - **Wann lesen:** Wenn du einen spezifischen Original-Karten-Effekt debuggen musst
   - **Wie lesen:**
     1. Finde Registry-Eintrag
     2. Lies die spezifische Effect-Datei
   - **Wichtig:** Custom Protocol Effekte nutzen NICHT diese Registries!

#### 3.3 Custom Protocol System ⭐

**Lese diese Sektion wenn du an Custom Protocols arbeitest!**

10. **`CUSTOM_PROTOCOL_CREATOR.md`** (MD-Datei) ⭐
    - Enthält: Architektur, Effect Types, UI-Komponenten, Integration
    - **Warum wichtig:** Erklärt wie Custom Protocols funktionieren
    - **Lesen:** Komplett wenn du Custom Protocols editierst/debuggst
    - **Besonders wichtig:**
      - Effect Positions (top/middle/bottom)
      - Conditional Chains (if_executed, then)
      - Parameter-basierte Effekte (KEINE card-spezifischen Funktionen!)

11. **`CUSTOM_PROTOCOL_MIGRATION_GUIDE.md`** (MD-Datei)
    - Enthält: Wie Original-Protokolle zu Custom Protocols migriert werden
    - **Wann lesen:** Wenn du Protokolle migrierst oder Beispiele brauchst
    - **Besonders wichtig:**
      - Effect Parameter Patterns
      - Target Filtering
      - Conditional Chains
      - Death Protocol Beispiel (komplett)

**Custom Protocol Code-Dateien:**

- **`types/customProtocol.ts`** - Type Definitions
  - Alle Effect Parameter Types
  - EffectDefinition, CustomProtocolDefinition
  - Conditional Types (if_executed, then, followUp)

- **`logic/customProtocols/effectInterpreter.ts`** ⭐ - Core Engine
  - Führt Custom Effects aus
  - Validiert Position (top/middle/bottom)
  - Handled Conditionals und Chains
  - Respektiert Spielregeln (Frost-1, Apathy-2, etc.)
  - **KRITISCH:** Diese Datei ist das Herzstück!

- **`logic/customProtocols/storage.ts`** - localStorage Management
  - loadCustomProtocols(), saveCustomProtocol()
  - Import/Export JSON

- **`logic/customProtocols/cardFactory.ts`** - Card Generation
  - Konvertiert JSON → Card Objects
  - Fügt customEffects zu Karten hinzu

- **`screens/CustomProtocolCreator/`** - UI Components
  - ProtocolList.tsx - Protokoll-Übersicht
  - ProtocolWizard.tsx - Editor
  - CardEditor.tsx - Einzelne Karte editieren
  - EffectParameterEditors/ - Parameter-Editoren für jeden Effect Type

**Custom Protocol Activation:**
- Custom Protocols sind standardmäßig UNSICHTBAR
- Aktivierung: 5× auf "developed" im Main Menu klicken
- Einstellung in `localStorage` via `utils/customProtocolSettings.ts`

#### 3.4 Game-Logic

12. **Kern-Dateien** (in dieser Reihenfolge):

   **a) `logic/game/stateManager.ts`**
   - Enthält: `recalculateAllLaneValues`, `getEffectiveCardValue`, `calculateCompilableLanes`
   - **Wann lesen:** Wenn du verstehen musst, wie Werte berechnet werden

   **b) `logic/game/phaseManager.ts`**
   - Enthält: `advancePhase`, `processEndOfAction`, `processQueuedActions`
   - **Wann lesen:** Wenn du Phase-Übergänge oder queued actions debuggen musst
   - **Wichtig:** `processQueuedActions` verarbeitet Auto-Resolving Actions (z.B. flip_self_for_water_0)

   **c) `logic/game/actionResolver.ts`**
   - Enthält: Haupt-Dispatcher für alle Actions
   - **Wann lesen:** Wenn du verstehen musst, wie Actions verarbeitet werden

   **d) `logic/game/resolvers/`** Ordner
   - `cardResolver.ts` - Karten-Aktionen (flip, delete, return, etc.)
   - `laneResolver.ts` - Shift-Aktionen + Play Card
   - `discardResolver.ts` - Discard-Aktionen
   - `promptResolver.ts` - Prompts (Rearrange, Compile, etc.)
   - **Wann lesen:** Wenn du einen spezifischen Action-Typ debuggen musst

   **e) `logic/effectExecutor.ts`** ⭐
   - Verbindet Original Effects UND Custom Protocol Effects
   - Ruft `executeCustomEffect` für Custom Cards
   - **KRITISCH:** Hier wird entschieden ob Original oder Custom Effect

#### 3.5 AI-System

13. **`logic/ai/`** Ordner
    - `easy.ts` - Einfache AI (spielt höchsten Wert)
    - `normal.ts` - Mittlere AI (strategisch mit Fehlern)
    - `hardImproved.ts` - Schwere AI (Memory-System, Strategie)
    - **Wann lesen:** Nur wenn du AI-Bugs fixen musst
    - **Wichtig:** Ignoriere `hard.ts` (veraltet)
    - **Custom Protocols:** AI kann Custom Protocols noch NICHT spielen (TODO)

---

## 🎨 CSS-Struktur (Wichtig!)

Das CSS ist modular aufgeteilt - **NIEMALS** direkt in einzelne CSS-Dateien schauen, erst `CSS_STRUCTURE.md` lesen!

### Datei-Organisation

**Root-Level (`styles/`):**
- `base.css` - Basis-Variablen, Reset, Dark Theme
- `components.css` - Karten, Buttons, UI-Komponenten, Protocol-Farben
- `custom-protocol-creator.css` - Custom Protocol Editor
- `StatisticsScreen.css` - Statistics Screen

**Layout-Spezifisch (`styles/layouts/`):**
- `main-menu.css` - Main Menu Layout
- `game-screen.css` - Spiel-Screen (Board, Lanes, Hand)
- `card-library.css` - Card Library
- `protocol-selection.css` - Protocol Selection

**Responsive (`styles/responsive/`):**
- `tablet.css` - Tablet Media Queries (@media (max-width: 1024px))

### Wo ändere ich was?

| Was? | Datei |
|------|-------|
| **Karten-Styling** | `components.css` |
| **Protocol-Farben** | `components.css` (CSS-Variablen wie `--protocol-anarchy`) |
| **Buttons/Inputs** | `components.css` |
| **Main Menu Layout** | `layouts/main-menu.css` |
| **Game Board** | `layouts/game-screen.css` |
| **Protocol Selection** | `layouts/protocol-selection.css` |
| **Card Library** | `layouts/card-library.css` |
| **Custom Protocol Editor** | `custom-protocol-creator.css` |
| **Tablet-Anpassungen** | `responsive/tablet.css` |
| **Dark Theme** | `base.css` |

### Wichtige Regeln

1. **NIEMALS** inline Styles in Components - immer CSS-Klassen
2. **NIEMALS** direkte Farben - immer CSS-Variablen (`var(--protocol-anarchy)`)
3. **IMMER** Tablet-Responsive beachten - Test bei 1024px Breite
4. **BEI LAYOUT-BUGS:** Erst `CSS_STRUCTURE.md` lesen, dann relevante CSS-Datei

---

## 📋 Checkliste für neue Session

Beim Start einer neuen Programmier-Session:

- [ ] **ZUERST:** `npm run check:all` ausführen! ⚡
- [ ] Lies `beschreibung.txt` (2 min)
- [ ] Lies `COMP-MN01_Rulesheet_Updated.pdf` Seite 1-2 (3 min)
- [ ] Lies `LOGGING_SYSTEM.md` (5 min) ⭐
- [ ] Scanne `CARD_TARGETING_RULES.md` Tabellen (2 min)
- [ ] **OPTIONAL:** Lies `CUSTOM_PROTOCOL_CREATOR.md` wenn Custom Protocol Task (5 min)
- [ ] **DANN:** Melde dich beim User zurück!

**Geschätzte Zeit:** ~13 Minuten (18 min mit Custom Protocols)

---

## 🔨 Build & Test Prozedere (PFLICHT!)

**VOR JEDEM BUILD MUSS DIES AUSGEFÜHRT WERDEN:**

```bash
# IMMER in dieser Reihenfolge:
npm run check:all    # Prüft queuePendingCustomEffects + custom protocol JSONs
npm run build        # Baut das Projekt
```

### Was `npm run check:all` prüft:

1. **`check:effects`** - Findet fehlende `queuePendingCustomEffects` calls
   - ✅ Alle Resolver/Helpers haben queue vor `actionRequired = null`
   - ❌ Fehlt queue → Multi-Effect Karten brechen!

2. **`test:protocols`** - Validiert alle custom protocol JSONs
   - ✅ Alle effects haben `position`, `trigger`, `params`, `id`
   - ✅ Conditional chains korrekt verschachtelt
   - ✅ ReactiveTriggerActor bei reactive triggers gesetzt
   - ❌ Structural errors → Karten funktionieren nicht!

### ⚠️ NIEMALS ohne Tests bauen!

**FALSCH** ❌:
```bash
npm run build  # Direkt bauen ohne Tests
```

**RICHTIG** ✅:
```bash
npm run check:all && npm run build
```

### Nach JEDER Code-Änderung:

- [ ] Geändert: Resolver/Helper? → `npm run check:all`
- [ ] Geändert: Custom Protocol JSON? → `npm run check:all`
- [ ] Geändert: Text-Generierung? → `npm run check:all`
- [ ] **DANN ERST:** `npm run build`

### Wenn Tests fehlschlagen:

**check:effects schlägt fehl:**
- Problem: Fehlende `queuePendingCustomEffects`
- Fix: Vor JEDEM `actionRequired = null` einfügen:
  ```typescript
  newState = queuePendingCustomEffects(newState);
  newState.actionRequired = null;
  ```

**test:protocols schlägt fehl:**
- Problem: Fehlendes Feld in custom protocol JSON
- Fix: Fehlende `position`, `trigger`, etc. hinzufügen
- Beispiel: `"position": "middle"` bei middleEffects

**NIEMALS Code committen wenn Tests fehlschlagen!**

---

## 🎯 Schnell-Referenz: Wo finde ich was?

| Was suchst du? | Wo findest du es? |
|----------------|-------------------|
| **Spielregeln** | `beschreibung.txt`, PDF, `GAME_RULES.md` |
| **Original Karten-Effekte** | `data/cards.ts` → `logic/effects/{protocol}/{Card}.ts` |
| **Custom Protocol Effekte** | `logic/customProtocols/effectInterpreter.ts` |
| **Custom Protocol Typen** | `types/customProtocol.ts` |
| **Custom Protocol Migration** | `CUSTOM_PROTOCOL_MIGRATION_GUIDE.md` |
| **Logging-Regeln** | `LOGGING_SYSTEM.md` ⭐ |
| **Targeting-Regeln** | `CARD_TARGETING_RULES.md` |
| **CSS - Komponenten** | `styles/components.css` |
| **CSS - Layouts** | `styles/layouts/{screen}.css` |
| **CSS - Tablet** | `styles/responsive/tablet.css` |
| **CSS - Übersicht** | `CSS_STRUCTURE.md` ⭐ |
| **Phase-Management** | `logic/game/phaseManager.ts` |
| **Shift-Logic** | `logic/game/resolvers/laneResolver.ts` |
| **Delete/Flip/Return** | `logic/game/resolvers/cardResolver.ts` |
| **AI-Entscheidungen** | `logic/ai/easy.ts`, `normal.ts`, `hardImproved.ts` |
| **Uncover-Logic** | `logic/game/helpers/actionUtils.ts` → `handleUncoverEffect` |
| **Queued Actions** | `logic/game/phaseManager.ts` → `processQueuedActions` |
| **Pending Effects Queue** | `logic/game/phaseManager.ts` → `queuePendingCustomEffects` ⭐ |
| **Effect Execution** | `logic/effectExecutor.ts` (Original + Custom) |
| **Check Missing Queues** | `npm run check:effects` (Auto-Check Script) ⚡ |
| **Check Custom Protocols** | `npm run test:protocols` (JSON Validation) ⚡ |
| **Check ALLES** | `npm run check:all` (Beide Tests) ⚡ |

---

## 🔥 Häufige Bug-Kategorien & Wo schauen

### 🚨 Effekte werden verschluckt (Multi-Effect Karten)
→ **Check:**
1. **ZUERST:** `npm run check:effects` ausführen ⚡
2. Suche nach `actionRequired = null` ohne vorheriges `queuePendingCustomEffects`
3. Prüfe `logic/game/resolvers/` (laneResolver, discardResolver, cardResolver)
4. Prüfe `logic/game/helpers/actionUtils.ts` (handleUncoverEffect, handleOnFlipToFaceUp)
5. **Pattern:** Reactive Effects → queuePendingCustomEffects → actionRequired = null
→ **Symptom:** Zweiter/dritter Effekt wird nicht ausgeführt nach Uncover/Shift/Return

### Softlock nach Effekt
→ **Check:**
1. `laneResolver.ts` - Animation Callbacks müssen IMMER `endTurnCb` aufrufen
2. `phaseManager.ts` - `processQueuedActions` muss Queue verarbeiten
3. `cardResolver.ts` - Keine Queue zu actionRequired bewegen!

### Custom Protocol Effect funktioniert nicht
→ **Check:**
1. `effectInterpreter.ts` - Position-Check (top/middle/bottom)
2. Karte face-up? (für alle Effekte)
3. Karte uncovered? (für middle/bottom Effekte)
4. Target Filters korrekt? (owner, position, faceState)
5. Conditional richtig verschachtelt?

### Falsches Logging (Einrückung/Source)
→ **Check:** `LOGGING_SYSTEM.md`, `actionUtils.ts` (handleUncoverEffect), `cardResolver.ts` (Context-Management)

### Effekt wird nicht ausgeführt / falsche Bedingung
→ **Check:**
1. Original Card: `logic/effects/{protocol}/{Card}.ts`
2. Custom Card: `logic/customProtocols/effectInterpreter.ts`
3. Ist Karte face-up? Ist Karte uncovered?
4. Wird Effect vom richtigen Executor aufgerufen? (`effectExecutor.ts`)

### AI macht dumme Entscheidung
→ **Check:** `logic/ai/{difficulty}.ts`, validiere mit `CARD_TARGETING_RULES.md`

### Information Leak (Spieler sieht Gegner-Karte)
→ **Check:** Log-Messages in Effect-Dateien, siehe `LOGGING_SYSTEM.md` Regel 3

### Karte targetiert falsch (covered statt uncovered)
→ **Check:** `CARD_TARGETING_RULES.md`, dann AI-Handler oder Resolver

### Layout/CSS kaputt auf Tablet
→ **Check:**
1. `CSS_STRUCTURE.md` - Welche Datei ist zuständig?
2. `styles/responsive/tablet.css` - Media Query prüfen
3. Breakpoint 1024px testen

### Protocol Grid zu breit/Cards falsche Größe
→ **Check:**
1. `CSS_STRUCTURE.md` → "Troubleshooting"
2. `styles/responsive/tablet.css` - Grid-Dimensionen

### Custom Protocol Editor Validation Error
→ **Check:**
1. `CUSTOM_PROTOCOL_CREATOR.md` - Validation Rules
2. Required Fields gefüllt?
3. Conditionals haben thenEffect?
4. Position/Trigger Kombination gültig?

---

## 💡 Wichtige Konzepte (Kurzform)

### Face-Up vs Face-Down
- **Face-Up:** Alle Effekte aktiv (Top/Middle/Bottom), Wert sichtbar
- **Face-Down:** Keine Effekte, Wert = 2 (oder 4 mit Darkness-2)

### Covered vs Uncovered
- **Uncovered:** Oberste Karte im Stack → Middle + Bottom aktiv
- **Covered:** Darunter → nur Top aktiv (wenn face-up)

### Effekt-Typen (Original + Custom)
- **Top (Persistent):** Immer aktiv wenn face-up (auch wenn covered)
- **Middle (Immediate):** Beim Spielen/Aufdecken/Uncovern (nur wenn uncovered!)
- **Bottom (Auxiliary):** Nur wenn uncovered (triggered effects: start, end, on_cover)

### Custom Protocol Positions
- **Top:** Passive Rules, Value Modifiers - aktiv wenn covered
- **Middle:** Draw, Flip, Delete, etc. - NUR wenn uncovered
- **Bottom:** Start/End/OnCover Triggers - NUR wenn uncovered

### Turn-Interrupt
- Wenn Effekt für anderen Spieler Action benötigt
- `_interruptedTurn` speichert ursprünglichen Turn
- Nach Interrupt: Resume original turn

### Queued Actions
- Actions die nach aktueller Action ausgeführt werden
- Beispiel: `flip_self_for_water_0`, `anarchy_0_conditional_draw`
- Werden in `phaseManager.ts` → `processQueuedActions` verarbeitet
- **KRITISCH:** NIEMALS Queue zu actionRequired bewegen!

### Conditional Chains (Custom Protocols)
- **optional: true** → "You may..."
- **conditional: { type: "if_executed" }** → "If you do..."
- **conditional: { type: "then" }** → "...then..."
- **followUpEffect** → Sequentielle Verkettung

---

## ⚠️ Kritische Warnungen

1. **🚨 NIEMALS** `actionRequired = null` setzen ohne vorher `queuePendingCustomEffects(newState)` zu rufen!
   - **Warum:** Multi-Effect Custom Protocols speichern pending effects in `_pendingCustomEffects`
   - **Fix:** IMMER `newState = queuePendingCustomEffects(newState);` VOR `actionRequired = null`
   - **Check-Script:** `npm run check:all` findet alle fehlenden Stellen automatisch!
   - **Pattern:**
     ```typescript
     // ❌ FALSCH - Effects werden verschluckt!
     newState.actionRequired = null;

     // ✅ RICHTIG - Effects werden in Queue gespeichert
     newState = queuePendingCustomEffects(newState);
     newState.actionRequired = null;
     ```
   - **VOR JEDEM BUILD:** `npm run check:all && npm run build` ausführen!

2. **IMMER** `decreaseLogIndent` symmetrisch zu `increaseLogIndent` aufrufen!

3. **IMMER** prüfen ob Karte face-up UND uncovered ist, bevor Follow-up-Effekt ausgeführt wird!

4. **NIEMALS** Gegner-Karten-Details im Log zeigen (Information Leak)!

5. **IMMER** `setLogSource` und `setLogPhase` bei queued actions neu setzen!

6. **NIEMALS** Animation Callbacks ohne `endTurnCb` aufrufen - führt zu Softlock!

7. **NIEMALS** Queue-Actions zu `actionRequired` bewegen - sie sind auto-resolving!

8. **NIEMALS** Custom Protocol Effekte mit card-spezifischem Code - nur Parameter!

9. **NIEMALS** `Math.random()` nutzen - IMMER `import`, nie `require()` - es ist eine Web-App!

10. **NIEMALS** Dev-Server selbst starten - User macht das!

---

## 🛠️ Debugging-Workflow

Wenn etwas nicht funktioniert:

1. **Reproduziere Bug** (am besten mit Debug-Tool oder Testszenario)
2. **Lies Log** (drücke "Log" Button im Spiel)
3. **Identifiziere Problem:**
   - Softlock? → Check queued actions / actionRequired / Animation Callbacks
   - Falsches Logging? → Check Indent-Level / Source
   - Effekt nicht ausgeführt? → Check face-up / uncovered / Position
   - Falscher Actor? → Check `actionRequired.actor` vs `state.turn`
   - Custom Protocol Bug? → Check effectInterpreter.ts Position-Validierung
4. **Finde relevante Datei** (siehe "Wo finde ich was?" Tabelle oben)
5. **Lies Code-Kontext** (nur betroffene Funktion)
6. **Finde Root Cause** - NICHT raten, systematisch analysieren!
7. **Implementiere Fix**
8. **Teste mit Debug-Tool oder Testszenario**

---

## 📚 Zusätzliche Notizen

### Was NICHT einlesen
- ❌ `node_modules/` (Dependencies)
- ❌ `dist/` oder `docs/` (Build-Artifacts)
- ❌ `logic/ai/hard.ts` (veraltet, benutze `hardImproved.ts`)
- ❌ UI-Code (`screens/`, `components/`) außer bei UI-Bugs
- ❌ Einzelne CSS-Dateien (benutze stattdessen `CSS_STRUCTURE.md`)
- ❌ Veraltete MD-Dateien (alle Status/TODO/Analysis Dateien wurden gelöscht)

### Nützliche Grep-Patterns
```bash
# Finde alle Effekte einer Original-Karte
grep -r "Anarchy-0" logic/effects/

# Finde wo Action-Type verwendet wird
grep -r "select_card_to_shift" logic/

# Finde Log-Messages
grep -r "log(" logic/ | grep "Anarchy-0"

# Finde Custom Protocol Effect Parameter
grep -r "action: 'draw'" logic/customProtocols/

# Finde CSS für Komponente
grep -r "\.card\b" styles/
```

### Custom Protocol localStorage
```javascript
// In Browser Console:
localStorage.getItem('customProtocols') // Alle Custom Protocols
localStorage.getItem('customProtocolsEnabled') // Aktivierungs-Status
```

---

## ✅ Nach dem Einlesen

Wenn du diese Anleitung befolgt hast, solltest du:

✅ Die Spielregeln verstehen (face-up, uncovered, compile)
✅ Das Logging-System verstehen (indent, source, phase)
✅ Wissen wo Code für spezifische Features liegt
✅ Custom Protocol System verstehen (wenn relevant)
✅ CSS-Struktur kennen (modular, wo was liegt)
✅ Häufige Bug-Kategorien kennen
✅ Bereit sein zum Programmieren!

**Melde dich beim User und frage nach der Aufgabe!** 🚀

---

## 🎓 Spezial-Themen

### Custom Protocol Migration

Wenn du Original-Protokolle zu Custom Protocols migrierst:
1. Lies `CUSTOM_PROTOCOL_MIGRATION_GUIDE.md` komplett
2. Prüfe alle 6 Karten des Protokolls
3. Mappe jeden Effekt zu Effect Type + Parametern
4. Nutze Conditional Chains für komplexe Effekte
5. Teste JEDEN Edge Case (no targets, softlocks, etc.)

### Water-0 Pattern (Flip Self After Flip Other)

```typescript
{
  params: { action: "flip", count: 1, excludeSelf: true },
  conditional: {
    type: "then",
    thenEffect: {
      params: { action: "flip", count: 1, deleteSelf: true }
    }
  }
}
```

Generiert Queue-Action `flip_self_for_water_0` die von `processQueuedActions` verarbeitet wird.

### Death-1 Pattern (Optional Draw → Delete Other → Delete Self)

```typescript
{
  params: { action: "draw", count: 1, optional: true },
  conditional: {
    type: "if_executed",
    thenEffect: {
      params: { action: "delete", count: 1, excludeSelf: true },
      conditional: {
        type: "then",
        thenEffect: {
          params: { action: "delete", count: 1, deleteSelf: true }
        }
      }
    }
  }
}
```

Multi-Step Conditional Chain.

---

**Viel Erfolg!** 🚀
