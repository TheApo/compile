# Animation-Queue-System Redesign für COMPILE Card Game

## STATUS: Phase D.3 ABGESCHLOSSEN - Bereit für Phase E

**Letzte Aktualisierung**: 2025-12-29 (Session beendet)

---

# SUPER AUSFÜHRLICHE ANLEITUNG FÜR DIE NÄCHSTE SESSION

## 1. WAS WURDE HEUTE (2025-12-29) ERLEDIGT?

### 1.1 Delete-Animation Bugfix - KARTE NICHT MEHR DOPPELT SICHTBAR
**Problem**: Beim Löschen einer Karte blieb sie auf dem Spielfeld sichtbar, während gleichzeitig eine fliegende Animation zum Trash lief. Dadurch war die Karte doppelt zu sehen.

**Ursache gefunden**: `animatingCardId` wurde NICHT an die Lane-Komponente weitergegeben!
- GameScreen berechnet `animatingCardId` ✓
- GameBoard erhält `animatingCardId` ✓
- GameBoard nutzt es für Hand-Karten ✓
- GameBoard gab es an Lane **NICHT weiter** ✗

**Lösung implementiert**:
1. `components/Lane.tsx` (Zeile 28): Neues Prop `animatingCardId?: string | null` hinzugefügt
2. `components/GameBoard.tsx` (Zeilen 454 und 516): `animatingCardId={animatingCardId}` an beide Lane-Aufrufe weitergegeben
3. `components/Lane.tsx` (Zeile 62, 81): `const isBeingAnimated = animatingCardId === card.id;` + CSS-Klasse `animating-hidden`
4. CSS: `.animating-hidden { visibility: hidden !important; }` versteckt die Karte

### 1.2 Shift-Animation implementiert
**Wo**: `hooks/useGameState.ts` in `resolveActionWithLane()` Funktion (Zeilen 478-518)

**Logik**:
```typescript
if (USE_NEW_ANIMATION_SYSTEM && enqueueAnimation && prev.actionRequired?.type === 'select_lane_for_shift') {
    const { cardToShiftId, cardOwner, originalLaneIndex } = prev.actionRequired;
    if (originalLaneIndex !== targetLaneIndex) {
        const cardToShift = prev[cardOwner].lanes.flat().find(c => c.id === cardToShiftId);
        const cardIndex = prev[cardOwner].lanes[originalLaneIndex].findIndex(c => c.id === cardToShiftId);
        if (cardToShift && cardIndex >= 0) {
            const animation = createShiftAnimation(prev, cardToShift, cardOwner, originalLaneIndex, cardIndex, targetLaneIndex);
            queueMicrotask(() => enqueueAnimation(animation));
        }
    }
}
```

### 1.3 Draw-Animation implementiert
**Wo**: `hooks/useGameState.ts` in `fillHand()` Funktion (Zeilen 350-376)

**Logik**:
```typescript
const fillHand = () => {
    setGameState(prev => {
        // VORHER: Hand-IDs speichern
        const prevHandIds = new Set(prev.player.hand.map(c => c.id));

        // Resolver aufrufen
        const newState = resolvers.fillHand(prev, 'player');

        // NACHHER: Neue Karten finden und animieren
        if (USE_NEW_ANIMATION_SYSTEM && enqueueAnimation) {
            const newCards = newState.player.hand.filter(c => !prevHandIds.has(c.id));
            newCards.forEach((card, index) => {
                const animation = createDrawAnimation(prev, card, 'player', prev.player.hand.length + index);
                queueMicrotask(() => enqueueAnimation(animation));
            });
        }
        return newState;
    });
};
```

### 1.4 DeckTrashArea Positionierung korrigiert
**Problem**: DeckTrashArea überdeckte die Protokoll-Namen und war zu klein/rechtsbündig.

