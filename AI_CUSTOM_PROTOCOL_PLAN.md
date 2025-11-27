# Plan: KI-Überarbeitung für Custom Protocol Effekte

## Aktueller Zustand

### Dateien:
- `easy.ts` (1043 Zeilen) - Einfache KI, spielt höchste Karten
- `normal.ts` (1435 Zeilen) - Mittlere KI mit Scoring, 20% Fehlerrate
- `hardImproved.ts` (3011 Zeilen) - Fortgeschrittene KI mit Memory, aber **zu schwach**
- `controlMechanicLogic.ts` (354 Zeilen) - Shared Logic für Rearrange/Swap

### Probleme:
1. **~50+ hardkodierte Handler** für spezifische Protokoll-Aktionen
2. **Keine Unterstützung für Custom Protocol Effekte**
3. **hardImproved ist zu schwach** - verliert oft gegen normale Spieler
4. **Viel duplizierter Code** zwischen den KI-Levels
5. **Keine generischen Handler** für `customEffects`

---

## Detaillierte Analyse der aktuellen KI-Implementierungen

### Easy AI (`easy.ts`)

**Strategie:**
- Spielt die höchste verfügbare Karte
- Versucht erst face-up zu spielen, dann face-down
- Priorisiert Lanes nahe der Compile-Schwelle (8-9)
- Keine Memory, keine strategische Planung

**Handler-Struktur:**
- `getBestCardToPlay()`: Simple Logik, höchste Karte spielen
- `handleRequiredAction()`: ~40 case-Handler für Actions
- Meistens zufällige Auswahl oder erste verfügbare Option

**Custom Protocol Support:**
- ✅ `prompt_optional_effect` → immer `accept: false`
- ✅ Basis `select_cards_to_delete` mit `targetFilter` support
- ✅ `select_card_to_shift` generischer Handler
- ⚠️ Keine Bewertung von `customEffects` beim Spielen

**Stärken:**
- Einfach zu verstehen und debuggen
- Zuverlässig (wenig Bugs)
- Schnelle Entscheidungen

**Schwächen:**
- Zu vorhersagbar
- Keine strategische Tiefe
- Viele Effekte werden ignoriert

---

### Normal AI (`normal.ts`)

**Strategie:**
- Scoring-basierte Entscheidungen
- 20% Fehlerrate für menschlicheres Verhalten
- Priorisiert Compile-Blocking und eigene Compile-Setups
- Bewertet Disruption-Keywords

**Handler-Struktur:**
- `getBestMove()`: Evaluiert alle möglichen Züge mit Scores
- `ScoredMove` Type mit `move`, `score`, `reason`
- `handleRequiredAction()`: ~50 case-Handler

**Key Scoring Faktoren:**
```typescript
// Face-up play
- Block compile: +180
- Compile setup: +120
- Near compile (8+): +40
- Disruption bonus: +30

// Face-down play
- Block compile: +170
- Compile setup: +110
```

**Custom Protocol Support:**
- ✅ `prompt_optional_effect` → `!shouldMakeMistake()` (80% accept)
- ✅ `select_cards_to_delete` mit `actorChooses` support
- ✅ `select_card_to_shift` generischer Handler
- ⚠️ Keine Bewertung von `customEffects` beim Spielen

**Stärken:**
- Gut balanciert
- Menschliches Verhalten durch Fehlerrate
- Gute Defensive gegen Compile-Threats

**Schwächen:**
- Scoring-Konstanten sind nicht optimal getuned
- Keine Memory
- Behandelt alle Lanes gleich

---

### Hard AI (`hardImproved.ts`)

**Strategie:**
- Memory-System für bekannte Karten
- Strategische Position-Bewertung
- Multiple Win-Conditions (Rush, Outlast, Control)
- Protocol Synergy Bonus
- Diversification bei Control-Bedrohung

**Memory System:**
```typescript
interface AIMemory {
    knownPlayerCards: Map<string, PlayedCard>;
    knownOwnCards: Map<string, PlayedCard>;
    suspectedThreats: Set<string>;
    lastPlayerLaneValues: number[];
    turnsPlayed: number;
}
```

