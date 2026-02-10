# COMPILE Card Game

Kompetitives Kartenspiel: Zwei Spieler (Mensch vs KI) kompilieren um die Wette ihre 3 Protokolle. Datengetriebenes System mit 32+ Protokollen als JSON-Definitionen.

## Tech Stack
- **Framework**: React 19 + Vite 6
- **Sprache**: TypeScript 5.8 (strict mode)
- **Styling**: Vanilla CSS mit CSS-Variablen (Cyberpunk-Theme)
- **Testing**: Vitest (Unit), Playwright (E2E)
- **Datenbank**: Keine (Client-only, localStorage fuer Statistiken)

## Projektstruktur
```
compile/
├── components/           # React UI-Komponenten (Card, Lane, GameBoard, Modals, AnimationOverlay)
├── screens/              # Hauptbildschirme (GameScreen, MainMenu, ProtocolSelection)
│   └── CustomProtocolCreator/  # Protocol-Editor mit Effect-Editoren
├── hooks/                # React Hooks (useGameState, useStatistics)
├── contexts/             # React Contexts (AnimationQueueContext)
├── logic/                # Gesamte Spiellogik (KEINE async Operationen!)
│   ├── ai/               # KI-Systeme (easy, normal, hardImproved)
│   ├── animation/        # animationHelpers.ts (Factories) + aiAnimationCreators.ts (DRY Helper)
│   ├── customProtocols/  # effectInterpreter.ts (Haupt-Entry), Protocol-Loader
│   ├── effects/actions/  # Modulare Executoren (drawExecutor, flipExecutor, deleteExecutor, etc.)
│   ├── game/             # phaseManager, aiManager, reactiveEffectProcessor, stateManager
│   │   ├── resolvers/    # cardResolver, playResolver, discardResolver, handCardResolver, etc.
│   │   └── helpers/      # actionUtils (findCardOnBoard, isCardUncovered, etc.)
│   ├── keywords/         # Keyword-Handler
│   └── utils/            # log, boardModifiers, logMessages
├── custom_protocols/     # JSON-Definitionen fuer alle Protokolle (32+)
├── types/                # index.ts (GameState, PlayedCard, etc.) + animation.ts (AnimationQueueItem, etc.)
├── utils/                # snapshotUtils, targeting
├── constants/            # animationTiming (Durations, Stagger, Easings)
├── styles/               # CSS-Dateien
├── tests/                # Vitest Unit-Tests
└── e2e/                  # Playwright E2E-Tests
```

## Entwicklung
```bash
npm run dev              # Entwicklungsserver (NUR DER USER STARTET DIES! NIEMALS CLAUDE!)
npm run build            # Production Build (zum Pruefen von Kompilierungsfehlern)
npm test                 # Unit-Tests (Vitest)
npm run test:watch       # Tests im Watch-Modus
npm run test:e2e         # Playwright E2E-Tests (startet dev server automatisch)
npm run check:effects    # Prueft pending Effects
npm run test:protocols   # Testet Custom Protocols
```

## Spielregeln (Kurzfassung)

### Gewinnbedingung
Alle 3 eigenen Protokolle kompilieren.

### Turn-Flow (6 Phasen)
```
1. Start Phase    -> "start:" Effekte auf face-up Karten mit sichtbarem Effekt ausfuehren
2. Control Phase  -> Fuehrt in 2+ Lanes? -> Erhaelt Control Component
3. Compile Phase  -> Lane >= 10 UND > Gegner -> MUSS kompilieren
4. Action Phase   -> PLAY (Karte spielen) ODER REFRESH (Hand auf 5 auffuellen)
5. Hand Limit     -> Auf 5 Karten abwerfen wenn noetig
6. End Phase      -> "end:" Effekte auf face-up Karten mit sichtbarem Effekt ausfuehren
```
**Sichtbarkeit**: Top-Effekte sind sichtbar wenn face-up (auch covered). Bottom-Effekte nur wenn face-up UND uncovered.