**Lösung**:
1. DeckTrashArea bleibt LINKS positioniert (`left: 8px`)
2. `game-main-area` bekommt `padding-left: 180px` um Platz für DeckTrashArea zu machen
3. Volle Kartengröße (100x140px) beibehalten
4. `pointer-events: none` auf Container, `pointer-events: auto` auf deck-pile/trash-pile (damit Lanes nicht blockiert werden)
5. Responsive Breakpoints:
   - `≤1200px`: Kleinere DeckTrashArea (70x98px), padding-left: 130px
   - `≤1000px`: Noch kleiner (50x70px), padding-left: 100px
   - `≤850px`: DeckTrashArea versteckt, padding-left: 0

### 1.5 Kritischer Bugfix: Spielfeld-Klicks funktionieren wieder
**Problem**: Nach dem Hinzufügen von padding-left konnte man nicht mehr auf die Lanes klicken.

**Ursache**: Der DeckTrashArea-Container hatte `z-index: 50` und blockierte Klicks auf das dahinterliegende Game-Board, obwohl er visuell nicht überlappt.

**Lösung** in `styles/layouts/game-screen.css`:
```css
.deck-trash-area {
    pointer-events: none; /* Container blockiert keine Klicks */
}

.deck-pile, .trash-pile {
    pointer-events: auto; /* Aber die Piles selbst sind klickbar */
}
```

---

## 2. AKTUELLE ARCHITEKTUR

### 2.1 Animations-System (NEUES System)

```
┌─────────────────────────────────────────────────────────────────────┐
│                      AnimationQueueContext                          │
│  - animationQueue: AnimationQueueItem[]                             │
│  - enqueueAnimation(item): void                                     │
│  - enqueueAnimations(items): void                                   │
│  - onAnimationComplete(): void                                      │
│  - currentAnimation: AnimationQueueItem | null                      │
│  - isAnimating: boolean                                             │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        AnimationOverlay                             │
│  - Blockt User-Input während Animation                              │
│  - Rendert KEINE SnapshotRenderer mehr (GameScreen macht das)       │
│  - Rendert AnimatedCard (fliegende Karte)                           │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          AnimatedCard                               │
│  - CSS-Transitions für Animation                                    │
│  - Phasen: HIGHLIGHT (400ms) → FLY (400ms)                          │
│  - getBoundingClientRect() für DOM-Positionen                       │
│  - Opponent-Rotation (180°) berücksichtigt                          │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Animation-Flow

```
1. User/AI führt Aktion aus (z.B. Karte spielen)
   │
   ▼
2. Animation-Snapshot VOR State-Änderung erstellen
   │  const animation = createPlayAnimation(state, card, owner, laneIndex);
   │
   ▼
3. Animation zur Queue hinzufügen (via queueMicrotask)
   │  queueMicrotask(() => enqueueAnimation(animation));
   │
   ▼
4. Game-State sofort aktualisieren (Logik läuft synchron)
   │  return newStateAfterAction;
   │
   ▼
5. AnimationOverlay zeigt:
   │  - GameScreen rendert SnapshotRenderer (Board VOR der Änderung)
   │  - AnimatedCard (Karte fliegt von A nach B)
   │
   ▼
6. Nach Animation: onAnimationComplete()
   │  - Nächste Animation aus Queue ODER
   │  - isAnimating = false (zeigt echten GameState)