**Key Scoring Funktionen:**
- `calculateEffectBaseScore()`: Bewertet Karten-Effekte dynamisch
- `scoreCardForShift()`: Universal Shift Scoring
- `scoreLaneForShiftTarget()`: Target Lane Scoring
- `scoreCardForFlip()`: Universal Flip Scoring mit Memory
- `evaluateStrategicPosition()`: Game-State Analyse

**Strategic Priorities:**
1. CRITICAL DEFENSE (Block immediate compile)
2. WIN THE GAME (One away from win)
3. OUTLAST WIN (Player has no cards)
4. BUILD PROTOCOLS (Main strategy)

**Custom Protocol Support:**
- ✅ `prompt_optional_effect` wird von normal.ts behandelt (80% accept)
- ✅ Alle standard Handler vorhanden
- ✅ `select_card_to_shift` generischer Handler
- ⚠️ `calculateEffectBaseScore()` liest nur `keywords`, nicht `customEffects`
- ❌ Keine Analyse von `customEffects.topEffects/middleEffects/bottomEffects`

**Stärken:**
- Komplexe strategische Entscheidungen
- Memory für Face-Down Karten
- Dynamische Strategie-Anpassung
- Good protocol synergy handling

**Schwächen (warum "zu schwach"):**
1. **Zu defensiv**: Reagiert mehr als agiert
2. **Keine proaktive Disruption**: Wartet auf Bedrohungen statt zu stören
3. **Fill Hand zu selten**: Verpasst Kartenvorteile
4. **Undefendable Lanes zu früh aufgegeben**: -4000 Penalty ist zu hoch
5. **Keine customEffects Analyse**: Bewertet nur hardcodierte Keywords

---

## Duplizierter Code zwischen KIs

### Identische Handler (Copy-Paste):
| Handler | easy.ts | normal.ts | hardImproved.ts |
|---------|---------|-----------|-----------------|
| `select_face_down_card_to_shift_for_gravity_4` | ✓ | ✓ | ✓ |
| `select_card_to_shift_for_anarchy_0` | ✓ | ✓ | ✓ |
| `select_card_to_shift_for_anarchy_1` | ✓ | ✓ | ✓ |
| `select_card_to_shift_for_gravity_1` | ✓ | ✓ | ✓ |
| `select_card_to_flip_and_shift_for_gravity_2` | ✓ | ✓ | ✓ |
| `select_opponent_face_down_card_to_shift` | ✓ | ✓ | ✓ |
| `prompt_rearrange_protocols` | ✓ | ✓ | ✓ |
| ... ~30 weitere | ✓ | ✓ | ✓ |

### Unterschiede zwischen KIs:
| Handler | easy.ts | normal.ts | hardImproved.ts |
|---------|---------|-----------|-----------------|
| `select_cards_to_delete` | First card | Scored by threat | Scored + lane context |
| `select_any_card_to_flip` | Priority list | Priority list + skip | Full scoring |
| `prompt_optional_effect` | Always false | 80% accept | (inherits normal) |
| Lane selection | Random | Strategic | Strategic + diversification |

---

## Neue Architektur

### Kernidee: Gemeinsame Basis + Difficulty-spezifische Bewertung

```
┌─────────────────────────────────────────────────────────┐
│                    AI Core Module                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Generic Action Handlers                         │   │
│  │  - handleCardSelection(state, action, scorer)   │   │
│  │  - handleLaneSelection(state, action, scorer)   │   │
│  │  - handlePromptDecision(state, action, scorer)  │   │
│  └─────────────────────────────────────────────────┘   │
│                         │                               │
│           ┌─────────────┼─────────────┐                │
│           ▼             ▼             ▼                │
│     ┌─────────┐   ┌──────────┐   ┌──────────┐        │
│     │  Easy   │   │  Normal  │   │   Hard   │        │
│     │ Scorer  │   │  Scorer  │   │  Scorer  │        │
│     └─────────┘   └──────────┘   └──────────┘        │
└─────────────────────────────────────────────────────────┘
```

