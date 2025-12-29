# Animation-Queue-System Redesign für COMPILE Card Game

## STATUS: Phase E ABGESCHLOSSEN + Neue Features - Bereit für Phase F

**Letzte Aktualisierung**: 2025-12-29 (Session 2)

---

# SUPER AUSFÜHRLICHE ANLEITUNG FÜR DIE NÄCHSTE SESSION

## 0. WAS WURDE IN SESSION 2 (2025-12-29) ERLEDIGT?

### 0.1 Draw-Animation mit dynamischem Timing (700ms GESAMT)
**Problem**: Beim Ziehen mehrerer Karten dauerte jede Karte 300ms, was bei 5 Karten 1500ms war.
**Lösung**: Alle Karten fliegen innerhalb von 700ms GESAMT. Je mehr Karten, desto schneller pro Karte.

**Neue Konstanten in `constants/animationTiming.ts`:**
```typescript
export const TOTAL_DRAW_ANIMATION_DURATION = 700; // ms

export function calculateDrawDuration(cardCount: number): number {
    if (cardCount <= 0) return 0;
    if (cardCount === 1) return TOTAL_DRAW_ANIMATION_DURATION;
    return Math.floor(TOTAL_DRAW_ANIMATION_DURATION / cardCount);
}

export function calculateDrawStagger(cardIndex: number, cardCount: number): number {
    if (cardCount <= 1) return 0;
    return Math.floor(cardIndex * (TOTAL_DRAW_ANIMATION_DURATION / cardCount));
}
```

**Erweiterung in `types/animation.ts` - AnimatingCard Interface:**
```typescript
startDelay?: number;  // NEU: Für gestaffelte Multi-Karten-Animationen
```

**Erweiterung in `logic/animation/animationHelpers.ts` - createDrawAnimation:**
```typescript
export function createDrawAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    targetHandIndex: number,
    customDuration?: number,    // NEU
    startDelay?: number         // NEU
): AnimationQueueItem
```

### 0.2 Opponent Draw-Animation
**Wo**: `logic/game/aiManager.ts` in `runOpponentTurn()` bei fillHand-Aktion
**Logik**: Gleich wie Player, mit dynamischem Timing (700ms GESAMT)

### 0.3 Opponent Shift-Animation
**Wo**: `logic/game/aiManager.ts` in `handleRequiredAction()` bei selectLane-Entscheidung
**Logik**: Prüft auf `select_lane_for_shift` und erstellt Animation bevor resolveActionWithLane aufgerufen wird

### 0.4 Return-Animation erweitert
**Wo**: `logic/animation/animationHelpers.ts` - `createReturnAnimation()`
**Erweiterung**: `setFaceDown: boolean = true` Parameter hinzugefügt
```typescript
animatingCard: {
    // ...
    flipDirection: setFaceDown ? 'toFaceDown' : undefined,
    targetIsFaceUp: !setFaceDown,
}
```

**Integration**: `hooks/useGameState.ts` in `processAnimationQueue` bei return-Requests

### 0.5 Trash-Rotation während Animation
**Problem**: Karten flogen zum Trash ohne Rotation, aber Trash-Karten sind um 90° gedreht.
**Lösung**: `targetRotation` in `AnimatingCard` Interface hinzugefügt

**In `types/animation.ts`:**
```typescript
targetRotation?: number;  // Rotation am Ziel in Grad (z.B. 90 für Trash)
```

**In `logic/animation/animationHelpers.ts`:**
```typescript
// createDeleteAnimation + createDiscardAnimation
animatingCard: {
    // ...
    targetRotation: owner === 'player' ? 90 : -90,  // Player 90°, Opponent -90°
}
```

**In `components/AnimatedCard.tsx`:**
```typescript
const finalRotation = baseRotation + (targetRotation || 0);
// ... mit CSS transition: transform ${flyDuration}ms ${easing}
```

### 0.6 Protokoll-Bars nur über Lanes zentrieren
**Problem**: Protocol-Bars waren über gesamte Breite zentriert, inkl. DeckTrashArea.
**Lösung**: CSS-Breite auf `calc(100% - 170px)` gesetzt

**In `styles/layouts/game-screen.css`:**
```css
.protocol-bars-container {
    width: calc(100% - 170px);
    margin-left: auto;
    margin-right: 0;
}
/* Responsive Breakpoints bei 1200px, 1000px, 850px */
```

### 0.7 Shift-Animation Card-Hiding Fix
**Problem**: Bei Shift wurde die Karte in BEIDEN Lanes versteckt (alt + neu), statt nur in der alten.
**Lösung**: `animatingCardInfo` mit `fromPosition` statt nur `animatingCardId`

