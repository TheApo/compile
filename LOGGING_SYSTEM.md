# Logging System - Compile Game

## Überblick

Das Logging-System ist **hierarchisch** und **kontextbasiert**. Es unterstützt:
- **Verschachtelte Effekte** (Indentation/Einrückung)
- **Source-Tracking** (welche Karte hat den Effekt ausgelöst)
- **Phase-Tracking** (Middle, Start, End, Uncover)
- **Actor-spezifische Logs** (Player vs Opponent)

---

## Kern-Konzepte

### 1. Log Indent Level (`_logIndentLevel`)

**Zweck:** Zeigt Effekt-Verschachtelung an

```
Player plays Anarchy-0 into Protocol Hate.
  [Middle] Anarchy-0: Player shifts Player's Gravity-6 to Protocol Anarchy.
  [Uncover] Anarchy-1 is uncovered and its effects are re-triggered.
    [Middle] Anarchy-1: Player shifts Player's Anarchy-0 to Protocol Gravity.
      [Uncover] Hate-2 is uncovered and its effects are re-triggered.
        [Middle] Hate-2: Player deletes their highest value uncovered card.
```

**Funktionen:**
- `increaseLogIndent(state)` - Erhöht Level um 1
- `decreaseLogIndent(state)` - Verringert Level um 1
- `log(state, actor, message)` - Loggt mit aktuellem Indent

**Wichtig:**
- **Erhöhen** wenn Effekt startet (z.B. bei `executeOnPlayEffect`, `handleUncoverEffect`)
- **Verringern** wenn Effekt endet (nach allen Follow-up-Aktionen!)

---

### 2. Log Source (`_logSource`)

**Zweck:** Zeigt welche Karte den aktuellen Effekt ausgelöst hat

**Format:** `"Anarchy-0"`, `"Hate-2"`, etc.

**Setzen:**
```typescript
newState = setLogSource(newState, 'Anarchy-0');
newState = setLogPhase(newState, 'middle');
```

**Löschen:**
```typescript
newState = setLogSource(newState, undefined);
newState = setLogPhase(newState, undefined);
```

**Wichtig bei Queued Actions:**
- Wenn eine Action aus der Queue ausgeführt wird, muss der Source-Context **neu gesetzt** werden
- Beispiel: Hate-2's zweiter Delete nach einem Interrupt

---

### 3. Log Phase (`_logPhase`)

**Zweck:** Zeigt in welcher Phase der Effekt ausgeführt wird

**Werte:**
- `'middle'` - Middle Command (on-play Effekt)
- `'start'` - Start-Phase Effekt
- `'end'` - End-Phase Effekt
- `'uncover'` - Uncover-Effekt (wenn Karte aufgedeckt wird)

**Format im Log:**
```
[Middle] Anarchy-0: Player shifts...
[Start] Chaos-0: Start Effect...
[End] Fire-3: End Effect...
[Uncover] Hate-0 is uncovered...
```

---

## Kritische Regeln

### Regel 1: Indent Management bei Interrupts

**Problem:** Wenn ein Effekt einen Turn-Interrupt auslöst, muss das Indent-Level richtig gehandhabt werden.

**Beispiel:**
```
Anarchy-0 shiftet → uncovered Apathy-4 (Opponent's Karte)
→ Apathy-4 erstellt Turn-Interrupt (Opponent muss wählen)
→ Anarchy-0's conditional draw wird in queuedActions gesteckt
```

**FALSCH:**
```typescript
// Decrease indent SOFORT beim Interrupt
if (uncoverCreatedInterrupt) {
    // Queue follow-up actions
    newState = decreaseLogIndent(newState); // ❌ ZU FRÜH!
}
```

**RICHTIG:**
```typescript
// Decrease indent NUR wenn der Effekt KOMPLETT fertig ist
if (uncoverCreatedInterrupt) {
    // Queue follow-up actions
    // NOTE: Do NOT decrease log indent here - the original effect is not complete yet
    // The indent will be decreased when the queued action executes
}
```

---

### Regel 2: Context Clearing bei Queued Actions

**Problem:** Queued Actions haben oft noch den alten Log-Context aktiv.

**Lösung:** Context explizit neu setzen:

```typescript
case 'select_opponent_highest_card_to_delete_for_hate_2': {
    // CRITICAL: Set log context to Hate-2 to ensure correct source in logs
    newState = setLogSource(newState, 'Hate-2');
    newState = setLogPhase(newState, 'middle');

    newState = log(newState, actor, `Player deletes...`);
    // ...
}
```