### Scorer Interface:
```typescript
interface AIScorer {
    // Card play evaluation
    scoreCardPlay(card: PlayedCard, laneIndex: number, faceUp: boolean, state: GameState): number;

    // Target selection (for flip/shift/delete/return)
    scoreTarget(card: PlayedCard, owner: Player, laneIndex: number, actionType: string, state: GameState): number;

    // Lane selection
    scoreLane(laneIndex: number, actionType: string, state: GameState): number;

    // Optional effect decision
    shouldAcceptOptional(effectType: string, state: GameState): boolean;

    // Mistake probability (0 = perfect, 1 = random)
    getMistakeProbability(): number;

    // Memory capabilities
    hasMemory(): boolean;
    updateMemory?(state: GameState): void;
}
```

---

## Hard AI: Komplett neu gedacht

### Strategie-Prinzipien:

1. **Compile-Fokus**: Immer auf 2 Lanes kompilieren, 3. Lane opfern
2. **Tempo-Kontrolle**: Nicht zu früh spielen, Hand-Größe managen
3. **Threat Assessment**: Gegner-Bedrohungen erkennen und priorisieren
4. **Effect Maximierung**: Effekte nur nutzen wenn sie Wert liefern
5. **Defensive Spielweise**: Bei Rückstand defensiver, bei Führung aggressiver

### Bewertungs-Faktoren:

```typescript
interface MoveEvaluation {
    // Wert-Änderungen
    valueDelta: number;           // Netto-Änderung der Lane-Werte
    compilePotential: number;     // Wie nah bringt uns das zur Compile?
    opponentDisruption: number;   // Wie sehr stören wir den Gegner?

    // Strategische Faktoren
    tempoValue: number;           // Handgröße, Deck-Größe berücksichtigen
    boardControl: number;         // Anzahl Karten auf Board, Positionen
    effectQuality: number;        // Qualität der Effekte die wir auslösen

    // Risiko-Bewertung
    counterPlayRisk: number;      // Wie leicht kann Gegner kontern?
    commitmentLevel: number;      // Wie stark committed sind wir?
}
```

### Compile-Strategie:

```typescript
function evaluateCompileStrategy(state: GameState): LaneStrategy[] {
    const strategies: LaneStrategy[] = [];

    for (let lane = 0; lane < 3; lane++) {
        const myValue = state.opponent.laneValues[lane];
        const theirValue = state.player.laneValues[lane];
        const isCompiled = state.opponent.compiled[lane];

        if (isCompiled) continue;

        const gap = 10 - myValue;
        const winnable = myValue > theirValue || gap <= 3;
        const contested = Math.abs(myValue - theirValue) <= 2;

        strategies.push({
            lane,
            priority: winnable ? (contested ? 'high' : 'medium') : 'abandon',
            cardsNeeded: Math.ceil(gap / 3), // Durchschnittlicher Card Value
            turnsToCompile: Math.ceil(gap / 2.5)
        });
    }

    // Priorisiere 2 beste Lanes, opfere die 3.
    return strategies.sort((a, b) => priorityScore(b) - priorityScore(a));
}
```

---

## Custom Effects Support

### TargetFilter-basierte Auswahl:

```typescript
function selectBestTarget(
    state: GameState,
    targetFilter: TargetFilter,
    actionType: 'flip' | 'shift' | 'delete' | 'return',
    scorer: AIScorer
): { cardId: string; laneIndex: number } | null {

    const candidates: ScoredTarget[] = [];

    // Bestimme welche Owners zu prüfen
    const owners: Player[] =
        targetFilter.owner === 'self' ? ['opponent'] :
        targetFilter.owner === 'opponent' ? ['player'] :
        ['player', 'opponent'];

    for (const owner of owners) {
        for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
            const lane = state[owner].lanes[laneIdx];

            for (let cardIdx = 0; cardIdx < lane.length; cardIdx++) {
                const card = lane[cardIdx];
                const isUncovered = cardIdx === lane.length - 1;

                // Filter prüfen
                if (!matchesFilter(card, isUncovered, targetFilter)) continue;

                // Score berechnen
                const score = scorer.scoreTarget(card, owner, laneIdx, actionType, state);
                candidates.push({ card, owner, laneIndex: laneIdx, score });
            }
        }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.score - a.score);
    return { cardId: candidates[0].card.id, laneIndex: candidates[0].laneIndex };
}
```

### Custom Effect Bewertung:

```typescript
function evaluateCustomEffects(card: PlayedCard, state: GameState): number {
    const effects = card.customEffects;
    if (!effects) return 0;

    let score = 0;
    const allEffects = [...effects.topEffects, ...effects.middleEffects, ...effects.bottomEffects];

    for (const effect of allEffects) {
        const params = effect.params;

        switch (params.action) {
            case 'draw':
                // Draw ist gut, aber abhängig von Deck-Größe
                const deckSize = state.opponent.deck.length;
                score += Math.min(params.count || 1, deckSize) * 15;
                break;

            case 'delete':
                // Delete ist sehr stark wenn Gegner Karten hat
                const opponentCards = state.player.lanes.flat().length;
                score += Math.min(params.count || 1, opponentCards) * 50;
                break;

            case 'flip':
                // Flip Gegner = gut, Flip selbst = situativ
                if (params.targetFilter?.owner === 'opponent') {
                    score += 25;
                } else {
                    const ownFaceDown = state.opponent.lanes.flat().filter(c => !c.isFaceUp).length;
                    score += ownFaceDown > 0 ? 20 : 0;
                }
                break;

            case 'shift':
                // Shift ist gut für Disruption
                score += 20;
                break;

            case 'discard':
                if (params.actor === 'opponent') {
                    score += Math.min(params.count || 1, state.player.hand.length) * 20;
                } else {
                    score -= (params.count || 1) * 15; // Eigenes Discard ist Kosten
                }
                break;

            case 'return':
                score += 30; // Return ist starke Disruption
                break;

            case 'value_modifier':
                score += (params.modifier || 0) * 10;
                break;
        }

        // Conditional Effects weniger wert (unsicher)
        if (effect.conditional) {
            score *= 0.7;
        }
    }

    return score;
}
```

---

## Implementierungsplan

### Phase 1: AI Core Module (Basis)
1. Erstelle `logic/ai/core/types.ts` - Interfaces
2. Erstelle `logic/ai/core/targetSelection.ts` - Generische Target-Auswahl
3. Erstelle `logic/ai/core/laneSelection.ts` - Generische Lane-Auswahl
4. Erstelle `logic/ai/core/effectEvaluation.ts` - Custom Effect Bewertung

### Phase 2: Scorer Implementierungen
1. Erstelle `logic/ai/scorers/easyScorer.ts`
2. Erstelle `logic/ai/scorers/normalScorer.ts`
3. Erstelle `logic/ai/scorers/hardScorer.ts` (komplett neu!)

### Phase 3: Unified Action Handler
1. Erstelle `logic/ai/core/actionHandler.ts` - Ein Handler für alle Aktionen
2. Nutzt Scorer für Entscheidungen
3. Fallback-Logik für unbekannte Actions

### Phase 4: Integration & Migration
1. Refactor `easy.ts` → nutzt Core + EasyScorer
2. Refactor `normal.ts` → nutzt Core + NormalScorer
3. **Komplett neu**: `hardImproved.ts` → nutzt Core + HardScorer

### Phase 5: Testing & Tuning
1. Test-Szenarien für jeden Handler
2. Balance-Tests: Easy < Normal < Hard
3. Custom Protocol Szenarien

---

## Hard AI: Neue Features

### 1. Compile-Path Analysis
```typescript
// Analysiere optimalen Weg zur Compile in jeder Lane
function analyzeCompilePaths(state: GameState): CompilePath[] {
    // Für jede Lane: Welche Karten brauchen wir noch?
    // Welche haben wir in der Hand?
    // Wie viele Züge?
}
```

### 2. Opponent Modeling
```typescript
// Versuche Gegner-Strategie zu erkennen
function modelOpponent(state: GameState, memory: AIMemory): OpponentModel {
    // Welche Lanes priorisiert der Gegner?
    // Spielt er aggressiv oder defensiv?
    // Welche Protokolle nutzt er?
}
```

### 3. Risk Assessment
```typescript
// Bewerte Risiken eines Zugs
function assessRisk(move: AIAction, state: GameState): RiskAssessment {
    // Counter-Play Möglichkeiten
    // Commitment Level
    // Recovery Options
}
```

### 4. Multi-Turn Planning
```typescript
// Plane 2-3 Züge voraus
function planAhead(state: GameState, depth: number): PlannedSequence {
    // Minimax-ähnliche Analyse
    // Berücksichtige wahrscheinliche Gegner-Züge
}
```

---

## Prioritäten