**In `screens/GameScreen.tsx`:**
```typescript
const animatingCardInfo = useMemo(() => {
    if (isAnimating && currentAnimation?.animatingCard) {
        const { card, fromPosition } = currentAnimation.animatingCard;
        return { cardId: card.id, fromPosition };
    }
    return null;
}, [isAnimating, currentAnimation]);
```

**In `components/Lane.tsx`:**
```typescript
let isBeingAnimated = false;
if (animatingCardInfo?.cardId === card.id) {
    if (animatingCardInfo.fromPosition.type === 'lane') {
        isBeingAnimated = animatingCardInfo.fromPosition.laneIndex === laneIndex;
    } else {
        isBeingAnimated = true;
    }
}
```

### 0.8 UI während Animation verstecken
**Wo**: `screens/GameScreen.tsx`
**Änderung**: Alle Modals (RearrangeProtocols, SwapProtocols, RevealedDeck, etc.) und Toasts mit `!isAnimating &&` gewrappt

```tsx
{!isAnimating && showRearrangeModal && ... && (
    <RearrangeProtocolsModal ... />
)}
{/* etc. für alle Modals */}

{!isAnimating && (
    <div className="toaster-container">
        {toasts.map(...)}
    </div>
)}
```

---

## 1. WAS WURDE IN SESSION 1 (2025-12-29) ERLEDIGT?

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
- [x] **Delete-Animation**: Karte fliegt von Lane zu Trash (mit 90° Rotation)
- [x] **Discard-Animation**: Karte fliegt von Hand zu Trash (mit 90° Rotation)
- [x] **Draw-Animation** (Player & Opponent): Karte fliegt von Deck zu Hand (dynamisches 700ms Timing)
- [x] **Shift-Animation** (Player & Opponent): Karte fliegt von Lane zu Lane
- [x] **Return-Animation**: Karte fliegt von Lane zurück zu Hand (facedown)
- [x] **Highlight-Phase für AI**: 400ms mit rotem Glow bevor Animation startet
- [x] **Source-Card versteckt**: Karte während Animation via CSS unsichtbar
- [x] **Trash-Rotation**: Karten drehen sich während Flug zum Trash (Player +90°, Opponent -90°)
- [x] **Staggered Draw**: Multi-Card Draws mit gestaffeltem Timing

### 3.2 UI/Layout
- [x] **DeckTrashArea**: Deck und Trash auf linker Seite angezeigt
- [x] **Responsive Design**: DeckTrashArea skaliert mit Bildschirmgröße
- [x] **Lanes klickbar**: pointer-events korrekt konfiguriert
- [x] **Protocol-Namen sichtbar**: DeckTrashArea überdeckt nichts mehr
- [x] **Protocol-Bars Zentrierung**: Nur über Lanes, nicht über DeckTrashArea
- [x] **Modale/Toasts versteckt**: UI-Elemente während Animation ausgeblendet

---

## 4. WAS FEHLT NOCH? (TODO für nächste Sessions)

### Phase E: Flip + Return Animationen

#### E.1 Flip-Animation (NOCH OFFEN)
- **Problem**: Flip passiert an vielen Stellen im Code
- **Lösung**: Zentrale Stelle finden wo Karten geflippt werden
- **Dateien zu prüfen**:
  - `logic/game/helpers/actionUtils.ts` - `internalFlipCard()`
  - `logic/effects/actions/flipExecutor.ts`
  - Verschiedene Resolver-Dateien
- **Animation**: Karte dreht sich an Ort und Stelle (in-place rotation)
- **Timing**: 300ms
- **CSS**: `@keyframes card-flip-rotate` existiert bereits in animations.css

#### E.2 Return-Animation ✅ ERLEDIGT
- **Implementation**: `createReturnAnimation()` mit `setFaceDown` Parameter
- **Integration**: In `hooks/useGameState.ts` processAnimationQueue
- **Animation**: Karte fliegt von Lane zu Hand (facedown)
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
- [x] **Phase E.2**: Return-Animation implementiert
- [x] **Session 2 Features**:
  - Draw-Animation dynamisches Timing (700ms GESAMT)
  - Opponent Draw + Shift Animationen
  - Trash-Rotation während Flug (90°/-90°)
  - Protocol-Bars Zentrierung fix
  - Shift-Animation Card-Hiding fix
  - Modale/Toasts während Animation verstecken

---

## 13. OFFENE PHASEN

- [ ] **Phase E.1**: Flip-Animation
- [ ] **Phase F**: Altes Animation-System entfernen
- [ ] **Phase G**: Compile-Animation
- [ ] **Phase H**: Shuffle-Animation
