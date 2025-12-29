# Animation-Queue-System Redesign für COMPILE Card Game

## STATUS: Phase E weitgehend komplett - Return & Reveal implementiert

**Letzte Aktualisierung**: 2025-12-29 (Session 4)

---

# AKTUELLER STAND DER ANIMATIONEN

## Funktioniert WIRKLICH (aufgerufen und integriert):

| Animation | Helper existiert | Aufgerufen in | Status |
|-----------|------------------|---------------|--------|
| **Play** | `createPlayAnimation` | useGameState.ts, aiManager.ts | ✅ Funktioniert |
| **Delete** | `createDeleteAnimation` | useGameState.ts (2x) | ✅ Funktioniert |
| **Shift** | `createShiftAnimation` | useGameState.ts (3x), aiManager.ts | ✅ Funktioniert |
| **Draw** | `createDrawAnimation`, `createSequentialDrawAnimations` | aiManager.ts | ✅ Funktioniert |
| **Discard** | `createDiscardAnimation`, `createSequentialDiscardAnimations` | aiManager.ts (import) | ⚠️ Teilweise |

## NEU IMPLEMENTIERT (Session 4):

| Animation | Status | Implementierung |
|-----------|--------|-----------------|
| **Return** | ✅ Funktioniert | `resolveActionWithCard` (select_card_to_return, select_opponent_card_to_return) + `resolveActionWithLane` (select_lane_for_return) |
| **Reveal** | ✅ Funktioniert | `resolveActionWithHandCard` (select_card_from_hand_to_reveal) - "flip and stay" |

## FEHLT (für Phase F):

| Animation | Helper existiert | Problem |
|-----------|------------------|---------|
| **Flip** | `createFlipAnimation` | ❌ **NICHT AUFGERUFEN** - nirgends integriert! |
| **Compile** | `createCompileAnimation` | ❌ Nicht integriert |
| **Give** | `createGiveAnimation` | ❌ Nicht integriert |
| **Swap** | `createSwapAnimation` | ❌ Nicht integriert |

---

# KRITISCHES PROBLEM: ASYNC CALLBACKS

## Das Problem

Der AI Manager (`aiManager.ts`) verwendet überall `setTimeout` und `processAnimationQueue` Callbacks. Diese async Callbacks verursachen Race Conditions:

1. AI spielt Karte → Flag `_cardPlayedThisActionPhase` wird gesetzt
2. Effekte werden ausgeführt (delete, etc.)
3. Turn wechselt korrekt zu Player
4. **ABER**: Ein alter async Callback läuft später und ruft `processEndOfAction` auf
5. Das wechselt den Turn NOCHMAL → AI spielt eine zweite Karte (BUG!)

## Betroffene Stellen in aiManager.ts

Alle `processAnimationQueue` Callbacks und `setTimeout` Aufrufe:
- Zeile 569-654: flipCard/deleteCard/returnCard/shiftCard callbacks
- Zeile 895-949: playCard NEW path callbacks
- Zeile 1169-1222: playCard standard path callbacks
- Zeile 1228-1256: onAllAnimsComplete callback
- Zeile 1261-1286: no-anim else branch

**Quick-Fix angewendet**: Turn-Checks (`if (s.turn !== 'opponent') return s`) in allen Callbacks hinzugefügt.

## Die RICHTIGE Lösung (Phase F)

Async komplett rauswerfen:
1. Game Logic läuft **synchron** - State wird sofort berechnet
2. Animation Queue ist **separat** - nur für visuelle Darstellung
3. Kein Callback, kein setTimeout, keine Race Conditions

**Voraussetzung**: Alle Animationen müssen im neuen Format funktionieren!

---

# NÄCHSTE SCHRITTE

## Priorität 1: Fehlende Animationen implementieren

### 1.1 Flip-Animation integrieren

**Wo wird geflippt?**
- `logic/game/helpers/actionUtils.ts` → `internalFlipCard()`
- `logic/effects/actions/flipExecutor.ts`
- Verschiedene Resolver

**Aufgabe:**
1. `createFlipAnimation()` an allen Flip-Stellen aufrufen
2. Animation ist in-place (Karte dreht sich an Ort und Stelle)
3. CSS `@keyframes card-flip-rotate` existiert bereits

### 1.2 Return-Animation fixen

**Problem:** Water-4 Return ist sofort ohne Animation.

**Wo wird returned?**
- Suche nach `returnCard` Aufrufen
- `logic/effects/actions/returnExecutor.ts`

**Aufgabe:**
1. Alle Return-Stellen finden
2. `createReturnAnimation()` korrekt aufrufen
3. setTimeout-Pattern durch neues System ersetzen

### 1.3 Give-Animation integrieren

**Wo wird gegeben?**
- Suche nach Karten die zur Gegner-Hand gehen

### 1.4 Compile-Animation integrieren

**Wo wird compiled?**
- `compileLane` in useGameState.ts

## Priorität 2: Async rauswerfen (Phase F)

