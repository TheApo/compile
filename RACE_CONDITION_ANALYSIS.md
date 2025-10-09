# Race Condition Analysis - Compile Game

## Problem Statement

**Race Condition zwischen zwei useEffect Hooks in `useGameState.ts`** führt zu nicht-deterministischem Verhalten, wo manchmal:
- Der falsche Hook zuerst triggert
- Actions in falscher Reihenfolge ausgeführt werden
- Doppelte Turns passieren
- AUCH bei Player-Effekten möglich!

---

## Die beiden betroffenen useEffects

### Hook 1: "AI Turn Processing" (Zeile 814-851)
```typescript
useEffect(() => {
    if (gameState.turn === 'opponent' && !gameState.winner && !gameState.animationState) {
        const timer = setTimeout(() => {
            aiManager.runOpponentTurn(...)
        }, 1500);
        return () => clearTimeout(timer);
    }
}, [gameState.turn, gameState.winner, gameState.animationState, difficulty, onEndGame, processAnimationQueue, gameState.actionRequired]);
```

**Zweck**: Verarbeitet den kompletten Opponent-Turn
**Triggert wenn**: `turn === 'opponent'` UND kein Animation UND nicht gewonnen

### Hook 2: "Opponent Action During Player Turn" (Zeile 853-891)
```typescript
useEffect(() => {
    const isPlayerTurnOrInterrupt = gameState.turn === 'player' || gameState._interruptedTurn === 'player';
    const isOpponentActionDuringPlayerTurn =
        isPlayerTurnOrInterrupt &&
        !gameState.animationState &&
        action && 'actor' in action && action.actor === 'opponent';

    if (isOpponentActionDuringPlayerTurn) {
        const timer = setTimeout(() => {
            aiManager.resolveRequiredOpponentAction(...)
        }, 1500);
        return () => clearTimeout(timer);
    }
}, [gameState.actionRequired, gameState.turn, gameState.animationState, difficulty, processAnimationQueue, onEndGame]);
```

**Zweck**: Resolved opponent actions während Player's Turn (Interrupts)
**Triggert wenn**: `turn === 'player'` ODER `_interruptedTurn === 'player'` UND `actionRequired.actor === 'opponent'`

---

## Das Gravity-2 Szenario (Race Condition)

### Was passiert:

1. **KI spielt Gravity-2** → Flip Metal-5
2. **Metal-5 wird face-up geflippt** → Discard-Effekt triggert
3. **State Update**:
   - `turn: 'opponent'` (bleibt)
   - `actionRequired: { type: 'discard', actor: 'opponent' }`
   - `_interruptedTurn`: undefined (KEIN Interrupt, normaler Opponent-Turn!)

### Race Condition:

**BEIDE useEffects triggern gleichzeitig** weil:
- Hook 1: `turn === 'opponent'` ✓ → setTimeout(1500) startet
- Hook 2: WARTET auf `turn === 'player' OR _interruptedTurn === 'player'` → **Triggert NICHT**

**ABER**: Hook 2 triggert NUR bei Player-Turn-Interrupts, NICHT bei Opponent-Turn-Actions!

### Das ECHTE Problem:

**Hook 1 (`runOpponentTurn`) hat KEINE Logik um `actionRequired` mit `actor === 'opponent'` während Opponent-Turn zu handlen!**

Zeile 440-457 in `aiManager.ts`:
```typescript
if (currentState.actionRequired) {
    const action = currentState.actionRequired;
    let isPlayerAction = false;
    if (action.type === 'discard' && action.actor === 'player') {
        isPlayerAction = true;
    } else if ('actor' in action && action.actor === 'player') {
        isPlayerAction = true;
    }

    if (isPlayerAction) {
        return currentState; // Wait for player input.
    }
}
// DANN: Falls actionRequired existiert, wird handleRequiredAction aufgerufen (Zeile 479-481)
```

**Problem**: `runOpponentTurn` hat eine Funktion `handleRequiredAction` (Zeile 479-481), die opponent actions handled!

---

## Warum ist es manchmal richtig, manchmal falsch?

### Timing-Abhängigkeit:

