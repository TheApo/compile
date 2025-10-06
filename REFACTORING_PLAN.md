# Actor/Owner Refactoring Plan

## Ziel
Das Spielsystem so umstrukturieren, dass klar zwischen "wessen Zug es ist" (`turn`) und "wer eine Aktion ausführt" (`actor`) sowie "wem eine Karte gehört" (`cardOwner`) unterschieden wird.

## Problem-Analyse
- **Aktuell:** `actor` wird inkonsistent verwendet - manchmal bedeutet es "wer spielt die Karte", manchmal "wem gehört die Karte", manchmal "wer führt die Aktion aus"
- **Folge:** Bei Interrupts und Uncover-Effekten entstehen Bugs, weil `state.turn` statt `actionRequired.actor` verwendet wird
- **Ziel:** Klare Semantik, sodass Karteneffekte wie der Kartentext gelesen werden können

---

## Phase 1: Kritische Bugs fixen (Sofort) ✅

### 1.1 Resolver: Immer `actionRequired.actor` verwenden
**Status:** ✅ ERLEDIGT

- [x] `cardResolver.ts` Zeile 173: `select_any_opponent_card_to_shift` → `actor: prev.actionRequired.actor`
- [x] Alle anderen Resolver durchgehen und `prev.turn` durch `prev.actionRequired.actor` ersetzen wo nötig
  - [x] `cardResolver.ts` - kompletter Durchgang (5 Fixes: Zeile 222, 249, 276, 26, 511)
  - [x] `discardResolver.ts` - kompletter Durchgang (2 Fixes: Zeile 162, 189)
  - [x] `laneResolver.ts` - kompletter Durchgang (4 Fixes: Zeile 92, 141, 193, 338)
  - [x] `promptResolver.ts` - kompletter Durchgang (keine Probleme gefunden)
  - [x] `handCardResolver.ts` - kompletter Durchgang (keine Probleme gefunden)

**Dateien zu überprüfen:**
- `logic/game/resolvers/cardResolver.ts` (~800 Zeilen)
- `logic/game/resolvers/discardResolver.ts` (~250 Zeilen)
- `logic/game/resolvers/laneResolver.ts` (~100 Zeilen)
- `logic/game/resolvers/promptResolver.ts` (~400 Zeilen)
- `logic/game/resolvers/handCardResolver.ts` (~100 Zeilen)

### 1.2 GameScreen.tsx: Click Handler Fix
**Status:** ✅ ERLEDIGT

- [x] Zeile 247: `actionRequired.actor === 'player'` statt `turn === 'player'`

---

## Phase 2: Typsystem erweitern (Fundament) ✅

### 2.1 Neuer Context-Type für Karteneffekte
**Status:** ✅ ERLEDIGT

```typescript
// types/index.ts
export type EffectContext = {
    cardOwner: Player;           // Wem gehört die Karte?
    currentTurn: Player;         // Wessen Zug ist es?
    opponent: Player;            // Gegner des Kartenbesitzers
    isUncover: boolean;          // Wurde die Karte uncovered (vs. gespielt)?
    isInterrupt: boolean;        // Ist dies ein Interrupt-Effekt?
};
```

**Dateien:**
- [x] `types/index.ts` - EffectContext Type hinzugefügt (Zeile 25-31)
- [x] Karteneffekt-Signatur Anpassung später in Phase 3

### 2.2 ActionRequired erweitern
**Status:** ✅ ERLEDIGT (Vorbereitung)

```typescript
export type ActionMetadata = {
    sourceCardOwner?: Player;    // Wem gehört die Source-Karte? (for future use)
    initiator?: Player;          // Wer hat den Effekt ausgelöst? (for future use)
};
```

**Dateien:**
- [x] `types/index.ts` - ActionMetadata Type hinzugefügt (Zeile 61-64)
- [x] Basis für zukünftige Erweiterungen geschaffen (Breaking Changes vermieden)

---

## Phase 3: Effect Executor Refactoring

