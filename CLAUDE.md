# COMPILE Card Game

Ein kompetitives Kartenspiel, bei dem zwei KI-Spieler um die Wette ihre 3 Protokolle kompilieren, um die Realitat neu zu schreiben.

## Tech Stack
- **Framework**: React 19 + Vite 6
- **Sprache**: TypeScript 5.8 (strict mode)
- **Datenbank**: Keine (Client-only, localStorage fur Statistiken)
- **Styling**: Vanilla CSS mit CSS-Variablen (Cyberpunk-Theme)
- **Testing**: Vitest (Unit), Playwright (E2E)
- **Besonderheit**: Datengetriebenes Custom Protocol System (JSON-definierte Karteneffekte)

## Projektstruktur
```
compile/
├── components/           # React UI-Komponenten (Card, Lane, GameBoard, Modals)
├── screens/              # Hauptbildschirme (GameScreen, MainMenu, ProtocolSelection)
│   └── CustomProtocolCreator/  # Protocol-Editor mit Effect-Editoren
├── hooks/                # React Hooks (useGameState, useStatistics)
├── contexts/             # React Contexts (AnimationQueueContext)
├── logic/                # Gesamte Spiellogik (KEINE async Operationen!)
│   ├── ai/               # KI-Systeme (easy, normal, hardImproved)
│   ├── animation/        # Animation-Factory-Funktionen
│   ├── customProtocols/  # Protocol-Loader, Effect-Interpreter
│   ├── effects/          # Effect-Executoren (delete, flip, shift, etc.)
│   ├── game/             # Kern-Spiellogik (phaseManager, resolvers, aiManager)
│   ├── keywords/         # Keyword-Handler (draw, delete, flip, etc.)
│   └── utils/            # Hilfsfunktionen (log, boardModifiers)
├── custom_protocols/     # JSON-Definitionen fur alle Protokolle (32+)
├── types/                # TypeScript Typdefinitionen
├── styles/               # CSS-Dateien (base, components, layouts)
├── utils/                # Utility-Funktionen (snapshotUtils, targeting)
├── constants/            # Konstanten (animationTiming)
├── tests/                # Vitest Unit-Tests
└── e2e/                  # Playwright E2E-Tests
```

## Entwicklung
```bash
npm install              # Dependencies installieren
npm run dev              # Entwicklungsserver (NUR DER USER STARTET DIES!)
npm run build            # Production Build
npm test                 # Unit-Tests ausfuhren (Vitest)
npm run test:watch       # Tests im Watch-Modus
npm run test:e2e         # Playwright E2E-Tests (startet dev server automatisch)
npm run test:e2e:ui      # Playwright mit UI
npm run test:e2e:debug   # Playwright mit Debugging
npm run check:effects    # Pruft pending Effects
npm run test:protocols   # Testet Custom Protocols
```

## Testing

### Unit Tests (Vitest)
- Liegen in `tests/` Ordner
- Testen Effect-Chains, Trigger, AI-Handler
- `npm test` zum Ausfuhren

### E2E Tests (Playwright)
- Liegen in `e2e/` Ordner
- Testen komplette Spielablaufe im Browser
- Startet automatisch dev server auf Port 3000
- Hilfsfunktionen verfugbar:
  - `startGame(page, options)` - Spiel mit Einstellungen starten
  - `waitForTurn(page, 'player'|'opponent')` - Auf Zug warten
  - `waitForPhase(page, phase)` - Auf Phase warten
  - `playCard(page, cardIndex, laneIndex, faceUp)` - Karte spielen
  - `setupConsoleErrorCapture(page)` - Browser-Fehler erfassen

## Code-Standards
- TypeScript strict mode - keine `any` Types ohne guten Grund
- Clean Code - aussagekraftige Namen, kleine Funktionen, maximal 800 Zeilen pro Datei, ansonsten refactorn
- DRY - Code-Duplikation vermeiden, gemeinsame Helper extrahieren
- KISS - einfache Losungen bevorzugen, nicht uber-engineeren
- Single Point of Truth - eine Stelle fur jede Logik

## Projektspezifische Regeln

### Spiellogik (KRITISCH!)
- **ALLE Logik ist SYNCHRON** - niemals async/await in der Spiellogik!
- **State andert sich SOFORT** - Logik lauft durch, dann Animation
- **Snapshots VOR Anderungen** - Animation zeigt Ubergang vom alten zum neuen State
- **Animation-Queue** - Animationen werden sequentiell aus Queue abgespielt

### Animation System
- **Prinzip: "Capture → Change → Enqueue"**
  1. Animation VOR State-Änderung erstellen (Snapshot korrekt)
  2. Resolver ausführen (State ändert sich)
  3. Animation(s) enqueuen
- **AI-Animationen**: Zentrale Helper in `logic/animation/aiAnimationCreators.ts` verwenden:
  - `createAnimationForAIDecision()` - Dispatcher für flip/delete/return
  - `createAndEnqueueDiscardAnimations()` - Discard-Animationen
  - `createAndEnqueueDrawAnimations()` - Draw-Animationen
  - `filterAlreadyCreatedAnimations()` - Doppelte Animationen vermeiden
- **Basis-Funktionen**: `logic/animation/animationHelpers.ts` für Low-Level Animation-Erstellung
- `enqueueAnimation()` fur alle Animationen nutzen
- Snapshots enthalten Board-Zustand VOR der Anderung
- `processAnimationQueue` darf NIEMALS `setGameState` aufrufen