Erst wenn ALLE Animationen im neuen System funktionieren:
1. Alle `setTimeout` in aiManager.ts entfernen
2. Alle `processAnimationQueue` Callbacks durch synchronen Code ersetzen
3. `animationState` aus GameState entfernen (altes System)

---

# ARCHITEKTUR-ÜBERSICHT

## Neues Animation-System (gewünscht)

```
User/AI führt Aktion aus
    │
    ▼
Animation-Snapshot VOR State-Änderung erstellen
    │
    ▼
Animation zur Queue hinzufügen (queueMicrotask)
    │
    ▼
Game-State SOFORT aktualisieren (synchron!)
    │
    ▼
AnimationOverlay zeigt:
  - SnapshotRenderer (Board VOR der Änderung)
  - AnimatedCard (Karte fliegt)
    │
    ▼
Nach Animation: nächste Animation ODER echten State zeigen
```

**KEIN Callback, KEIN setTimeout!**

## Wichtige Dateien

| Datei | Funktion |
|-------|----------|
| `logic/animation/animationHelpers.ts` | Factory-Funktionen für Animationen |
| `contexts/AnimationQueueContext.tsx` | React Context für Animation-Queue |
| `components/AnimatedCard.tsx` | Die fliegende Karte (CSS-Animationen) |
| `components/AnimationOverlay.tsx` | Overlay während Animation |
| `hooks/useGameState.ts` | Integriert Animationen in Game-Logik |
| `logic/game/aiManager.ts` | AI Turn Processing (ASYNC PROBLEM!) |
| `constants/animationTiming.ts` | ANIMATION_DURATIONS |

---

# BEKANNTE BUGS

## 1. AI Double-Play Bug (KRITISCH)

**Symptom**: AI spielt manchmal zwei Karten pro Turn
**Ursache**: Async callbacks in aiManager.ts
**Quick-Fix**: Turn-Checks hinzugefügt
**Echte Lösung**: Async komplett rauswerfen (Phase F)

## 2. Return-Animation fehlt

**Symptom**: Water-4 Return ist sofort (keine Animation)
**Ursache**: `createReturnAnimation` wird nur an 1 Stelle aufgerufen, mit setTimeout-Problem
**Lösung**: Return-Animation an allen relevanten Stellen integrieren

## 3. Flip-Animation fehlt

**Symptom**: Karten flippen sofort ohne Animation
**Ursache**: `createFlipAnimation` wird NIRGENDS aufgerufen
**Lösung**: Flip-Animation integrieren

---

# CHECKLISTE FÜR NÄCHSTE SESSION

- [x] Return-Animation: Implementiert in resolveActionWithCard und resolveActionWithLane
- [x] Reveal-Animation: Implementiert in resolveActionWithHandCard ("flip and stay")
- [ ] Flip-Animation: Finde alle Flip-Stellen, integriere `createFlipAnimation`
- [ ] Give-Animation: Finde alle Give-Stellen, integriere `createGiveAnimation`
- [ ] Compile-Animation: Integriere `createCompileAnimation` in compileLane
- [ ] Swap-Animation: Integriere `createSwapAnimation`
- [ ] Teste alle Animationen einzeln
- [ ] Dann: Phase F - Async rauswerfen

---

# HISTORIE

## Session 4 (2025-12-29)
- Return-Animation implementiert:
  - `resolveActionWithCard` für `select_card_to_return` und `select_opponent_card_to_return`
  - `resolveActionWithLane` für `select_lane_for_return` (alle Karten in Lane)
- Reveal-Animation implementiert:
  - `resolveActionWithHandCard` für `select_card_from_hand_to_reveal`
  - "Flip and stay" - Karte flippt face-up und bleibt revealed
- Bestehende TypeScript-Bugs in playSelectedCard gefixt (createShiftAnimation/createDeleteAnimation Argumente)
- **Play-from-Deck Animationen** hinzugefügt:
  - `playExecutor.ts`: Alle automatischen Play-Blöcke geben jetzt `animationRequests` zurück
    - `each_other_line` (Water-1)
    - `each_line_with_card` (Life-0, Smoke-0)
    - `under_this_card` (Gravity-0)
    - `specific_lane` (Gravity-6, Assimilation)
  - `useGameState.ts`: Handling für 'play' Requests in `playSelectedCard`
  - `aiManager.ts`: Neue Helper `enqueueAnimationsFromRequests()` konvertiert animationRequests in echte Animationen
  - `AnimationRequest` Type erweitert mit `toLane`, `fromDeck`, `isFaceUp` Feldern

## Session 3 (2025-12-29)
- AI Double-Play Bug analysiert
- Root Cause: Async callbacks in aiManager.ts
- Quick-Fix: Turn-Checks in allen Callbacks
- Plan aktualisiert mit echtem Status der Animationen

## Session 2 (2025-12-29)
- Draw-Animation mit dynamischem Timing (700ms GESAMT)
- Opponent Draw/Shift Animationen
- Trash-Rotation während Flug
- Protocol-Bars Zentrierung fix

## Session 1 (2025-12-29)
- Delete-Animation Bugfix
- Shift-Animation implementiert
- Draw-Animation implementiert
- DeckTrashArea Positionierung
