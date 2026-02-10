# Animation System - Offene Tasks

## Status: Debug-Phase

Console.logs wurden hinzugefügt. Bitte teste und gib mir die Console-Ausgabe!

---

## KRITISCHER BUG: Delete Animation - Karte kommt zurück

### Debug-Logs zu erwarten:
```
[DELETE DEBUG 1] Card ID to delete: <card-id>
[DELETE DEBUG 2] Card exists before delete: true
[DELETE DEBUG 3] Card exists after delete: false   <- Sollte false sein!
[DELETE DEBUG 4] Card exists in s before callback: false  <- Sollte false sein!
[DELETE DEBUG 5] Card exists in result after callback: false  <- Sollte false sein!
```

### Interpretation:
- **DEBUG 3 = true**: Die Karte wird nicht in `processAnimationQueue` gelöscht
- **DEBUG 4 = true** (aber DEBUG 3 = false): Der State wird zwischen processAnimationQueue und onComplete überschrieben
- **DEBUG 5 = true** (aber DEBUG 4 = false): Der `onCompleteCallback` fügt die Karte wieder ein

---

## BUG 2: Compile Animation fehlt

### Debug-Logs zu erwarten:
```
[COMPILE DEBUG] compileAnimationData: [{...}, {...}]  <- Sollte Array mit Karten sein!
[COMPILE DEBUG] enqueueAnimations defined: true
[COMPILE DEBUG] Creating delete animations for X cards
[COMPILE DEBUG] Created animations: X
```

### Interpretation:
- **compileAnimationData = undefined**: `_compileAnimations` wird nie gesetzt (Bug in miscResolver.ts)
- **enqueueAnimations = false**: Animation-Queue nicht verfügbar
- **Created animations: 0**: Animation-Erstellung fehlerhaft

---

## Noch zu tun:

1. [ ] Delete Bug basierend auf Logs fixen
2. [ ] Compile Animation basierend auf Logs fixen
3. [ ] Altes Animationssystem komplett entfernen (USE_NEW_ANIMATION_SYSTEM)
4. [ ] Fire-4 "Discard then Draw" Animation testen/fixen
5. [ ] Debug-Logs wieder entfernen

---

## Dateien mit Debug-Logs:

- `hooks/useGameState.ts` Zeile 142-178 (DELETE DEBUG 1-3)
- `hooks/useGameState.ts` Zeile 857-871 (DELETE DEBUG 4-5)
- `hooks/useGameState.ts` Zeile 788-794 (COMPILE DEBUG)

---

## Referenz: Animation System Architektur

```
User Action → Resolver (cardResolver.ts)
           ↓
    animationRequests + onCompleteCallback
           ↓
    processAnimationQueue (useGameState.ts)
           ↓
    1. Snapshot erstellen
    2. Animation enqueuen
    3. State SOFORT ändern
    4. setTimeout(onComplete, DURATION)
           ↓
    onCompleteCallback
           ↓
    Reaktive Effekte, Uncover, etc.
```