```

### 2.3 Wichtige Dateien

| Datei | Funktion |
|-------|----------|
| `types/animation.ts` | TypeScript-Definitionen für Animationen |
| `contexts/AnimationQueueContext.tsx` | React Context für Animation-Queue |
| `components/AnimationOverlay.tsx` | Overlay während Animation |
| `components/SnapshotRenderer.tsx` | Statisches Board-Rendering |
| `components/AnimatedCard.tsx` | Die fliegende Karte (CSS-Animationen) |
| `components/DeckTrashArea.tsx` | Deck/Trash Anzeige links |
| `logic/animation/animationHelpers.ts` | Factory-Funktionen für Animationen |
| `utils/snapshotUtils.ts` | createVisualSnapshot(), snapshotToGameState() |
| `constants/animationTiming.ts` | ANIMATION_DURATIONS |
| `hooks/useGameState.ts` | Integriert Animationen in Game-Logik |
| `screens/GameScreen.tsx` | AnimationQueueProvider + AnimationOverlay |
| `styles/layouts/game-screen.css` | DeckTrashArea + Responsive Styles |
| `styles/animations.css` | @keyframes, animating-hidden |

---

## 3. WAS FUNKTIONIERT BEREITS?

### 3.1 Animationen (NEUES System)
- [x] **Play-Animation** (Player & AI): Karte fliegt von Hand zu Lane
- [x] **Delete-Animation**: Karte fliegt von Lane zu Trash
- [x] **Discard-Animation**: Karte fliegt von Hand zu Trash
- [x] **Draw-Animation**: Karte fliegt von Deck zu Hand
- [x] **Shift-Animation**: Karte fliegt von Lane zu Lane
- [x] **Highlight-Phase für AI**: 400ms mit rotem Glow bevor Animation startet
- [x] **Source-Card versteckt**: Karte während Animation via CSS unsichtbar

### 3.2 UI/Layout
- [x] **DeckTrashArea**: Deck und Trash auf linker Seite angezeigt
- [x] **Responsive Design**: DeckTrashArea skaliert mit Bildschirmgröße
- [x] **Lanes klickbar**: pointer-events korrekt konfiguriert
- [x] **Protocol-Namen sichtbar**: DeckTrashArea überdeckt nichts mehr

---

## 4. WAS FEHLT NOCH? (TODO für nächste Sessions)

### Phase E: Flip + Return Animationen

#### E.1 Flip-Animation
- **Problem**: Flip passiert an vielen Stellen im Code
- **Lösung**: Zentrale Stelle finden wo Karten geflippt werden
- **Dateien zu prüfen**:
  - `logic/game/helpers/actionUtils.ts` - `internalFlipCard()`
  - `logic/effects/actions/flipExecutor.ts`
  - Verschiedene Resolver-Dateien
- **Animation**: Karte dreht sich an Ort und Stelle (in-place rotation)
- **Timing**: 300ms
- **CSS**: `@keyframes card-flip-rotate` existiert bereits in animations.css

#### E.2 Return-Animation
- **Problem**: Karte wird von Lane zurück zur Hand genommen
- **Lösung**: `createReturnAnimation()` nutzen
- **Dateien zu prüfen**:
  - `logic/game/helpers/actionUtils.ts` - suche nach "return" oder "hand"
- **Animation**: Karte fliegt von Lane zu Hand
- **Timing**: 400ms

### Phase F: Altes Animation-System entfernen

Das alte System (`gameState.animationState`) läuft noch parallel:
- Setzt `animationState: { type: 'deleteCard', cardId, owner }`
- Nutzt setTimeout für Timing
- Wurde in vielen Stellen im Code benutzt

**Aufgabe**:
1. Alle Stellen finden wo `animationState` gesetzt wird
2. Prüfen ob neue Animation dort bereits existiert
3. Alte Logik entfernen
4. `animationState` aus GameState-Type entfernen

### Phase G: Compile-Animation (Komplex)

Wenn ein Protokoll "compiled" wird, fliegen alle Karten einer Lane gestaffelt zum Trash:
- Mehrere Karten nacheinander (STAGGER_DELAY = 75ms)
- Alle in dieselbe Richtung (Lane → Trash)
- Danach: Punkte-Animation anzeigen
- **CSS**: `@keyframes card-compile-glow` existiert bereits

### Phase H: Shuffle-Animation

Wenn Deck leer und Trash nicht leer:
- Trash-Karten fliegen zum Deck
- Karten werden gemischt (visuelle Animation)

---

## 5. BEKANNTE BUGS

### 5.1 AI Manager Async-Bug
- **Symptom**: AI spielt manchmal eine extra Karte während Effect-Chain läuft
- **Ursache**: Race Conditions mit setTimeout in `aiManager.ts`
- **Versuchter Fix**: `queuedActions` Check war nicht ausreichend
- **Lösung**: Alle setTimeout in aiManager.ts analysieren, Promises statt Callbacks nutzen
- **Datei**: `logic/game/aiManager.ts`

### 5.2 Animation-Timing bei schnellen Aktionen
- **Symptom**: Bei sehr schnellen Aktionen kann Animation "springen"
- **Ursache**: DOM-Position wird berechnet bevor Element gerendert ist
- **Workaround**: `requestAnimationFrame` doppelt nutzen

---

## 6. DOM-SELEKTOREN FÜR ANIMATIONEN

Diese Selektoren werden in `AnimatedCard.tsx` → `getDOMPosition()` verwendet:

```typescript
// Player Hand-Karten
`.player-hand-area .card-component[data-card-id="${cardId}"]`