**Beide Hooks haben `setTimeout(1500)`** → Race zwischen:
1. Hook 1 findet `actionRequired` → ruft `handleRequiredAction` → **RICHTIG**
2. Hook 1 läuft BEVOR `actionRequired` gesetzt wird → macht normalen Turn → **FALSCH** (doppelter Turn)

Das hängt davon ab:
- Wie schnell React die State-Updates batchet
- Wie schnell Animationen laufen
- Ob Browser gerade busy ist

---

## Die RICHTIGE Lösung

### Problem-Analyse:

Es gibt **DREI Fälle**, nicht zwei:

1. **Opponent's Normal Turn** (kein actionRequired)
   - Hook 1 handled das ✓

2. **Opponent's Action during Opponent Turn** (actionRequired.actor === 'opponent', turn === 'opponent')
   - Hook 1 handled das via `handleRequiredAction` ✓
   - Hook 2 triggert NICHT (richtig, weil `turn !== 'player'`) ✓

3. **Opponent's Action during Player Turn** (actionRequired.actor === 'opponent', turn === 'player' OR _interruptedTurn === 'player')
   - Hook 1 triggert NICHT (richtig, weil `turn !== 'opponent'`) ✓
   - Hook 2 handled das ✓

**Aktueller Zustand**: Funktioniert eigentlich korrekt!

**ABER**: Es gibt eine Race Condition bei schnellen State-Updates:
- `runOpponentTurn` wird getriggert BEVOR `actionRequired` im State angekommen ist
- Dann macht Hook 1 einen normalen Turn (play card, etc.)
- State Update mit `actionRequired` kommt an
- Hook 1 triggert NOCHMAL (weil dependencies geändert haben)
- Jetzt macht er die Action

---

## Warum mein Fix nicht funktionierte

```typescript
// MEIN FIX (FALSCH):
const hasOpponentAction = gameState.actionRequired && 'actor' in gameState.actionRequired && gameState.actionRequired.actor === 'opponent';
if (gameState.turn === 'opponent' && !gameState.winner && !gameState.animationState && !hasOpponentAction) {
```

**Problem**: Blockiert Hook 1 wenn `actionRequired.actor === 'opponent'` existiert.

**Aber**: Hook 2 triggert NUR wenn `turn === 'player'`!

**Ergebnis**: Bei `turn === 'opponent'` UND `actionRequired.actor === 'opponent'` triggert **KEINER** der beiden Hooks → **SOFTLOCK**!

---

## Die KORREKTE Lösung

### Option 1: Processing Lock (Empfohlen)

**Idee**: Ein zentraler Lock verhindert parallele AI-Verarbeitung

```typescript
// Neuer State
const [isProcessingAI, setIsProcessingAI] = useState(false);

// Hook 1
useEffect(() => {
    if (gameState.turn === 'opponent' && !gameState.winner && !gameState.animationState && !isProcessingAI) {
        setIsProcessingAI(true);
        const timer = setTimeout(() => {
            aiManager.runOpponentTurn(...);
            // NACH completion:
            setIsProcessingAI(false);
        }, 1500);
        return () => {
            clearTimeout(timer);
            setIsProcessingAI(false);
        };
    }
}, [...]);

// Hook 2
useEffect(() => {
    const isPlayerTurnOrInterrupt = gameState.turn === 'player' || gameState._interruptedTurn === 'player';
    const isOpponentActionDuringPlayerTurn = isPlayerTurnOrInterrupt && !gameState.animationState && action && 'actor' in action && action.actor === 'opponent';

    if (isOpponentActionDuringPlayerTurn && !isProcessingAI) {
        setIsProcessingAI(true);
        const timer = setTimeout(() => {
            aiManager.resolveRequiredOpponentAction(...);
            // NACH completion:
            setIsProcessingAI(false);
        }, 1500);
        return () => {
            clearTimeout(timer);
            setIsProcessingAI(false);
        };
    }
}, [...]);
```

**Vorteile**:
- ✅ Garantiert dass nie zwei AI-Operationen parallel laufen
- ✅ Funktioniert für ALLE Fälle (nicht nur AI, auch Player-Interrupts)
- ✅ Einfach zu verstehen und zu debuggen
- ✅ Keine komplexe Logik