### 3.1 executeOnPlayEffect Parameter umbenennen
**Status:** ⏳ GEPLANT

**Vorher:**
```typescript
export function executeOnPlayEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    actor: Player  // ← UNKLAR!
): EffectResult
```

**Nachher:**
```typescript
export function executeOnPlayEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    cardOwner: Player  // ← KLAR: Wem gehört die Karte?
): EffectResult

// ODER mit Kontext:
export function executeOnPlayEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext
): EffectResult
```

**Dateien:**
- [ ] `logic/effectExecutor.ts` - Signatur ändern
- [ ] Alle Aufrufe von `executeOnPlayEffect` anpassen (~10 Stellen)

### 3.2 Effekt-Registry-Funktionen anpassen
**Status:** ⏳ GEPLANT

Alle Effekt-Funktionen bekommen konsistente Parameter:

```typescript
export const execute = (
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    cardOwner: Player  // ← Statt "actor"
): EffectResult => {
    const you = cardOwner;
    const yourOpponent = cardOwner === 'player' ? 'opponent' : 'player';

    // Kartentext: "Your opponent discards..."
    // Code liest sich jetzt wie Kartentext!
}
```

**Dateien zu ändern (95+ Dateien!):**
- [ ] `logic/effects/*/Fire-0.ts` bis `Fire-6.ts` (7 Dateien)
- [ ] `logic/effects/*/Water-0.ts` bis `Water-6.ts` (7 Dateien)
- [ ] `logic/effects/*/Spirit-0.ts` bis `Spirit-6.ts` (7 Dateien)
- [ ] `logic/effects/*/Death-0.ts` bis `Death-6.ts` (7 Dateien)
- [ ] `logic/effects/*/Metal-0.ts` bis `Metal-6.ts` (7 Dateien)
- [ ] `logic/effects/*/Plague-0.ts` bis `Plague-6.ts` (7 Dateien)
- [ ] `logic/effects/*/Psychic-0.ts` bis `Psychic-6.ts` (7 Dateien)
- [ ] `logic/effects/*/Speed-0.ts` bis `Speed-6.ts` (7 Dateien)
- [ ] `logic/effects/*/Gravity-0.ts` bis `Gravity-6.ts` (7 Dateien)
- [ ] `logic/effects/*/Light-0.ts` bis `Light-6.ts` (7 Dateien)
- [ ] `logic/effects/*/Darkness-0.ts` bis `Darkness-6.ts` (7 Dateien)
- [ ] Weitere Protokolle (Hate, Love, Apathy, etc.)

**Strategie:**
1. Start mit Protokollen die Bugs hatten: **Psychic**, **Fire**
2. Dann systematisch durch alle anderen

---

## Phase 4: Utility-Funktionen anpassen ✅

### 4.1 actionUtils.ts
**Status:** ✅ ERLEDIGT

**Funktionen überprüft:**
- [x] `handleUncoverEffect()` - ✅ Korrekt (verwendet owner als Parameter)
- [x] `internalReturnCard()` - ✅ GEFIXT (Zeile 215: verwendet jetzt actionRequired.actor statt turn)
- [x] `internalShiftCard()` - ✅ Korrekt (actor als Parameter übergeben)
- [x] `handleChainedEffectsOnDiscard()` - ✅ Korrekt (bereits in Session 1 gefixt)

**Fix in internalReturnCard:**
```typescript
// Zeile 215 - GEFIXT:
const actor = (newState.actionRequired && 'actor' in newState.actionRequired)
    ? newState.actionRequired.actor
    : newState.turn;
```

**Dateien:**
- [x] `logic/game/helpers/actionUtils.ts` - 1 Fix angewendet
- [x] Build erfolgreich getestet

### 4.2 gameStateModifiers.ts
**Status:** ✅ ERLEDIGT

- [x] `checkForSpirit3Trigger()` - ✅ Korrekt (verwendet player Parameter als actor)
- [x] Andere Trigger-Funktionen überprüft - ✅ Keine Probleme gefunden

