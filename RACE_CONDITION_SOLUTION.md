# Race Condition - Vollständige Analyse & Robuste Lösung

## Warum der Processing Lock fehlgeschlagen ist

### Das Problem mit dem Auto-Clear useEffect:

```typescript
useEffect(() => {
    if (!gameState.animationState && isProcessingAction) {
        setIsProcessingAction(false);
    }
}, [gameState.animationState, isProcessingAction]);
```

**Ablauf (warum es nicht funktionierte)**:

1. **Tick 0**: `turn === 'opponent'`, `!animationState`, `!isProcessingAction`
2. **Hook 1 triggert**:
   - Condition check ✓
   - `setIsProcessingAction(true)` wird aufgerufen
3. **React batched den State-Update**
4. **Tick 1**: React applied State-Update → `isProcessingAction = true`
5. **Auto-Clear useEffect triggert** (weil `isProcessingAction` in dependencies!):
   - Condition: `!animationState && isProcessingAction` ✓
   - `setIsProcessingAction(false)` wird aufgerufen
6. **Tick 2**: `isProcessingAction = false` wieder
7. **Hook 1 re-evaluiert**: Condition `!isProcessingAction` ist **JETZT FALSE** (weil Lock gecleard wurde)
8. **setTimeout wird NICHT erstellt** → **SOFTLOCK**

**Root Cause**: Der Auto-Clear useEffect hat `isProcessingAction` in dependencies, triggert also SOFORT wenn der Lock gesetzt wird!

---

## Die RICHTIGE Lösung: Ref-basierter Lock

### Warum Ref statt State?

**State**:
- ❌ Triggert useEffect re-evaluation wenn geändert
- ❌ Async (React batcht updates)
- ❌ Kann zu Render-Loops führen

**Ref**:
- ✅ Synchron (sofortige Änderung)
- ✅ Triggert KEINE re-renders
- ✅ Kann in useEffect conditions geprüft werden OHNE dependency zu sein

### Die Implementierung:

```typescript
// Ref statt State!
const isProcessingAIRef = useRef<boolean>(false);

// Hook 1: AI Turn Processing
useEffect(() => {
    // SYNCHRON check: Ist bereits ein setTimeout aktiv?
    if (gameState.turn === 'opponent' &&
        !gameState.winner &&
        !gameState.animationState &&
        !isProcessingAIRef.current) {  // Ref-Check!

        isProcessingAIRef.current = true;  // SOFORT setzen (synchron!)

        const timer = setTimeout(() => {
            aiManager.runOpponentTurn(...);
            // Lock wird NICHT hier gecleard - siehe unten warum!
        }, 1500);

        return () => {
            clearTimeout(timer);
            isProcessingAIRef.current = false;  // Clear im cleanup
        };
    }
}, [gameState.turn, gameState.winner, gameState.animationState, difficulty, onEndGame, processAnimationQueue, gameState.actionRequired]);
// WICHTIG: isProcessingAIRef ist NICHT in dependencies!

// Hook 2: Opponent Action During Player Turn
useEffect(() => {
    const action = gameState.actionRequired;
    const isPlayerTurnOrInterrupt = gameState.turn === 'player' || gameState._interruptedTurn === 'player';
    const isOpponentActionDuringPlayerTurn =
        isPlayerTurnOrInterrupt &&
        !gameState.animationState &&
        !isProcessingAIRef.current &&  // Ref-Check!
        action && 'actor' in action && action.actor === 'opponent';

    if (isOpponentActionDuringPlayerTurn) {
        isProcessingAIRef.current = true;  // SOFORT setzen (synchron!)

        const timer = setTimeout(() => {
            aiManager.resolveRequiredOpponentAction(...);
            // Lock wird NICHT hier gecleard - siehe unten warum!
        }, 1500);

        return () => {
            clearTimeout(timer);
            isProcessingAIRef.current = false;  // Clear im cleanup
        };
    }
}, [gameState.actionRequired, gameState.turn, gameState.animationState, difficulty, processAnimationQueue, onEndGame]);
// WICHTIG: isProcessingAIRef ist NICHT in dependencies!
```

---

## Warum das funktioniert:

### 1. Synchronität
```typescript
isProcessingAIRef.current = true;  // Sofort wirksam, kein React-Batching
if (!isProcessingAIRef.current) {  // Check sieht SOFORT die Änderung
```

### 2. Keine Re-Render Loops
- Ref-Änderungen triggern KEINE re-renders
- Ref ist NICHT in dependencies → keine useEffect re-evaluation
- Cleanup wird NUR aufgerufen wenn dependencies sich ändern ODER component unmountet