// Opponent Hand-Karten
`.opponent-hand-area .card-component[data-card-id="${cardId}"]`

// Player Lane-Karten
`.player-side:not(.opponent-side) .lanes .lane:nth-child(${laneIndex + 1}) .lane-stack .card-component[data-card-id="${cardId}"]`

// Opponent Lane-Karten (innerhalb rotiertem Container)
`.opponent-side .lanes .lane:nth-child(${laneIndex + 1}) .lane-stack .card-component[data-card-id="${cardId}"]`

// Player Deck
`.deck-pile.player .pile-card-wrapper`

// Player Trash
`.trash-pile.player .pile-card-wrapper`

// Opponent Deck
`.deck-pile.opponent .pile-card-wrapper`

// Opponent Trash
`.trash-pile.opponent .pile-card-wrapper`
```

---

## 7. CODE-SNIPPETS ZUM NACHLESEN

### 7.1 Animation erstellen und einfügen
```typescript
// In useGameState.ts
if (USE_NEW_ANIMATION_SYSTEM && enqueueAnimation) {
    const animation = createPlayAnimation(
        state,
        card,
        owner,
        laneIndex,
        isOpponentAction ? 'facedown' : 'faceup'
    );
    queueMicrotask(() => enqueueAnimation(animation));
}
```

### 7.2 Karte während Animation verstecken
```typescript
// In Lane.tsx
const isBeingAnimated = animatingCardId === card.id;
<CardComponent
    // ...
    additionalClassName={isBeingAnimated ? 'animating-hidden' : undefined}
/>
```

### 7.3 CSS für versteckte Karte
```css
/* In animations.css */
.animating-hidden {
    visibility: hidden !important;
    pointer-events: none !important;
}
```

### 7.4 DeckTrashArea Click-Blocking verhindern
```css
/* Container blockiert keine Klicks */
.deck-trash-area {
    pointer-events: none;
}