### Kompilierung
- **Bedingungen**: Lane-Wert >= 10 UND hoeher als Gegner in gleicher Lane
- **Ablauf**: Alle Karten beider Seiten in Lane geloescht -> Protokoll wird "Compiled"
- **Recompile**: Bereits kompiliert? -> Karten geloescht, STATT Umdrehen: Ziehe 1 vom Gegnerdeck (ownership change!)
- **Control Component**: Wer in 2+ Lanes fuehrt, erhaelt Control. Bei Compile/Refresh mit Control: Darf Protokolle rearrange (Positions/Status tauschen)

### Karten-Werte
- **Face-up**: Angezeigter Wert (0-6+)
- **Face-down**: Immer Wert 2
- **Face-up spielen**: NUR in matching Protocol Lane, Middle Command triggert
- **Face-down spielen**: In jede Lane, kein Effekt-Trigger

### Targeting-Regeln (KRITISCH)
- **Default**: NUR uncovered (oberste Karte im Stack = `lane[lane.length - 1]`)
- **Covered**: Alle Karten darunter - NICHT waehlbar, es sei denn explizit ("flip 1 covered card")
- **Scope**: "1 card" = eigene ODER gegner | "your card" = nur eigene | "opponent card" = nur gegner

### Karten-Text-Types
1. **Top Command** (Persistent): Aktiv solange face-up (auch wenn covered - Text ist oben immer sichtbar)
2. **Middle Command** (Immediate): Triggert bei Play face-up / Flip face-up / Uncover
3. **Bottom Command** (Auxiliary): Triggered effects, nur wenn face-up UND uncovered

### Interrupt-System
"Last in, first out" - Neueste Effekte werden zuerst abgehandelt. Wenn ein Effekt einen weiteren triggert, wird der neue Effekt zuerst komplett resolved, dann der urspruengliche fortgesetzt.

## Architektur-Ueberblick

### Datenfluss
```
User/AI Aktion -> Resolver (synchron) -> neuer GameState
                                      -> AnimationRequests
                                      -> actionRequired (wartet auf Input)

AnimationRequests -> _pendingAnimationRequests (auf State)
                  -> useEffect erkennt -> enqueueAnimationsFromRequests()
                  -> AnimationQueue -> AnimationOverlay rendert
                  -> onAnimationComplete() -> naechste Animation
```

### Grundprinzip: ALLES ist SYNCHRON
- **State aendert sich SOFORT** - Logik laeuft komplett durch, dann Animation
- **Animationen sind rein visuell** - Queue zeigt Uebergaenge, aendert NIEMALS State
- **Snapshots VOR Aenderungen** - Animation zeigt von altem zu neuem State

---

## Animation System (KRITISCH!)

### Prinzip: "Capture -> Change -> Enqueue"
1. **Capture**: Snapshot BEVOR State sich aendert (fuer korrekte Animation)
2. **Change**: Resolver/Effekt ausfuehren (State aendert sich sofort)
3. **Enqueue**: Animation mit altem Snapshot in Queue einreihen

### Alle 15 AnimationTypes (`types/animation.ts`)
```
play, delete, flip, shift, return, discard, draw, compile,
give, take, reveal, swap, refresh, phaseTransition, delay
```

### Alle 10 AnimationRequest-Typen (`types/index.ts`)
```typescript
| { type: 'delete'; cardId; owner }
| { type: 'flip'; cardId; owner?; laneIndex?; cardIndex?; toFaceUp? }
| { type: 'shift'; cardId; fromLane; toLane; owner }
| { type: 'return'; cardId; owner }
| { type: 'discard'; cardId; owner }
| { type: 'play'; cardId; owner; toLane?; fromDeck?; isFaceUp? }
| { type: 'draw'; player; count; cardIds; fromOpponentDeck? }
| { type: 'compile_delete'; laneIndex; deletedCards[] }
| { type: 'take'; cardId; owner; cardSnapshot; fromHandIndex }
| { type: 'give'; cardId; owner; cardSnapshot; handIndex }
```

### HAUPTREGEL: Animation-Code DRY halten