### Custom Protocol System
- Alle Karteneffekte sind in JSON definiert (`custom_protocols/*.json`)
- `effectInterpreter.ts` - Haupt-Entry-Point fur Effekt-Ausfuhrung
- `cardResolver.ts` - verarbeitet User/AI-Antworten auf `actionRequired`
- Generische Handler bevorzugen (`select_card_to_flip`, `select_cards_to_delete`)

### Resolver-Pattern
- Resolver geben `{ newState, animationRequests?, onCompleteCallback? }` zuruck
- `onCompleteCallback` MUSS `endTurnCb` aufrufen fur Turn-Progression
- Bei `actionRequired` - State zuruckgeben und auf User/AI-Input warten

## Wichtige Hinweise

### Dev Server
- **NIEMALS `npm run dev` starten** - Der User startet den dev server selbst!
- Nur `npm run build` zum Testen von Kompilierungsfehlern
- Nur `npm test` zum Ausfuhren von Tests

### Verstehen vor Andern
- Code LESEN und VERSTEHEN bevor Anderungen gemacht werden
- Nicht raten - bei Unklarheiten mehr Code lesen oder nachfragen
- Ahnliche Implementierungen als Referenz nutzen
- Bei komplexen Anderungen: In den **Planungsmodus** gehen

### Dokumentation
- `AI_ONBOARDING.md` - Detaillierte Onboarding-Dokumentation
- `beschreibung.txt` - Anleitung zum Verständnis der Spielregeln und Karteneffektspezifika
- `COMP-MN01_Rulesheet_Updated.pdf` - Regeln für das Spiel
- `game_rules.md` - Detaillierte Spielregeln

## Haufige Fehler vermeiden

### Animation
- NICHT: Animationen ausserhalb des Queue-Systems erstellen
- NICHT: State in `processAnimationQueue` andern
- NICHT: async/await in Spiellogik verwenden
- NICHT: Animation-Code duplizieren - IMMER zentrale Helper in `aiAnimationCreators.ts` nutzen oder erweitern!
- IMMER: Snapshot VOR der State-Anderung erstellen
- IMMER: `enqueueAnimation()` fur alle Animationen nutzen
- IMMER: Multi-Card Animationen VOR `setGameState` erstellen
- IMMER: Neue Animation-Typen als Helper in `aiAnimationCreators.ts` hinzufügen (DRY, Single Point of Truth)

### Logik
- NICHT: `processQueuedActions` direkt im Callback aufrufen (uberspringt Turn-Flow!)
- NICHT: `any` Types ohne guten Grund verwenden
- NICHT: Code duplizieren - Helper-Funktionen extrahieren
- IMMER: `onCompleteCallback` mit `endTurnCb` fur Turn-Progression
- IMMER: `prevState` statt `state` in Funktionen mit `prevState` Parameter
- IMMER: Karten von oben (uncovered) nach unten (covered) loschen bei Compile

### Allgemein
- NICHT: Den dev server starten (`npm run dev`)
- NICHT: Raten bei Unklarheiten - Code lesen oder fragen
- NICHT: Uber-engineeren - KISS Prinzip befolgen
- IMMER: Tests fur neue Features schreiben
- IMMER: Build prufen nach Anderungen (`npm run build`)
- IMMER: Bestehende Patterns als Referenz nutzen

## Kern-Dateien Referenz

| Datei | Zweck |
|-------|-------|
| `hooks/useGameState.ts` | Zentraler Game-State-Manager |
| `logic/game/aiManager.ts` | AI-Turn-Management und Callbacks |
| `logic/game/phaseManager.ts` | Phase-Transitions und Turn-Flow |
| `logic/customProtocols/effectInterpreter.ts` | Effekt-Ausfuhrung |
| `logic/game/resolvers/cardResolver.ts` | User/AI-Response-Handling |
| `logic/game/resolvers/miscResolver.ts` | Compile, Control, etc. |
| `logic/game/reactiveEffectProcessor.ts` | Reaktive Effekte (after_draw, etc.) |
| `logic/animation/aiAnimationCreators.ts` | Zentrale AI-Animation-Helper (DRY) |
| `logic/animation/animationHelpers.ts` | Animation-Factory-Funktionen |
| `contexts/AnimationQueueContext.tsx` | Animation-Queue-Management |
| `types/index.ts` | Kern-TypeScript-Typen |
| `types/animation.ts` | Animation-Typen |

## Turn-Flow Ubersicht

```
1. Start Phase    -> Trigger "start" effects auf uncovered face-up cards
2. Control Phase  -> Control-Mechanic (Protokolle umordnen)
3. Compile Phase  -> Wenn Lane >= 10 UND > Gegner: MUSS kompilieren
4. Action Phase   -> PLAY card ODER REFRESH (auf 5 Karten auffüllen)
5. Hand Limit     -> Auf 5 Karten abwerfen wenn notig
6. End Phase      -> Trigger "end" effects auf uncovered face-up cards
```

## Animation-Flow

```
1. Effekt ausfuhren (synchron)     -> State andert sich SOFORT
2. AnimationRequest erstellen       -> { type, cardId, owner, ... }
3. processAnimationQueue aufrufen   -> Erstellt AnimationQueueItems
4. enqueueAnimation()               -> In Queue einreihen
5. AnimationOverlay zeigt Animation -> Karte fliegt von A nach B
6. onAnimationComplete()            -> Nachste Animation in Queue
```