| Feature | Aufwand | Impact | Priorität |
|---------|---------|--------|-----------|
| Generic Target Handler | Mittel | Hoch | 1 |
| Custom Effect Evaluation | Mittel | Hoch | 2 |
| Hard AI Compile Strategy | Hoch | Sehr Hoch | 3 |
| AI Core Module | Hoch | Mittel | 4 |
| Opponent Modeling | Mittel | Mittel | 5 |
| Multi-Turn Planning | Sehr Hoch | Hoch | 6 |

---

## Konkrete nächste Schritte

### Schritt 1: Custom Effect Evaluation hinzufügen (alle AIs)

**Ziel:** AIs sollen `customEffects` beim Spielen von Karten bewerten

**Änderungen:**
1. Neue Funktion `evaluateCustomEffects(card, state)` in `logic/ai/core/effectEvaluation.ts`
2. Diese Funktion in alle drei AIs integrieren
3. `calculateEffectBaseScore()` in hardImproved.ts erweitern

```typescript
// logic/ai/core/effectEvaluation.ts
export function evaluateCustomEffects(card: PlayedCard, state: GameState): number {
    const effects = card.customEffects;
    if (!effects) return 0;

    let score = 0;
    const allEffects = [
        ...effects.topEffects,
        ...effects.middleEffects,
        ...effects.bottomEffects
    ];

    for (const effect of allEffects) {
        score += evaluateSingleEffect(effect, state);
    }

    return score;
}
```

### Schritt 2: Generic Action Handler erstellen

**Ziel:** ~30 duplizierte Handler durch generische ersetzen

**Neue Datei:** `logic/ai/core/genericHandlers.ts`

```typescript
// Handles: select_card_to_shift_for_*, shift_flipped_card_optional, etc.
export function handleGenericCardSelection(
    state: GameState,
    action: ActionRequired,
    scorer: (card: PlayedCard, owner: Player, lane: number) => number
): AIAction {
    const validTargets = collectValidTargets(state, action);
    if (validTargets.length === 0) return { type: 'skip' };

    const scored = validTargets.map(t => ({
        ...t,
        score: scorer(t.card, t.owner, t.laneIndex)
    }));

    scored.sort((a, b) => b.score - a.score);
    return { type: 'deleteCard', cardId: scored[0].card.id };
}
```

### Schritt 3: Hard AI Rebalancing

**Problem:** Hard AI ist zu defensiv und verliert oft

**Änderungen:**
1. **Fill Hand Logic überarbeiten:** Öfter Karten ziehen wenn Hand < 3
2. **Undefendable Penalty reduzieren:** Von -4000 auf -1500
3. **Proaktive Disruption:** Bonus für Disruption auch ohne direkte Bedrohung
4. **Lane Commitment:** Weniger streuen, mehr auf 2 Lanes fokussieren

```typescript
// Vorher: Zu selten Fill Hand
fillHandScore = -5000; // Default: NEVER

// Nachher: Öfter Fill Hand für Kartenvorteil
if (state.opponent.hand.length <= 2 && state.opponent.deck.length > 5) {
    fillHandScore = 1500; // Aktiv Karten ziehen!
}
```

### Schritt 4: AI Core Module aufbauen

**Struktur:**
```
logic/ai/
├── core/
│   ├── types.ts              # AIScorer interface, etc.
│   ├── effectEvaluation.ts   # Custom effect scoring
│   ├── targetSelection.ts    # Generic target selection
│   ├── laneSelection.ts      # Generic lane selection
│   └── genericHandlers.ts    # Shared action handlers
├── scorers/
│   ├── easyScorer.ts
│   ├── normalScorer.ts
│   └── hardScorer.ts
├── easy.ts                   # Nutzt core + easyScorer
├── normal.ts                 # Nutzt core + normalScorer
└── hardImproved.ts           # Nutzt core + hardScorer
```

---

## Empfohlene Reihenfolge

1. **Jetzt:** `evaluateCustomEffects()` Funktion erstellen und in hardImproved.ts integrieren
2. **Dann:** Generic handlers für shift/flip/delete erstellen
3. **Dann:** Hard AI Rebalancing (Fill Hand, Penalties)
4. **Später:** Full Core Module Refactoring
5. **Langfristig:** Multi-Turn Planning