**Zentrale Helper in `logic/animation/aiAnimationCreators.ts`:**
- `createAndEnqueueFlipAnimation()` - Flip-Animation
- `createAndEnqueueDeleteAnimation()` - Einzelne Delete-Animation
- `createAndEnqueueLaneDeleteAnimations()` - Lane-basierte Deletes
- `createAndEnqueueReturnAnimation()` - Return-Animation
- `createAndEnqueueShiftAnimation()` - Shift-Animation
- `createAndEnqueuePlayAnimation()` - Play-Animation
- `createAndEnqueueDiscardAnimations()` - Discard-Animationen
- `createAndEnqueueDrawAnimations()` - Draw-Animationen
- `createAndEnqueueGiveAnimation()` - Give-Animation
- `createAnimationForAIDecision()` - Dispatcher fuer AI-Entscheidungen (flip, delete, return, give)
- `filterAlreadyCreatedAnimations()` - Doppelte Animationen vermeiden
- `processCompileAnimations()` - Compile-Delete-Animationen
- `processRearrangeWithCompile()` - Rearrange mit Compile

**Low-Level Factories in `logic/animation/animationHelpers.ts`:**
- `createPlayAnimation()`, `createDeleteAnimation()`, `createFlipAnimation()`
- `createShiftAnimation()`, `createReturnAnimation()`, `createDiscardAnimation()`
- `createDrawAnimation()`, `createGiveAnimation()`, `createTakeAnimation()`
- `createRevealAnimation()`, `createSwapAnimation()`, `createDelayAnimation()`
- `createSequentialDrawAnimations()`, `createSequentialDiscardAnimations()`
- `createCompileDeleteAnimations()`, `createBatchDeleteAnimations()`
- `enqueueAnimationsFromRequests()` - Konvertiert AnimationRequests -> AnimationQueueItems

**Regel: Neuer Animation-Typ? -> Helper in aiAnimationCreators.ts hinzufuegen!**

### _pendingAnimationRequests Flow
```
1. Executor (z.B. drawExecutor) gibt { newState, animationRequests } zurueck
2. effectInterpreter.ts (Zeile ~825): Verschiebt animationRequests -> newState._pendingAnimationRequests
   WICHTIG: Loescht animationRequests aus dem Return-Value!
3. setGameState() wird mit newState aufgerufen
4. useEffect in useGameState.ts (Zeile ~1320): Erkennt _pendingAnimationRequests
5. Ruft enqueueAnimationsFromRequests(state, pending, enqueueAnimation) auf
6. Loescht _pendingAnimationRequests vom State
```

### Snapshot-Rekonstruktion in enqueueAnimationsFromRequests
Die Funktion empfaengt POST-EFFECT State (Karten bereits verschoben). Sie rekonstruiert PRE-EFFECT Snapshots:

- **Trash**: Count-based slicing. Karten im Trash haben KEINE IDs (stripped durch deleteCard/discardCards). Daher: `baseTrash = state.discard.slice(0, length - pendingCount)`. Jede Animation fuegt progressiv zurueck via `deletedToTrash`/`discardedToTrash`.
- **prePlayLanes**: Lanes VOR Play-from-Deck. Fuer sequentielle Plays (Water-1: "play in each other line") - jede Animation zeigt Board mit vorherigen Plays aber OHNE aktuelle.
- **preShiftLanes**: Lanes VOR Shift. Falls Karte schon verschoben, nutze `cardSnapshot` + `preShiftLanes`.
- **preDiscardHand**: Hand VOR Discard. Fuer sequentielle Discards - jede Animation zeigt Hand ohne vorher abgeworfene Karten.
- **Take/Give**: Karten sind schon in neuer Hand. Pre-State wird rekonstruiert: Karte zurueck in alte Hand verschieben.
- **fromOpponentDeck**: Bei Draw-Requests mit `fromOpponentDeck: true` zeigt Animation Ziehen vom Gegnerdeck statt eigenem.

### Player vs AI Animation-Pattern

**Player-Aktionen (useGameState.ts):**
```typescript
// Give/Reveal: Animation VOR setGameState erstellen
if (actionType === 'select_card_from_hand_to_give') {
    const animation = createGiveAnimation(gameState, card, 'player', handIndex);
    enqueueAnimation(animation);  // Snapshot von AKTUELLEM State (pre-change)
}
setGameState(prev => { /* resolver aendert state */ });
// -> _pendingAnimationRequests werden per useEffect verarbeitet
```