---

## Phase 5: Resolver Vollständige Überarbeitung

### 5.1 Einheitliches Pattern
**Status:** ⏳ GEPLANT

**Jeder Resolver sollte:**
1. **IMMER** `const actor = prev.actionRequired.actor` verwenden
2. **NIEMALS** `const actor = prev.turn` verwenden
3. Bei neuen Actions: `sourceCardOwner` und `initiator` setzen (wenn vorhanden)

### 5.2 Checklist pro Resolver-Datei
**Status:** ⏳ GEPLANT

- [ ] **cardResolver.ts**
  - [ ] Alle `prev.turn` durch `prev.actionRequired.actor` ersetzen
  - [ ] Alle neuen Actions mit `sourceCardOwner` annotieren
  - [ ] Tests schreiben für Interrupt-Szenarien

- [ ] **discardResolver.ts**
  - [ ] `handleChainedEffectsOnDiscard` Aufrufe korrigieren
  - [ ] Alle `prev.turn` durch `prev.actionRequired.actor` ersetzen

- [ ] **laneResolver.ts**
  - [ ] Alle `prev.turn` durch `prev.actionRequired.actor` ersetzen

- [ ] **promptResolver.ts**
  - [ ] Psychic-4, Spirit-3, etc. - actor korrekt propagieren
  - [ ] `sourceEffect: 'speed_3_end'` Bug in Spirit-3 fixen

- [ ] **handCardResolver.ts**
  - [ ] Alle `prev.turn` durch `prev.actionRequired.actor` ersetzen

---

## Phase 6: Testing & Validation

### 6.1 Test-Szenarien erstellen
**Status:** ✅ ERLEDIGT

**Kritische Szenarien dokumentiert in TEST_PLAN.md:**
- [x] Szenario 1: Psychic-3 wird uncovered während Opponent's Turn
- [x] Szenario 2: Psychic-4 End Effect mit Uncover-Interrupt → Flip in Queue
- [x] Szenario 3: Spirit-3 Draw während End Phase → Turn endet nicht vorzeitig
- [x] Szenario 4: Plague-2 mit Actor Propagation
- [x] Szenario 5: Darkness-1 Flip + Shift mit Interrupt
- [x] Szenario 6: Death-2 / Metal-3 Lane Selection
- [x] Szenario 7: Water-3 Lane Return
- [x] Szenario 8: Plague-4 Delete + Flip (owner vs turn check)
- [x] Szenario 9: internalReturnCard mit Interrupt

**Datei:** `TEST_PLAN.md` erstellt

### 6.2 Debug-Tool erstellt
**Status:** ✅ ERLEDIGT

**Debug-Tool Features:**
- 🐛 Debug-Panel im Spiel (roter Button unten rechts)
- 6 vordefinierte Test-Szenarien zum sofortigen Laden
- Sofortige Board-State Manipulation
- Keine manuelle Setup-Zeit mehr!

**Dateien erstellt:**
- [x] `utils/testScenarios.ts` - Szenario-Definitionen
- [x] `components/DebugPanel.tsx` - UI-Komponente
- [x] `screens/GameScreen.tsx` - Integration
- [x] `DEBUG_TOOL_GUIDE.md` - Vollständige Anleitung

### 6.3 Manuelle Test-Session
**Status:** ⏳ BEREIT ZUM TESTEN

**Test-Methode:**
- [ ] `npm run dev` starten
- [ ] 🐛 DEBUG Button klicken (unten rechts)
- [ ] Test-Szenario laden (1 Klick!)
- [ ] Situation durchspielen
- [ ] Logs prüfen (Log Button)
- [ ] Ergebnis in TEST_PLAN.md dokumentieren

**Zu beobachten:**
- Korrekte Actor-Namen in Logs
- Keine Softlocks
- Turn-Wechsel korrekt
- Queue-System funktioniert
- Click-Handler reagieren

---

## Phase 7: Dokumentation