---

### Regel 3: Information Hiding

**Gegnerische Aktionen dürfen keine versteckten Informationen leaken!**

**FALSCH:**
```typescript
// ❌ Zeigt welche Karte der Opponent gezogen hat!
log(state, opponent, `Opponent drew ${card.protocol}-${card.value} from...`);
```

**RICHTIG:**
```typescript
// ✅ Zeigt nur, DASS der Opponent gezogen hat
log(state, opponent, `Opponent drew 1 card from...`);
```

**Wann leaken?**
- ❌ Gegner zieht Karte
- ❌ Gegner discardet Karte (außer es wird gespielt/revealed)
- ✅ Eigene gezogene Karten (du siehst sie in deiner Hand)
- ✅ Gespielte/aufgedeckte Karten (public information)

---

### Regel 4: Indent Clearing bei Phase-Übergängen

**Wichtig:** Bei Phase-Übergängen (`hand_limit`, `end`, Turn-Wechsel) muss das Indent-Level zurückgesetzt werden:

```typescript
case 'action':
    nextState = setLogSource(nextState, undefined);
    nextState = setLogPhase(nextState, undefined);
    nextState = { ...nextState, _logIndentLevel: 0 }; // ✅ RESET!
    return { ...nextState, phase: 'hand_limit' };
```

---

## Typische Fehler & Lösungen

### Fehler 1: "Anarchy-1: Hate-2: Player deletes..."

**Problem:** Alter Source-Context noch aktiv

**Ursache:** Queued Action hat keinen neuen Context gesetzt

**Lösung:**
```typescript
newState = setLogSource(newState, 'Hate-2');
newState = setLogPhase(newState, 'middle');
```

---

### Fehler 2: Softlock nach Shift

**Problem:** `actionRequired = null` aber `queuedActions` nicht verarbeitet

**Ursache:** Nach Shift werden queued actions nicht automatisch als `actionRequired` gesetzt

**Lösung:**
```typescript
newState.actionRequired = null;

// Process queued actions
if (newState.queuedActions && newState.queuedActions.length > 0) {
    const nextAction = newState.queuedActions[0];
    newState.queuedActions = newState.queuedActions.slice(1);
    newState.actionRequired = nextAction;
}
```

---

### Fehler 3: Indent bleibt erhöht

**Problem:** Nach Effekt wird `decreaseLogIndent` vergessen

**Ursache:** Bei Interrupts oder frühem Return

**Lösung:** Immer symmetrisch:
```typescript
// Effekt startet
newState = increaseLogIndent(newState);

// ... Effect Logic ...

// Effekt endet (ALLE Pfade!)
newState = decreaseLogIndent(newState);
```

---

## Best Practices

1. **Immer Context setzen bei Effekt-Start:**
   ```typescript
   newState = setLogSource(newState, `${card.protocol}-${card.value}`);
   newState = setLogPhase(newState, 'middle');
   ```

2. **Immer Context löschen bei Effekt-Ende:**
   ```typescript
   newState = setLogSource(newState, undefined);
   newState = setLogPhase(newState, undefined);
   ```

3. **Indent symmetrisch:**
   ```typescript
   // Start
   newState = increaseLogIndent(newState);

   // Ende (NUR wenn keine queued actions!)
   if (!newState.actionRequired) {
       newState = decreaseLogIndent(newState);
   }
   ```

4. **Information Hiding:**
   - Eigene Aktionen: Zeige Details
   - Gegner-Aktionen: Zeige nur Anzahl/Typ

---

## Debugging-Tipps

### Log-Level überprüfen:
```typescript
console.log('Current indent level:', state._logIndentLevel);
```

### Context überprüfen:
```typescript
console.log('Log source:', state._logSource);
console.log('Log phase:', state._logPhase);
```

### Queued Actions überprüfen:
```typescript
console.log('Queued actions:', state.queuedActions?.length || 0);
console.log('Action required:', state.actionRequired?.type);
```

---

## Wichtige Dateien

- `logic/utils/log.ts` - Logging-Funktionen
- `logic/game/helpers/actionUtils.ts` - `handleUncoverEffect` (setzt Context)
- `logic/game/phaseManager.ts` - Phase-Übergänge (cleared Context)
- `logic/game/resolvers/laneResolver.ts` - Shift-Handling (queued actions)
- `logic/game/resolvers/cardResolver.ts` - Card-Action-Handling (Context-Management)