**AI-Aktionen (aiManager.ts):**
```typescript
// Give: Animation VOR State-Change erstellen
createAndEnqueueGiveAnimation(state, cardId, 'opponent', enqueueAnimation);
const newState = resolveActionWithHandCard(state, cardId);
// -> _pendingAnimationRequests werden per useEffect verarbeitet
```

### Animation Requests mit Snapshots (KRITISCH)
Requests MUESSEN `cardSnapshot` und Position-Info enthalten, weil die Karte im POST-EFFECT State bereits verschoben/geloescht ist:
```typescript
{ type: 'shift', cardId, owner, fromLane, toLane, cardSnapshot: {...card}, cardIndex, preShiftLanes }
{ type: 'delete', cardId, owner, cardSnapshot: {...card}, laneIndex, cardIndex }
{ type: 'return', cardId, owner, cardSnapshot: {...card}, laneIndex, cardIndex }
{ type: 'take', cardId, owner, cardSnapshot: {...card}, fromHandIndex }
{ type: 'give', cardId, owner, cardSnapshot: {...card}, handIndex }
{ type: 'play', cardId, owner, toLane, fromDeck, isFaceUp, prePlayLanes, playIndex }
{ type: 'discard', cardId, owner, cardSnapshot, preDiscardHand, discardIndex }
{ type: 'draw', player, count, cardIds, fromOpponentDeck }
```

---

## Custom Protocol System
- Alle Karteneffekte in JSON definiert (`custom_protocols/*.json`)
- `effectInterpreter.ts` - Haupt-Entry-Point, ruft modulare Executoren auf
- Modulare Executoren in `logic/effects/actions/`:
  - `drawExecutor.ts`, `flipExecutor.ts`, `deleteExecutor.ts`
  - `discardExecutor.ts`, `shiftExecutor.ts`, `returnExecutor.ts`
  - `playExecutor.ts`, `revealGiveExecutor.ts`, `shuffleExecutor.ts`
  - `copyEffectExecutor.ts`, `swapStacksExecutor.ts`
- Executoren geben `{ newState, animationRequests? }` zurueck
- effectInterpreter propagiert animationRequests -> `_pendingAnimationRequests`
- Generische Handler bevorzugen (`select_card_to_flip`, `select_cards_to_delete`)

## Resolver-Pattern
```typescript
// Resolver Return-Typ:
{ newState: GameState, animationRequests?: AnimationRequest[], onCompleteCallback? }
```
- `onCompleteCallback` MUSS `endTurnCb` aufrufen fuer Turn-Progression
- Bei `actionRequired` - State zurueckgeben und auf User/AI-Input warten
- **Alle Resolver in `logic/game/resolvers/`:**

| Resolver | Zweck |
|----------|-------|
| `cardResolver.ts` | Karten-Selektion (flip, delete, return, shift targets) |
| `playResolver.ts` | Karte aus Hand spielen |
| `discardResolver.ts` | Karten abwerfen |
| `handCardResolver.ts` | Hand-Karten-Aktionen (give, reveal) |
| `laneResolver.ts` | Lane-basierte Aktionen |
| `choiceResolver.ts` | Choice/Prompt-Antworten |
| `miscResolver.ts` | Compile, Control, Rearrange, Fill Hand |
| `promptResolver.ts` | Prompt-basierte Aktionen |
| `followUpHelper.ts` | Follow-up Effekt-Verkettung |

## Interrupt-System (reactiveEffectProcessor.ts)
- Wenn ein Effekt die agierende Partei wechselt (z.B. Spieler flippt -> Hate-0 triggert -> Gegner muss deleten)
- `_interruptedTurn` wird gesetzt, `turn` wechselt temporaer
- Phase-Transition-Animation wird unterdrueckt (via `wasInInterruptRef` in useGameState.ts)
- Nach Interrupt: `turn` wird zurueckgesetzt, `_interruptedTurn` geloescht

## Kern-Dateien Referenz