### 7.1 Code-Kommentare
**Status:** ⏳ GEPLANT

- [ ] Jeder Effekt-Datei Header hinzufügen mit Erklärung:
  ```typescript
  /**
   * Psychic-3: Your opponent discards 1 card. Shift 1 of their cards.
   *
   * @param cardOwner - Player who owns this card (the "you" in card text)
   * @param yourOpponent - The opponent of cardOwner (calculated as opposite)
   */
  ```

### 7.2 Architektur-Dokumentation
**Status:** ⏳ GEPLANT

- [ ] `docs/ARCHITECTURE.md` erstellen
  - [ ] Erklärung: `turn` vs `actor` vs `cardOwner`
  - [ ] Interrupt-System Diagramm
  - [ ] Queue-System Ablauf
  - [ ] Best Practices für neue Karteneffekte

---

## Phase 8: Cleanup & Optimierung

### 8.1 Tote Code entfernen
**Status:** ⏳ GEPLANT

- [ ] Alle `// FIXME` und `// TODO` Kommentare durchgehen
- [ ] Ungenutzte Funktionen entfernen
- [ ] Doppelte Logik konsolidieren

### 8.2 Performance
**Status:** ⏳ GEPLANT

- [ ] `findCardOnBoard` Aufrufe reduzieren (caching?)
- [ ] `recalculateAllLaneValues` nur wenn nötig
- [ ] Animation-System optimieren

---

## Risiko-Management

### Hohe Risiko-Bereiche
1. **Phase Manager** - Änderungen hier können Turn-Wechsel brechen
2. **Effect Executor** - Zentrale Stelle für alle Karteneffekte
3. **Queue-System** - Sehr komplex, leicht Bugs einzubauen

### Strategie
- **Inkrementell:** Immer nur ein Protokoll/Feature auf einmal
- **Testing:** Nach jedem Schritt manuell testen
- **Rollback:** Git Commits nach jedem funktionierenden Schritt
- **Documentation:** Änderungen hier dokumentieren

---

## Progress Tracking

### Gesamt-Fortschritt
- **Phase 1:** 100% ✅ (Alle Tasks erledigt)
- **Phase 2:** 100% ✅ (Alle Tasks erledigt)
- **Phase 3:** 0% ⏳
- **Phase 4:** 100% ✅ (Alle Tasks erledigt)
- **Phase 5:** 0% ⏳ (bereits teilweise durch Phase 1 erledigt)
- **Phase 6:** 70% ⏳ (Test-Szenarien + Debug-Tool fertig, Tests ausstehend)
- **Phase 7:** 0% ⏳
- **Phase 8:** 0% ⏳

**Gesamtfortschritt: ~50%** (Phase 1, 2, 4 abgeschlossen; Phase 6 fast fertig)

### Nächste Schritte (Priorisiert)
1. ✅ Spirit-3 Bug fixen (queuedActions in End Phase)
2. ✅ Psychic-4 Flip in Queue bei Interrupt
3. ✅ cardResolver.ts: `actor` statt `turn` bei shift
4. ✅ Phase 1.1 abschließen - Alle Resolver durchgehen
5. ✅ Phase 4.1 - `handleChainedEffectsOnDiscard` Fix (bereits in Session 1 erledigt)
6. ✅ Phase 2 - Typsystem erweitern
7. ✅ Phase 4 - Utility-Funktionen anpassen
8. ✅ Phase 6.1 - Test-Szenarien erstellen (TEST_PLAN.md)
9. ⏳ **NEXT:** Phase 6.2 - Manuelle Tests durchführen

---

## Changelog