**Nachteile**:
- ❌ Zusätzlicher State
- ❌ Muss in beide Hooks integriert werden

---

### Option 2: Debouncing (Alternative)

**Idee**: Nutze useRef um zu tracken ob ein setTimeout bereits läuft

```typescript
const aiTimerRef = useRef<NodeJS.Timeout | null>(null);

// Hook 1
useEffect(() => {
    if (gameState.turn === 'opponent' && !gameState.winner && !gameState.animationState && aiTimerRef.current === null) {
        aiTimerRef.current = setTimeout(() => {
            aiTimerRef.current = null;
            aiManager.runOpponentTurn(...);
        }, 1500);
        return () => {
            if (aiTimerRef.current) {
                clearTimeout(aiTimerRef.current);
                aiTimerRef.current = null;
            }
        };
    }
}, [...]);

// Hook 2 analog
```

**Vorteile**:
- ✅ Kein zusätzlicher State (nur ref)
- ✅ Lightweight

**Nachteile**:
- ❌ Refs zwischen hooks zu sharen kann fragil sein
- ❌ Cleanup-Logik komplexer

---

### Option 3: Single Unified Hook (Beste Lösung, aber aufwendig)

**Idee**: Merge beide Hooks in einen einzigen, der alle Fälle handled

```typescript
useEffect(() => {
    // Case 1: Opponent's turn
    if (gameState.turn === 'opponent' && !gameState.winner && !gameState.animationState) {
        const timer = setTimeout(() => {
            aiManager.runOpponentTurn(...);
        }, 1500);
        return () => clearTimeout(timer);
    }

    // Case 2: Opponent action during player turn
    const isPlayerTurnOrInterrupt = gameState.turn === 'player' || gameState._interruptedTurn === 'player';
    const isOpponentActionDuringPlayerTurn =
        isPlayerTurnOrInterrupt &&
        !gameState.animationState &&
        gameState.actionRequired &&
        'actor' in gameState.actionRequired &&
        gameState.actionRequired.actor === 'opponent';

    if (isOpponentActionDuringPlayerTurn) {
        const timer = setTimeout(() => {
            aiManager.resolveRequiredOpponentAction(...);
        }, 1500);
        return () => clearTimeout(timer);
    }
}, [gameState.turn, gameState.winner, gameState.animationState, gameState.actionRequired, gameState._interruptedTurn, difficulty, onEndGame, processAnimationQueue]);
```

**Vorteile**:
- ✅ Keine Race Condition möglich (nur ein Hook)
- ✅ Klarere Struktur (alle AI logic an einem Ort)
- ✅ Einfacher zu reasonen über dependencies

**Nachteile**:
- ❌ Kann nur einen setTimeout returnen (cleanup nur für einen)
- ❌ Beide Conditions können gleichzeitig wahr sein → welcher setTimeout wird erstellt?

---

## Empfehlung

**Option 1: Processing Lock** ist die beste Lösung weil:
1. **Robust**: Funktioniert garantiert, keine Edge Cases
2. **Einfach**: Leicht zu verstehen und zu testen
3. **Erweiterbar**: Kann auch für Player-Interrupts genutzt werden
4. **Debuggbar**: Lock-State kann in DevTools inspiziert werden

---

## Implementierungs-Plan

1. **Neuer State**: `const [isProcessingAction, setIsProcessingAction] = useState(false);`
2. **Hook 1 Änderung**: Check `!isProcessingAction`, set zu true am Anfang, false nach completion
3. **Hook 2 Änderung**: Analog zu Hook 1
4. **Testing**: Alle Test-Szenarien durchgehen, insbesondere:
   - Gravity-2 (Interrupt während Opponent-Turn)
   - Psychic-3 (Interrupt während Player-Turn)
   - Death-1 (Start-Phase Effekte)
   - Normale Turns ohne Interrupts

---

## Wichtige Anmerkung

**Das Problem betrifft NICHT nur AI!** Auch Player-Aktionen können Race Conditions haben wenn:
- Player-Action triggert einen Interrupt
- Interrupt wird resolved
- State-Update ist nicht synchron
- Nächste Action startet bevor State vollständig updated

Der Processing Lock schützt vor ALLEN solchen Fällen!