### 3. Cleanup-Logik
```typescript
return () => {
    clearTimeout(timer);
    isProcessingAIRef.current = false;
};
```

**Wann wird cleanup aufgerufen?**
- Wenn eine dependency sich ändert → Hook wird neu evaluiert → cleanup läuft → Lock wird freed
- Wenn State-Update ein neues setTimeout starten soll → cleanup des alten läuft zuerst

**Beispiel-Ablauf (Gravity-2)**:

1. **Turn: opponent, Phase: action** → Hook 1 triggert
   - `isProcessingAIRef.current = true`
   - setTimeout(1500) für `runOpponentTurn` startet
2. **AI spielt Gravity-2** (nach 1500ms)
   - `animationState: { type: 'playCard' }`
   - State-Update triggert Hook 1 re-evaluation
3. **Hook 1 re-evaluiert**:
   - Condition: `animationState !== null` → **FALSE**
   - Cleanup läuft: `isProcessingAIRef.current = false`, clearTimeout
   - Neuer timer wird NICHT erstellt (condition failed)
4. **Animation endet** (nach 500ms)
   - `animationState: null`
   - `actionRequired: { type: 'discard', actor: 'opponent' }`
   - State-Update triggert Hook 1 re-evaluation
5. **Hook 1 re-evaluiert**:
   - Condition: `turn === 'opponent' && !animationState && !isProcessingAIRef.current` ✓
   - `isProcessingAIRef.current = true`
   - setTimeout(1500) für `runOpponentTurn` startet
6. **AI discarded Karte** (nach 1500ms)
   - `handleRequiredAction` wird aufgerufen
   - Discard wird processed
   - State-Update: `actionRequired: null`
7. **Hook 1 re-evaluiert**:
   - Cleanup läuft: `isProcessingAIRef.current = false`
   - Kein neuer timer (weil keine neue Action)

**Wichtig**: Der Lock verhindert dass Hook 2 parallel läuft, weil:
- Hook 2 checkt auch `!isProcessingAIRef.current`
- Wenn Hook 1 den Lock hat, kann Hook 2 nicht starten

---

## Alternative: Unterschiedliche Timeouts (Zusätzliche Sicherheit)

**Idee**: Selbst wenn beide Hooks triggern, starten sie zu unterschiedlichen Zeiten:

```typescript
// Hook 1: AI Turn Processing
setTimeout(() => {
    aiManager.runOpponentTurn(...);
}, 1500);  // Original

// Hook 2: Opponent Action During Player Turn
setTimeout(() => {
    aiManager.resolveRequiredOpponentAction(...);
}, 1400);  // 100ms früher!
```

**Warum das hilft**:
- Hook 2 (Interrupts) hat **Priorität** weil er früher startet
- Wenn beide gleichzeitig triggern:
  1. Hook 2 setTimeout completes nach 1400ms
  2. Hook 2 processed die Action
  3. State-Update mit `actionRequired: null`
  4. Hook 1 setTimeout würde nach 1500ms completen
  5. **ABER**: Hook 1 cleanup ist schon gelaufen (wegen State-Update)
  6. Hook 1's setTimeout findet `actionRequired: null` → macht normalen Turn weiter

**Problem mit dieser Lösung allein**:
- Funktioniert nur wenn State-Updates synchron sind
- Bei langsamen Devices könnte Hook 1 trotzdem zuerst laufen
- **Nicht deterministisch genug!**

**Kombination: Ref-Lock + Unterschiedliche Timeouts = Robusteste Lösung**

```typescript
// Hook 1: AI Turn (Lower priority, longer timeout)
useEffect(() => {
    if (gameState.turn === 'opponent' && !gameState.winner && !gameState.animationState && !isProcessingAIRef.current) {
        isProcessingAIRef.current = true;
        const timer = setTimeout(() => {
            aiManager.runOpponentTurn(...);
        }, 1500);  // Länger
        return () => {
            clearTimeout(timer);
            isProcessingAIRef.current = false;
        };
    }
}, [gameState.turn, gameState.winner, gameState.animationState, difficulty, onEndGame, processAnimationQueue, gameState.actionRequired]);

// Hook 2: Opponent Interrupt (Higher priority, shorter timeout)
useEffect(() => {
    const action = gameState.actionRequired;
    const isPlayerTurnOrInterrupt = gameState.turn === 'player' || gameState._interruptedTurn === 'player';
    const isOpponentActionDuringPlayerTurn =
        isPlayerTurnOrInterrupt &&
        !gameState.animationState &&
        !isProcessingAIRef.current &&
        action && 'actor' in action && action.actor === 'opponent';

    if (isOpponentActionDuringPlayerTurn) {
        isProcessingAIRef.current = true;
        const timer = setTimeout(() => {
            aiManager.resolveRequiredOpponentAction(...);
        }, 1400);  // Kürzer - hat Priorität!
        return () => {
            clearTimeout(timer);
            isProcessingAIRef.current = false;
        };
    }
}, [gameState.actionRequired, gameState.turn, gameState.animationState, difficulty, processAnimationQueue, onEndGame]);
```