### 2025-01-XX - Session 2
- ✅ **Phase 1 KOMPLETT ABGESCHLOSSEN**: Alle kritischen Resolver-Bugs gefixt
- ✅ **Phase 2 KOMPLETT ABGESCHLOSSEN**: Typsystem erweitert
- ✅ Phase 1.1: Alle Resolver systematisch durchsucht und gefixt
- ✅ cardResolver.ts - 5 Fixes für `prev.turn` → `prev.actionRequired.actor`:
  - Zeile 222: `select_own_other_card_to_shift`
  - Zeile 249: `select_opponent_face_down_card_to_shift` (Speed-4)
  - Zeile 276: `select_own_card_to_shift_for_speed_3`
  - Zeile 26: `handleMetal6Flip` - actor extraction mit fallback
  - Zeile 511: `plague_4_player_flip_optional` - verwendet jetzt Plague-4 owner statt turn
- ✅ discardResolver.ts - 2 Fixes:
  - Zeile 162: `resolvePlague2Discard` - actor statt prev.turn
  - Zeile 189: `resolvePlague2OpponentDiscard` - actor statt hardcoded 'opponent'
- ✅ laneResolver.ts - 4 Fixes:
  - Zeile 92: `shift_flipped_card_optional` (Darkness-1)
  - Zeile 141: `select_lane_for_death_2`
  - Zeile 193: `select_lane_for_metal_3_delete`
  - Zeile 338: `select_lane_for_water_3`
- ✅ promptResolver.ts - keine Probleme gefunden
- ✅ handCardResolver.ts - keine Probleme gefunden
- ✅ Phase 2.1: EffectContext Type zu types/index.ts hinzugefügt (Zeile 25-31)
- ✅ Phase 2.2: ActionMetadata Type zu types/index.ts hinzugefügt (Zeile 61-64)
- ✅ Phase 4.1: actionUtils.ts überprüft - 1 Fix in internalReturnCard (Zeile 215)
- ✅ Phase 4.2: gameStateModifiers.ts überprüft - keine Probleme gefunden
- ✅ Phase 6.1: TEST_PLAN.md erstellt mit 9 kritischen Test-Szenarien
- ✅ Phase 6.2: Debug-Tool implementiert (🐛 Panel im Spiel)
  - utils/testScenarios.ts - 6 vordefinierte Szenarien
  - components/DebugPanel.tsx - UI-Komponente
  - DEBUG_TOOL_GUIDE.md - Vollständige Anleitung
- ✅ Build erfolgreich getestet nach allen Änderungen

**Insgesamt 12 kritische Fixes + 2 neue Types + Test-Plan + Debug-Tool** in dieser Session

### 2025-01-XX - Session 1
- ✅ Spirit-3 Bug analysiert und gefixt (End Phase mit queuedActions)
- ✅ Psychic-4 Flip-Queue System implementiert
- ✅ GameScreen.tsx Click Handler gefixt (actor statt turn)
- ✅ cardResolver.ts Zeile 173 gefixt (select_any_opponent_card_to_shift)
- ✅ actionUtils.ts `handleChainedEffectsOnDiscard` - Queue-Support hinzugefügt
- ✅ types/index.ts - `flip_self_for_psychic_4` ActionType hinzugefügt
- ✅ phaseManager.ts - Auto-Resolver für `flip_self_for_psychic_4`
- ✅ phaseManager.ts - End Phase endet nicht wenn `queuedActions` existieren

**Gefundene Bugs (noch offen):**
- ⏳ Psychic-3 bei Uncover: Doppelter Shift (mögliche Ursache: queuedActions nicht geleert?)
- ⏳ discardResolver.ts Zeile 70: Übergibt immer 'player' statt `actor`

**Lessons Learned:**
- `turn` vs `actor` Verwirrung ist Haupt-Bug-Quelle
- Queue-System ist komplex aber funktioniert wenn korrekt implementiert
- Interrupts brauchen sorgfältige Actor-Propagierung

---

## Notes & Ideen

- Vielleicht ein `EffectBuilder` Pattern für häufige Operationen?
  ```typescript
  EffectBuilder(cardOwner)
    .opponentDiscards(1)
    .youShiftOpponentCard()
    .build()
  ```
- Type-Guards für ActionRequired Union-Type?
- Automatisierte Tests für alle Karteneffekte?