/* Aber die Piles selbst sind klickbar */
.deck-pile, .trash-pile {
    pointer-events: auto;
}
```

---

## 8. SCHNELLSTART FÜR NÄCHSTE SESSION

### 8.1 Kontext wiederherstellen
1. **Lies diese Plan-Datei**: `D:\workspace\compile\ANIMATION_SYSTEM_PLAN.md`
2. Die folgenden Animationen funktionieren bereits:
   - Play (Player & AI)
   - Delete
   - Discard
   - Draw
   - Shift
3. DeckTrashArea ist links positioniert, responsive, blockiert keine Klicks
4. Neues System läuft parallel zum alten System (animationState)

### 8.2 Nächste Aufgabe wählen

**Option A: Flip-Animation implementieren (Phase E.1)**
- Suche nach `internalFlipCard` in `logic/game/helpers/actionUtils.ts`
- Füge `createFlipAnimation()` Aufruf hinzu
- CSS Animation existiert bereits (`@keyframes card-flip-rotate`)

**Option B: Return-Animation implementieren (Phase E.2)**
- Suche nach Code der Karten von Lane zur Hand zurückgibt
- Füge `createReturnAnimation()` Aufruf hinzu

**Option C: Altes Animation-System entfernen (Phase F)**
- Suche nach allen `animationState` Referenzen
- Prüfe ob neues System diese Fälle abdeckt
- Entferne alte Logik schrittweise

**Option D: AI Manager Async-Bug fixen**
- Analysiere alle `setTimeout` in `logic/game/aiManager.ts`
- Identifiziere Race Conditions
- Refactor zu Promises/async-await

### 8.3 Wichtige Imports (für useGameState.ts)
```typescript
import {
    createPlayAnimation,
    createDeleteAnimation,
    createDiscardAnimation,
    createDrawAnimation,
    createShiftAnimation,
    createFlipAnimation,
    createReturnAnimation,
    findCardInLanes,
} from '../logic/animation/animationHelpers';
```

### 8.4 Test-Befehle
```bash
npm run build          # TypeScript kompilieren
npm run dev            # Dev-Server starten
npm test               # Tests ausführen
```

---

## 9. DATEI-ÄNDERUNGEN DIESER SESSION (2025-12-29)

### Geänderte Dateien:
| Datei | Änderung |
|-------|----------|
| `components/Lane.tsx` | animatingCardId Prop + CSS-Klasse für versteckte Karten |
| `components/GameBoard.tsx` | animatingCardId an Lane weitergegeben (Zeilen 454, 516) |
| `hooks/useGameState.ts` | Shift-Animation in resolveActionWithLane, Draw-Animation in fillHand |
| `styles/layouts/game-screen.css` | DeckTrashArea links, padding-left: 180px, pointer-events fix, responsive Breakpoints |

### Neue Funktionalität:
- Karten verschwinden jetzt während Animation (statt doppelt sichtbar)
- Shift-Animation: Karte fliegt zwischen Lanes
- Draw-Animation: Karte fliegt von Deck zu Hand
- DeckTrashArea responsiv (skaliert oder verschwindet auf kleinen Screens)
- Spielfeld-Klicks funktionieren wieder (pointer-events fix)

---

## 10. HINWEIS: ALTES VS. NEUES ANIMATION-SYSTEM

**ALTES System** (noch aktiv, muss in Phase F entfernt werden):
```typescript
gameState.animationState = { type: 'deleteCard', cardId: '...', owner: 'player' };
// setTimeout für Timing
```

**NEUES System** (bevorzugt):
```typescript
const animation = createDeleteAnimation(state, card, owner, laneIndex, cardIndex);
queueMicrotask(() => enqueueAnimation(animation));
// AnimationQueueContext handled Timing automatisch
```

Die Systeme laufen parallel. In Phase F wird das alte System komplett entfernt.

---

## 11. RESPONSIVE BREAKPOINTS (CSS)

| Breakpoint | padding-left | DeckTrashArea | Karten |
|------------|--------------|---------------|--------|
| > 1200px | 180px | Voll (100x140) | Normal |
| ≤ 1200px | 130px | Klein (70x98) | Normal |
| ≤ 1000px | 100px | Mini (50x70) | Normal |
| ≤ 850px | 0px | **Versteckt** | Normal |

---

## 12. ERLEDIGTE PHASEN (HISTORIE)

- [x] **Phase A**: Foundation (Types, Context, Snapshot Utils, Timing Constants)
- [x] **Phase B**: Rendering (AnimationOverlay, SnapshotRenderer, AnimatedCard)
- [x] **Phase C**: Erste Animation (Play-Animation für Player und AI)
- [x] **Phase D.1**: DeckTrashArea Komponente erstellt
- [x] **Phase D.2**: Delete, Discard Animationen + DOM-Selektoren
- [x] **Phase D.3**: Delete-Bugfix, Draw, Shift Animationen + Layout-Fixes

---

## 13. OFFENE PHASEN

- [ ] **Phase E**: Flip + Return Animationen
- [ ] **Phase F**: Altes Animation-System entfernen
- [ ] **Phase G**: Compile-Animation
- [ ] **Phase H**: Shuffle-Animation