| Datei | Zweck |
|-------|-------|
| `hooks/useGameState.ts` | Zentraler Game-State-Manager, Animation-Koordination, Player-Actions |
| `logic/game/aiManager.ts` | AI-Turn-Management, AI-Decision -> State -> Animation |
| `logic/game/phaseManager.ts` | Phase-Transitions (Start->Control->Compile->Action->Hand->End) |
| `logic/game/reactiveEffectProcessor.ts` | Reaktive Effekte (after_draw, after_flip, on_cover, etc.) |
| `logic/game/stateManager.ts` | createInitialState(), recalculateAllLaneValues() |
| `logic/customProtocols/effectInterpreter.ts` | Haupt-Entry-Point fuer Effekt-Ausfuehrung |
| `logic/animation/aiAnimationCreators.ts` | Zentrale DRY Animation-Helper |
| `logic/animation/animationHelpers.ts` | Low-Level Animation-Factories + enqueueAnimationsFromRequests |
| `contexts/AnimationQueueContext.tsx` | Animation-Queue: enqueueAnimation(), isAnimating, processQueue |
| `types/index.ts` | GameState, PlayedCard, Player, AnimationRequest, EffectResult, etc. |
| `types/animation.ts` | AnimationType, AnimationQueueItem, VisualSnapshot, CardPosition |
| `constants/animationTiming.ts` | ANIMATION_DURATIONS, ANIMATION_EASINGS, Stagger/Timing-Helpers |
| `utils/snapshotUtils.ts` | createVisualSnapshot(), snapshotToGameState() |
| `logic/game/helpers/actionUtils.ts` | findCardOnBoard(), isCardUncovered(), handleUncoverEffect() |
| `logic/utils/boardModifiers.ts` | deleteCard(), internalShiftCard() |

## Haeufige Fehler vermeiden

### Animation
- NICHT: Animation-Code duplizieren - IMMER zentrale Helper in `aiAnimationCreators.ts` nutzen!
- NICHT: Animationen ausserhalb des Queue-Systems erstellen
- NICHT: State in `processAnimationQueue` aendern
- NICHT: Snapshot NACH State-Aenderung erstellen (muss VORHER sein!)
- IMMER: `enqueueAnimation()` fuer alle Animationen nutzen
- IMMER: `cardSnapshot` + Position-Info in AnimationRequests einschliessen
- IMMER: Multi-Card Animationen VOR `setGameState` erstellen
- IMMER: Trash-Karten haben KEINE IDs -> count-based slicing nutzen, nicht ID-Filter

### Logik
- NICHT: async/await in Spiellogik verwenden (ALLES synchron!)
- NICHT: `processQueuedActions` direkt im Callback aufrufen (ueberspringt Turn-Flow!)
- NICHT: `any` Types ohne guten Grund verwenden
- IMMER: `prevState` statt `state` in Funktionen mit `prevState` Parameter
- IMMER: `onCompleteCallback` mit `endTurnCb` fuer Turn-Progression
- IMMER: Karten von oben (uncovered) nach unten (covered) loeschen bei Compile

### Allgemein
- NICHT: Den dev server starten (`npm run dev`) - User startet selbst!
- NICHT: Raten bei Unklarheiten - Code lesen oder fragen
- NICHT: Ueber-engineeren - KISS Prinzip
- IMMER: Build pruefen nach Aenderungen (`npm run build`)
- IMMER: Tests ausfuehren (`npm test`)
- IMMER: Bestehende Patterns als Referenz nutzen
- IMMER: Bei komplexen Aenderungen in den **Planungsmodus** gehen

## Code-Standards
- TypeScript strict mode - keine `any` Types ohne guten Grund
- Clean Code - aussagekraeftige Namen, kleine Funktionen, max 800 Zeilen pro Datei
- DRY - Code-Duplikation vermeiden, gemeinsame Helper extrahieren
- KISS - einfache Loesungen bevorzugen
- Single Point of Truth - eine Stelle fuer jede Logik

## Weitere Dokumentation
- `game_rules.md` - Detaillierte Spielregeln mit Targeting, Interrupt-System, AI-Strategie
- `CARD_TARGETING_RULES.md` - Karten-Targeting Details
- `beschreibung.txt` - Spielregeln und Karteneffektspezifika
- `COMP-MN01_Rulesheet_Updated.pdf` - Original-Regeln