---

## Zusammenfassung der Lösung

### 1. Ref-basierter Lock
- ✅ Synchron (keine React-Batching-Probleme)
- ✅ Keine Re-Render Loops
- ✅ Nicht in dependencies → keine ungewollte re-evaluation
- ✅ Cleanup automatisch bei State-Changes

### 2. Unterschiedliche Timeouts
- ✅ Hook 2 (Interrupts) hat Priorität (1400ms)
- ✅ Hook 1 (Normal Turn) läuft später (1500ms)
- ✅ Zusätzliche Sicherheit gegen Race Conditions

### 3. Cleanup-Mechanismus
- ✅ Lock wird automatisch freed bei State-Updates
- ✅ clearTimeout verhindert memory leaks
- ✅ Kein manueller "auto-clear" useEffect nötig!

---

## Warum das GARANTIERT funktioniert

### Fall 1: Normaler Opponent Turn (kein Interrupt)
- Hook 1 triggert, Lock gesetzt
- Hook 2 kann nicht triggern (Condition `turn !== 'player'`)
- ✅ Funktioniert wie vorher

### Fall 2: Opponent Action während Player Turn (echtes Interrupt)
- Hook 2 triggert, Lock gesetzt
- Hook 1 kann nicht triggern (Condition `turn !== 'opponent'`)
- ✅ Funktioniert wie vorher

### Fall 3: Gravity-2 Szenario (Race Condition)
- **Szenario**: `turn === 'opponent'`, dann `actionRequired: { actor: 'opponent' }` wird gesetzt

**Mit Ref-Lock**:
1. Hook 1 checkt `!isProcessingAIRef.current` → TRUE
2. Hook 1 setzt `isProcessingAIRef.current = true` (SOFORT, synchron!)
3. Hook 2 triggert (weil `actionRequired` in dependencies)
4. Hook 2 checkt `!isProcessingAIRef.current` → **FALSE** (weil Hook 1 Lock hat!)
5. Hook 2 startet NICHT
6. ✅ Nur Hook 1 läuft → Kein Race!

**ODER** (wenn Hook 2 schneller ist):
1. Hook 2 checkt `!isProcessingAIRef.current` → TRUE
2. Hook 2 setzt `isProcessingAIRef.current = true` (SOFORT!)
3. Hook 2 setTimeout(1400) startet
4. Hook 1 re-evaluiert (wegen `actionRequired` in dependencies)
5. Hook 1 checkt `!isProcessingAIRef.current` → **FALSE**
6. Hook 1 startet NICHT
7. ✅ Nur Hook 2 läuft → Kein Race!

**ODER** (beide zur exakt gleichen Zeit):
1. Beide checken `!isProcessingAIRef.current` → TRUE
2. Beide setzen `isProcessingAIRef.current = true`
3. Hook 2 setTimeout(1400) startet
4. Hook 1 setTimeout(1500) startet
5. **Nach 1400ms**: Hook 2 completes, Action resolved, State-Update
6. **State-Update triggert Hook 1 re-evaluation**
7. **Hook 1 cleanup läuft**: clearTimeout des 1500ms timers, Lock freed
8. **Hook 1 re-evaluiert**: Condition fails (kein `actionRequired` mehr)
9. ✅ Kein doppelter Turn!

---

## Implementierungs-Checkliste

1. ✅ Import `useRef` in useGameState.ts
2. ✅ Create `const isProcessingAIRef = useRef<boolean>(false);`
3. ✅ Hook 1: Add `!isProcessingAIRef.current` zu condition
4. ✅ Hook 1: Set `isProcessingAIRef.current = true` am Anfang
5. ✅ Hook 1: Clear `isProcessingAIRef.current = false` im cleanup
6. ✅ Hook 2: Add `!isProcessingAIRef.current` zu condition
7. ✅ Hook 2: Set `isProcessingAIRef.current = true` am Anfang
8. ✅ Hook 2: Clear `isProcessingAIRef.current = false` im cleanup
9. ✅ Hook 2: Change timeout von 1500 → 1400 (Priorität!)
10. ✅ Test Gravity-2 Szenario 10x → Sollte deterministisch sein!
11. ✅ Test alle anderen Szenarien
12. ✅ Test normales Gameplay
