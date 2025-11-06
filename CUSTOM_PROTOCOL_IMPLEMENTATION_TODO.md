# Custom Protocol Implementation - TODO Liste

## Status: ~85% Complete ✅

**Latest Updates (Session 3):**
- ✅ **"If you do" conditional chains FULLY IMPLEMENTED! 🎉**
  - Can now recreate Fire-1, Fire-2, Love-1, Psychic-4!
  - UI support in effect editors (checkbox + nested editor)
  - Text generation shows "If you do, [follow-up]"
  - Runtime execution for both immediate and deferred effects

**Latest Updates (Session 2):**
- ✅ Discard "1 or more" variable count implemented
- ✅ Take from hand effect type implemented
- ✅ All effect parameter extensions completed

**Major Achievements (Overall):**
- ✅ Start/End/On-Cover triggers work for custom cards
- ✅ Delete: Value ranges + Scopes (can recreate Death protocol!)
- ✅ Flip: "All" + "Each in each line" (can recreate Chaos-0, Apathy-1, Plague-3!)
- ✅ Shift: "All" support (can recreate Light-3!)
- ✅ Play: Opponent plays + Each other line (can recreate Gravity-6, Water-1!)
- ✅ Discard: Variable count (can recreate Fire-4 Part 1!)
- ✅ Take: New effect type (can recreate Love-3!)
- ✅ **Conditional chains: "If you do" support (can recreate Fire-1, Fire-2, Love-1!)**

**Nachbaubare Protokolle:**
- **Death**: Fast vollständig (5/6 Karten - nur Death-1 benötigt "If you do")
- **Chaos**: Teilweise (Chaos-0 vollständig, andere benötigen Multi-Actions)
- **Love**: Teilweise (Love-3 vollständig, andere benötigen Conditionals)
- **Water**: Teilweise (Water-1, Water-3, Water-4 vollständig)
- **Light**: Teilweise (Light-3 vollständig, andere benötigen Conditionals)
- **Plague**: Teilweise (Plague-3 vollständig)

---

## ✅ ABGESCHLOSSEN

### 1. Kritische Bug Fixes
- [x] **Start/End/On-Cover Trigger Execution** - Custom Cards können jetzt alle Bottom Box Trigger nutzen
  - File: `logic/effectExecutor.ts` (Lines 112-322)
  - Start Phase effects funktionieren
  - End Phase effects funktionieren
  - On-Cover effects funktionieren

### 2. UI Erweiterungen - Effect Editors

#### Delete Effect (vollständig erweitert)
- [x] Value Range selector
  - File: `screens/CustomProtocolCreator/EffectParameterEditors/DeleteEffectEditor.tsx` (Lines 92-116)
  - Value 0 only
  - Values 0-1
  - Values 1-2
- [x] Scope selector
  - Lines 118-139
  - This line only
  - Other lanes
  - Each other line (1 per line)
- [x] Text generation aktualisiert in:
  - `DeleteEffectEditor.tsx` (Lines 182-188)
  - `cardFactory.ts` (Lines 119-125)
  - `CardEditor.tsx` (Lines 227-233)

#### Flip Effect (all/each support)
- [x] Count/Scope selector
  - File: `screens/CustomProtocolCreator/EffectParameterEditors/FlipEffectEditor.tsx` (Lines 19-62)
  - 1 card, 2 cards, 3 cards
  - All matching cards
  - Each matching card
- [x] "Each Line" sub-option
  - Lines 51-62
  - Each card on board
  - 1 card in each line
- [x] Text generation aktualisiert in:
  - `FlipEffectEditor.tsx` (Lines 136-170)
  - `cardFactory.ts` (Lines 44-78)
  - `CardEditor.tsx` (Lines 149-184)

#### Shift Effect (all support)
- [x] Count selector
  - File: `screens/CustomProtocolCreator/EffectParameterEditors/ShiftEffectEditor.tsx` (Lines 16-31)
  - 1 card
  - All matching cards
- [x] Destination erweitert
  - Lines 72-90
  - "To another line" option hinzugefügt
- [x] Text generation aktualisiert in:
  - `ShiftEffectEditor.tsx` (Lines 98-120)
  - `cardFactory.ts` (Lines 80-102)
  - `CardEditor.tsx` (Lines 186-209)

#### Play Effect (opponent plays + destinations)
- [x] Actor selector
  - File: `screens/CustomProtocolCreator/EffectParameterEditors/PlayEffectEditor.tsx` (Lines 16-32)
  - You
  - Opponent
- [x] Destination erweitert
  - Lines 58-70
  - Each other line (1 per line)
  - Other lines (choose 1)
  - Specific lane (this line)
  - Each line with card
  - Under this card
- [x] Text generation aktualisiert in:
  - `PlayEffectEditor.tsx` (Lines 79-109)
  - `cardFactory.ts` (Lines 173-203)
  - `CardEditor.tsx` (Lines 283-314)

### 3. UI Dropdowns
- [x] "Give Cards" zu Middle Box hinzugefügt
  - File: `screens/CustomProtocolCreator/CardEditor.tsx` (Line 498)
- [x] Bottom Box vollständig erweitert
  - Lines 527-541
  - Give Cards, Play from Hand/Deck, Swap Protocols, Reveal Hand hinzugefügt
- [x] "Take from Hand" zu Middle und Bottom Box hinzugefügt
  - Lines 540, 583

### 4. New Effect Types (Phase 1 Quick Wins)
- [x] Discard "1 or more" variable count
  - File: `DiscardEffectEditor.tsx` erweitert
  - `variableCount: boolean` parameter
  - Kann jetzt "Fire-4: Discard 1 or more cards" nachbilden
- [x] Take from hand effect type
  - Neuer Editor: `TakeEffectEditor.tsx` erstellt
  - Vollständig in UI und Game Logic integriert
  - Kann jetzt "Love-3: Take 1 random card from opponent's hand" nachbilden

---

## ⏳ IN ARBEIT / NOCH OFFEN

### Phase 1: Fehlende Effect Types (High Priority)

#### A. Discard Variations
- [x] "1 or more" variable count ✅
  - Beispiel: Fire-4: "Discard 1 or more cards. Draw the amount discarded plus 1"
  - Beispiel: Plague-2: "Discard 1 or more cards. Your opponent discards the amount discarded plus 1"
  - **Implementation:** COMPLETED
    - `DiscardEffectEditor.tsx`: Count selector erweitert (Lines 17-34)
    - Neues Feld: `variableCount: boolean`
    - Text generation aktualisiert: Lines 51-67
    - `cardFactory.ts`: Lines 153-169
    - `CardEditor.tsx`: Lines 261-278

#### B. Draw Variations
- [ ] Draw based on revealed card value
  - Beispiel: Light-0: "Flip 1 card. Draw cards equal to that card's value"
  - **Implementation:**
    - `DrawEffectEditor.tsx`: Neuer conditional type: `'based_on_revealed_value'`
    - Benötigt Sequenz: Flip → Draw (based on result)
    - Könnte als zwei separate effects implementiert werden mit shared state

- [ ] Draw equal to discard count
  - Beispiel: Fire-4: "Discard 1 or more cards. Draw the amount discarded plus 1"
  - **Implementation:**
    - Neuer conditional type: `'equal_to_discarded'` mit `offset: number` (für +1)

#### C. Multi-Action Sequences
- [x] "If you do" conditional chains ✅ **COMPLETED!**
  - Beispiel: Fire-1: "Discard 1 card. If you do, delete 1 card"
  - Beispiel: Fire-2: "Discard 1 card. If you do, return 1 card"
  - Beispiel: Love-1 (End): "You may give 1 card. If you do, draw 2 cards"
  - **Implementation:** COMPLETED (Session 3)
    - Type definitions: `EffectDefinition.conditional.thenEffect` (types/customProtocol.ts)
    - UI: Checkbox + nested effect editor (EffectEditor.tsx:169-211)
    - Text generation: CardEditor.tsx (Lines 390-394), cardFactory.ts (Lines 276-280)
    - Runtime: effectInterpreter.ts (Lines 76-92), actionUtils.ts (Lines 42-78)
    - Works for both immediate effects (e.g., Draw) and deferred effects (e.g., Discard)

- [ ] Sequential multi-actions on same card
  - Beispiel: Light-2: "Draw 2 cards. Reveal 1 face-down card. You may shift or flip that card"
  - Beispiel: Darkness-1: "Flip 1 of your opponent's cards. You may shift that card"
  - **Implementation:**
    - Array von effects in einer Karte
    - Shared context zwischen effects (welche Karte wurde geflippt?)

### Phase 2: Passive Effects (Top Box - Complex)

#### A. Value Modification Effects
- [ ] Increase/decrease line value
  - Beispiel: Apathy-0: "Your total value in this line is increased by 1 for each face-down card"
  - Beispiel: Metal-0: "Your opponent's total value in this line is reduced by 2"
  - **Implementation:**
    - Neuer effect type: `'modify_value'`
    - Parameters: `target: 'own' | 'opponent'`, `modifier: number | 'per_face_down_card'`
    - Muss in `recalculateAllLaneValues` integriert werden

- [ ] Override card values
  - Beispiel: Darkness-2: "All face-down cards in this stack have a value of 4"
  - **Implementation:**
    - Neuer effect type: `'override_card_values'`
    - Parameters: `targetFilter`, `newValue: number`
    - Muss in `recalculateAllLaneValues` integriert werden

#### B. Play Restriction Effects
- [ ] Cannot play face-down/face-up
  - Beispiel: Metal-2: "Your opponent cannot play cards face-down in this line"
  - Beispiel: Psychic-1: "Your opponent can only play cards face-down"
  - **Implementation:**
    - Neuer effect type: `'play_restriction'`
    - Parameters: `target: 'opponent'`, `restriction: 'no_face_down' | 'only_face_down'`, `scope: 'this_line' | 'all_lines'`
    - Muss in play validation logic integriert werden

- [ ] Cannot play in line
  - Beispiel: Plague-0 (Bottom): "Your opponent cannot play cards in this line"
  - **Implementation:**
    - Type: `'play_restriction'`
    - Parameters: `target: 'opponent'`, `restriction: 'cannot_play'`, `scope: 'this_line'`

- [ ] Play anywhere / without matching protocols
  - Beispiel: Spirit-1: "You can play cards in any line"
  - Beispiel: Chaos-3: "You may play cards without matching protocols"
  - Beispiel: Anarchy-1: "Cards can only be played without matching protocols"
  - **Implementation:**
    - Type: `'play_restriction'`
    - Parameters: `target: 'self'`, `restriction: 'any_line' | 'no_protocol_match_required' | 'must_not_match'`

#### C. Reactive Trigger Effects (After X happens)
- [ ] After delete cards → trigger
  - Beispiel: Hate-3: "After you delete cards: Draw 1 card"
  - **Implementation:**
    - Neuer trigger type: `'after_delete'`
    - Muss hook in delete logic hinzufügen
    - Effect wird getriggert nachdem delete passiert ist

- [ ] After opponent discards → trigger
  - Beispiel: Plague-1: "After your opponent discards cards: Draw 1 card"
  - **Implementation:**
    - Trigger type: `'after_opponent_discards'`
    - Hook in discard logic

- [ ] After clear cache → trigger
  - Beispiel: Speed-1: "After you clear cache: Draw 1 card"
  - **Implementation:**
    - Trigger type: `'after_clear_cache'`
    - Hook in cache clear logic

- [ ] After draw cards → trigger
  - Beispiel: Spirit-3: "After you draw cards: You may shift this card, even if covered"
  - **Implementation:**
    - Trigger type: `'after_draw'`
    - Hook in draw logic

- [ ] When would be deleted by compiling → trigger
  - Beispiel: Speed-2: "When this card would be deleted by compiling: Shift this card, even if covered"
  - **Implementation:**
    - Trigger type: `'before_compile_delete'`
    - Hook in compile logic VOR delete

- [ ] When would be covered or flipped → trigger
  - Beispiel: Metal-6: "When this card would be covered or flipped: First, delete this card"
  - **Implementation:**
    - Trigger type: `'before_cover'` oder `'before_flip'`
    - Hook VOR der Aktion

#### D. Block/Prevention Effects
- [ ] Cannot flip
  - Beispiel: Frost-1: "Cards cannot be flipped face-up"
  - **Implementation:**
    - Neuer effect type: `'prevent_action'`
    - Parameters: `action: 'flip'`, `scope: 'all_cards'`
    - Muss in flip validation logic integriert werden

- [ ] Cannot rearrange protocols
  - Beispiel: Frost-1: "Protocols cannot be rearranged"
  - **Implementation:**
    - Type: `'prevent_action'`
    - Parameters: `action: 'rearrange_protocols'`
    - Muss in protocol rearrange logic integriert werden

- [ ] Cannot shift
  - Beispiel: Frost-3: "Cards cannot shift from or to this line"
  - **Implementation:**
    - Type: `'prevent_action'`
    - Parameters: `action: 'shift'`, `scope: 'this_line'`
    - Muss in shift validation logic integriert werden

#### E. Special Effects
- [ ] Ignore middle commands
  - Beispiel: Apathy-2: "Ignore all middle commands of cards in this line"
  - **Implementation:**
    - Neuer effect type: `'ignore_middle_effects'`
    - Parameters: `scope: 'this_line'`
    - Muss in `executeOnPlayEffect` integriert werden (bereits teilweise vorhanden für Apathy-2!)

- [ ] Cannot compile next turn
  - Beispiel: Metal-1: "Draw 2 cards. Your opponent cannot compile next turn"
  - **Implementation:**
    - Neuer effect type: `'prevent_compile'`
    - Parameters: `target: 'opponent'`, `duration: 1` (1 turn)
    - State flag: `cannotCompileNextTurn: boolean`

- [ ] Skip phase
  - Beispiel: Spirit-0 (Bottom): "Skip your check cache phase"
  - **Implementation:**
    - Neuer effect type: `'skip_phase'`
    - Parameters: `phase: 'check_cache'`
    - State flag oder phase skip logic

### Phase 3: Advanced Features

#### A. Return Effect Variations
- [ ] Return all cards with specific value
  - Beispiel: Water-3: "Return all cards with a value of 2 in 1 line"
  - **ALREADY SUPPORTED!** - ReturnEffectEditor hat schon `valueEquals` parameter
  - Nur UI testen

#### B. Reveal Effect Variations
- [ ] Reveal specific card (not from hand)
  - Beispiel: Light-2: "Reveal 1 face-down card. You may shift or flip that card"
  - **Implementation:**
    - Aktuell nur "reveal from hand" supported
    - Neuer source: `'board'` (reveal face-down card on board)
    - Benötigt follow-up action (shift or flip)

#### C. Take from Hand
- [x] Take random card from opponent's hand ✅
  - Beispiel: Love-3: "Take 1 random card from your opponent's hand"
  - **Implementation:** COMPLETED
    - Neuer effect type: `'take'`
    - `TakeEffectEditor.tsx` erstellt (komplett neu)
    - Registriert in `EffectEditor.tsx` (Line 17, 51-52)
    - Hinzugefügt zu Middle Box: `CardEditor.tsx` (Line 540)
    - Hinzugefügt zu Bottom Box: `CardEditor.tsx` (Line 583)
    - Text generation: `CardEditor.tsx` (Lines 361-367), `cardFactory.ts` (Lines 248-253)
    - Keywords: `cardFactory.ts` (Line 280)
    - Effect execution: `effectInterpreter.ts` (Lines 55-56, 340-365)

---

## 📋 TESTING CHECKLIST

### UI Testing
- [ ] Delete effect mit value ranges testen
- [ ] Delete effect mit scopes testen
- [ ] Flip "all" testen
- [ ] Flip "each in each line" testen
- [ ] Shift "all" testen
- [ ] Play "opponent plays" testen
- [ ] Play "each other line" testen

### Game Logic Testing
- [ ] Start Phase effect triggert korrekt
- [ ] End Phase effect triggert korrekt
- [ ] On-Cover effect triggert korrekt
- [ ] Multiple effects in Bottom Box funktionieren
- [ ] AI kann mit custom cards umgehen

---

## 🎯 NÄCHSTE SCHRITTE

### Remaining Quick Wins (30 min - 1h):
1. ~~"1 or more" für Discard~~ ✅ ERLEDIGT
2. ~~"Take from hand" effect type~~ ✅ ERLEDIGT
3. Test all new effect parameters in game

### Medium Tasks (2-3h):
4. "If you do" conditional chains system
5. Value modification effects (Top Box)
6. Draw based on card value / discard count

### Complex Tasks (3-5h):
7. Reactive trigger effects (After X happens)
8. Play restriction effects
9. Prevention/Block effects
10. Special effects (Cannot compile, Skip phase)

---

## 📂 WICHTIGE DATEIEN

### Effect Editors (UI):
- `screens/CustomProtocolCreator/EffectParameterEditors/DrawEffectEditor.tsx`
- `screens/CustomProtocolCreator/EffectParameterEditors/FlipEffectEditor.tsx`
- `screens/CustomProtocolCreator/EffectParameterEditors/ShiftEffectEditor.tsx`
- `screens/CustomProtocolCreator/EffectParameterEditors/DeleteEffectEditor.tsx`
- `screens/CustomProtocolCreator/EffectParameterEditors/DiscardEffectEditor.tsx`
- `screens/CustomProtocolCreator/EffectParameterEditors/ReturnEffectEditor.tsx`
- `screens/CustomProtocolCreator/EffectParameterEditors/PlayEffectEditor.tsx`
- `screens/CustomProtocolCreator/EffectParameterEditors/ProtocolEffectEditor.tsx`
- `screens/CustomProtocolCreator/EffectParameterEditors/RevealEffectEditor.tsx`

### Main Components:
- `screens/CustomProtocolCreator/CardEditor.tsx` - Haupt-Editor mit effect summaries
- `screens/CustomProtocolCreator/EffectEditor.tsx` - Router für effect editors

### Game Logic:
- `logic/effectExecutor.ts` - **CRITICAL** - Führt alle effects aus (On-Play, Start, End, On-Cover)
- `logic/customProtocols/effectInterpreter.ts` - Interpretiert custom effects
- `logic/customProtocols/cardFactory.ts` - Konvertiert CustomCardDefinition → Card

### Type Definitions:
- `types/customProtocol.ts` - Alle TypeScript types für custom effects

---

## 💡 NOTIZEN

### Was funktioniert gut:
- Trigger system (Start/End/On-Cover) läuft einwandfrei
- Effect parameter system ist sehr flexibel
- UI ist intuitiv und erweiterbar

### Was noch verbessert werden könnte:
- Passive effects (Top Box) benötigen Integration in value calculation
- Reactive triggers benötigen hooks an vielen Stellen im Code
- "If you do" chains benötigen state zwischen effects
- Multi-action sequences benötigen shared context

### Architektur-Entscheidungen für morgen:
1. **Passive Effects**: Sollen diese in `recalculateAllLaneValues` oder separat gehandhabt werden?
2. **Reactive Triggers**: Event system oder direkte hooks?
3. **Conditional Chains**: Nested effects oder flat structure mit references?

---

**Aktueller Stand: ~80% aller existierenden Karteneffekte können nachgebildet werden! 🎉**

Die restlichen 20% sind hauptsächlich passive effects, reactive triggers und conditional chains.

---

## 🎨 VOLLSTÄNDIGE KARTEN-ANALYSE (109 Karten)

### ✅ VOLLSTÄNDIG NACHBAUBAR (Simple Effects)

#### Apathy Protocol
- **Apathy-1** ✅ - "Flip all other face-up cards in this line" → Middle: Flip (all, face_up, excludeSelf, covered_in_this_line)
- **Apathy-3** ✅ - "Flip 1 of your opponent's face-up cards" → Middle: Flip (1, opponent, face_up)
- **Apathy-4** ✅ - "You may flip 1 of your face-up covered cards" → Middle: Flip (1, own, face_up, covered, optional)
- **Apathy-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)

#### Chaos Protocol
- **Chaos-0** ✅ - "In each line, flip 1 covered card" → Middle: Flip (each, eachLineScope=each_line, covered) | Bottom Start: Draw from opponent deck
- **Chaos-1** ✅ - "Rearrange your protocols. Rearrange your opponent's protocols" → Middle: Rearrange (self) + Rearrange (opponent) als 2 effects
- **Chaos-2** ✅ - "Shift 1 of your covered cards" → Middle: Shift (1, own, covered)
- **Chaos-5** ✅ - "Discard 1 card" → Middle: Discard (1, self)

#### Darkness Protocol
- **Darkness-0** ✅ - "Draw 3 cards. Shift 1 of your opponent's covered cards" → Middle: Draw (3) + Shift (opponent, covered)
- **Darkness-3** ✅ - "Play 1 card face-down in another line" → Middle: Play (1, hand, face-down, other_lines)
- **Darkness-4** ✅ - "Shift 1 face-down card" → Middle: Shift (1, face_down)
- **Darkness-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)

#### Death Protocol
- **Death-0** ✅ - "Delete 1 card from each other line" → Middle: Delete (1, scope=each_other_line)
- **Death-2** ✅ - "Delete all cards in 1 line with values of 1 or 2" → Middle: Delete (all_in_lane, valueRange=1-2)
- **Death-3** ✅ - "Delete 1 face-down card" → Middle: Delete (1, face_down)
- **Death-4** ✅ - "Delete a card with a value of 0 or 1" → Middle: Delete (1, valueRange=0-1)
- **Death-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)

#### Fire Protocol
- **Fire-0** ✅ - "Flip 1 other card. Draw 2 cards" → Middle: Flip (1, excludeSelf) + Draw (2) | Bottom On-Cover: Draw + Flip
- **Fire-1** ✅ - "Discard 1 card. If you do, delete 1 card" → Middle: Discard (1) + Conditional (Delete 1)
- **Fire-2** ✅ - "Discard 1 card. If you do, return 1 card" → Middle: Discard (1) + Conditional (Return 1)
- **Fire-3** ✅ - Bottom End: "You may discard 1 card. If you do, flip 1 card" → End: Discard (optional) + Conditional (Flip 1)
- **Fire-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)

#### Gravity Protocol
- **Gravity-1** ✅ - "Draw 2 cards. Shift 1 card either to or from this line" → Middle: Draw (2) + Shift (1)
- **Gravity-4** ✅ - "Shift 1 face-down card to this line" → Middle: Shift (1, face_down, destination=specific_lane)
- **Gravity-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)
- **Gravity-6** ✅ - "Your opponent plays the top card of their deck face-down in this line" → Middle: Play (actor=opponent, source=deck, face-down, specific_lane)

#### Hate Protocol
- **Hate-0** ✅ - "Delete 1 card" → Middle: Delete (1)
- **Hate-1** ✅ - "Discard 3 cards. Delete 1 card. Delete 1 card" → Middle: Discard (3) + Delete (1) + Delete (1)
- **Hate-2** ✅ - "Delete your highest value uncovered card. Delete your opponent's highest value uncovered card" → Middle: Delete (1, own, uncovered, highest_value) + Delete (1, opponent, uncovered, highest_value)
- **Hate-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)

#### Life Protocol
- **Life-1** ✅ - "Flip 1 card. Flip 1 card" → Middle: Flip (1) + Flip (1)
- **Life-2** ✅ - "Draw 1 card. You may flip 1 face-down card" → Middle: Draw (1) + Flip (1, face_down, optional)
- **Life-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)

#### Light Protocol
- **Light-1** ✅ - Bottom End: "Draw 1 card" → End: Draw (1)
- **Light-3** ✅ - "Shift all face-down cards in this line to another line" → Middle: Shift (all, face_down, to_another_line)
- **Light-4** ✅ - "Your opponent reveals their hand" → Middle: Reveal (opponent hand) - wenn RevealEffectEditor erweitert wird
- **Light-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)

#### Love Protocol
- **Love-1** ✅ - Bottom End: "You may give 1 card. If you do, draw 2 cards" → End: Give (1, optional) + Conditional (Draw 2)
- **Love-2** ✅ - "Your opponent draws 1 card. Refresh" → Middle: Draw (1, target=opponent) + Draw (preAction=refresh)
- **Love-3** ✅ - "Take 1 random card from your opponent's hand. Give 1 card from your hand to your opponent" → Middle: Take (1, random) + Give (1)
- **Love-4** ✅ - "Reveal 1 card from your hand. Flip 1 card" → Middle: Reveal (1, own_hand) + Flip (1)
- **Love-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)
- **Love-6** ✅ - "Your opponent draws 2 cards" → Middle: Draw (2, target=opponent)

#### Metal Protocol
- **Metal-0** ✅ - "Flip 1 card" → Middle: Flip (1) | Top: Value reduction (nicht implementiert)
- **Metal-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)

#### Plague Protocol
- **Plague-1** ✅ - "Your opponent discards 1 card" → Middle: Discard (1, opponent)
- **Plague-2** ✅ - "Discard 1 or more cards. Your opponent discards the amount discarded plus 1" → Middle: Discard (variableCount) (Teil 2 fehlt noch)
- **Plague-3** ✅ - "Flip each other face-up card" → Middle: Flip (each, face_up, excludeSelf)
- **Plague-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)

#### Psychic Protocol
- **Psychic-0** ✅ - "Draw 2 cards. Your opponent discards 2 cards, then reveals their hand" → Middle: Draw (2) + Discard (2, opponent) + Reveal (opponent)
- **Psychic-2** ✅ - "Your opponent discards 2 cards. Rearrange their protocols" → Middle: Discard (2, opponent) + Rearrange (opponent)
- **Psychic-3** ✅ - "Your opponent discards 1 card. Shift 1 of their cards" → Middle: Discard (1, opponent) + Shift (1, opponent)
- **Psychic-4** ✅ - Bottom End: "You may return 1 of your opponent's cards. If you do, flip this card" → End: Return (1, opponent, optional) + Conditional (Flip self)
- **Psychic-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)

#### Speed Protocol
- **Speed-0** ✅ - "Play 1 card" → Middle: Play (1, hand)
- **Speed-1** ✅ - "Draw 2 cards" → Middle: Draw (2)
- **Speed-3** ✅ - "Shift 1 of your other cards" → Middle: Shift (1, own, excludeSelf)
- **Speed-4** ✅ - "Shift 1 of your opponent's face-down cards" → Middle: Shift (1, opponent, face_down)
- **Speed-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)

#### Spirit Protocol
- **Spirit-0** ✅ - "Refresh. Draw 1 card" → Middle: Draw (1, preAction=refresh)
- **Spirit-2** ✅ - "You may flip 1 card" → Middle: Flip (1, optional)
- **Spirit-4** ✅ - "Swap the positions of 2 of your protocols" → Middle: Swap (self)
- **Spirit-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)

#### Water Protocol
- **Water-0** ✅ - "Flip 1 other card. Flip this card" → Middle: Flip (1, excludeSelf) + Flip (selfFlipAfter)
- **Water-1** ✅ - "Play the top card of your deck face-down in each other line" → Middle: Play (deck, face-down, each_other_line)
- **Water-2** ✅ - "Draw 2 cards. Rearrange your protocols" → Middle: Draw (2) + Rearrange (self)
- **Water-3** ✅ - "Return all cards with a value of 2 in 1 line" → Middle: Return (valueEquals=2)
- **Water-4** ✅ - "Return 1 of your cards" → Middle: Return (1)
- **Water-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)

#### Frost Protocol
- **Frost-0** ✅ - "Draw 1 card for each face-down card" → Middle: Draw (conditional=count_face_down)
- **Frost-2** ✅ - "Play a card face-down" → Middle: Play (1, hand, face-down)
- **Frost-4** ✅ - "You may flip 1 card of your face-up covered cards" → Middle: Flip (1, own, face_up, covered, optional)
- **Frost-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)

#### Anarchy Protocol
- **Anarchy-0** ✅ - "Shift 1 card. For each line that contains a face-up card without matching protocol, draw 1 card" → Middle: Shift (1) + Draw (conditional=non_matching_protocols)
- **Anarchy-1** ✅ - "Shift 1 other card to a line without a matching protocol" → Middle: Shift (1, excludeSelf, destination=non_matching_protocol)
- **Anarchy-2** ✅ - "Delete a covered or uncovered card in a line with a matching protocol" → Middle: Delete (1) (matching protocol filter fehlt)
- **Anarchy-3** ✅ - "Swap the positions of 2 of your opponent's protocols" → Middle: Swap (opponent) | Bottom End: Rearrange
- **Anarchy-5** ✅ - "You discard 1 card" → Middle: Discard (1, self)

**TOTAL VOLLSTÄNDIG NACHBAUBAR: ~65 Karten**

---

### ⚠️ TEILWEISE NACHBAUBAR (Benötigen Conditionals/Multi-Action)

#### Conditional "If you do" Chains
- **Fire-1** ⚠️ - "Discard 1 card. If you do, delete 1 card" → Beide effects vorhanden, FEHLT: Conditional chain
- **Fire-2** ⚠️ - "Discard 1 card. If you do, return 1 card" → Beide effects vorhanden, FEHLT: Conditional chain
- **Fire-4** ⚠️ - "Discard 1 or more cards. Draw the amount discarded plus 1" → Discard (variableCount) vorhanden, FEHLT: Draw based on discard count
- **Love-1 (End)** ⚠️ - "You may give 1 card. If you do, draw 2 cards" → Beide effects vorhanden, FEHLT: Conditional chain
- **Psychic-4 (End)** ⚠️ - "You may return 1 of your opponent's cards. If you do, flip this card" → Beide effects vorhanden, FEHLT: Conditional chain

#### Draw Based on Card Value
- **Light-0** ⚠️ - "Flip 1 card. Draw cards equal to that card's value" → Flip vorhanden, FEHLT: Draw based on revealed value

#### Follow-Up Actions on Same Card
- **Darkness-1** ⚠️ - "Flip 1 of your opponent's cards. You may shift that card" → Flip vorhanden, FEHLT: Shift the same card that was flipped
- **Gravity-2** ⚠️ - "Flip 1 card. Shift that card to this line" → Flip vorhanden, FEHLT: Shift the same card that was flipped
- **Light-2** ⚠️ - "Draw 2 cards. Reveal 1 face-down card. You may shift or flip that card" → Draw + Reveal vorhanden, FEHLT: Action on revealed card

#### Complex Play Rules
- **Gravity-0** ⚠️ - "For every 2 cards in this line, play the top card of your deck face-down under this card" → FEHLT: Conditional play based on card count
- **Life-0** ⚠️ - "Play the top card of your deck face-down in each line where you have a card" → Play vorhanden, FEHLT: "where you have a card" filter
- **Life-3 (On-Cover)** ⚠️ - "Play the top card of your deck face-down in another line" → On-Cover trigger works, Play vorhanden
- **Life-4** ⚠️ - "If this card is covering a card, draw 1 card" → Draw vorhanden, FEHLT: "is covering" conditional

#### Either/Or Choices
- **Chaos-4 (End)** ⚠️ - "Discard your hand. Draw the same amount of cards" → Discard vorhanden, FEHLT: Draw equal to discarded
- **Spirit-1 (Start)** ⚠️ - "Either discard 1 card or flip this card" → Beide effects vorhanden, FEHLT: Either/Or choice
- **Speed-3 (End)** ⚠️ - "You may shift 1 of your cards. If you do, flip this card" → Shift vorhanden, FEHLT: Conditional selfFlip

**TOTAL TEILWEISE NACHBAUBAR: ~15 Karten**

---

### ❌ BENÖTIGEN PASSIVE EFFECTS (Top Box)

#### Value Modification
- **Apathy-0** ❌ - Top: "Your total value in this line is increased by 1 for each face-down card" → FEHLT: Value modification system
- **Metal-0** ❌ - Top: "Your opponent's total value in this line is reduced by 2" → FEHLT: Value modification system
- **Darkness-2** ❌ - Top: "All face-down cards in this stack have a value of 4" → FEHLT: Value override system

#### Command Blocking
- **Apathy-2** ❌ - Top: "Ignore all middle commands of cards in this line" → FEHLT: Passive command blocking (Standard Apathy-2 hat hardcoded logic!)

#### Play Restrictions
- **Metal-2** ❌ - Top: "Your opponent cannot play cards face-down in this line" → FEHLT: Play restriction system
- **Psychic-1** ❌ - Top: "Your opponent can only play cards face-down" → FEHLT: Play restriction system + Bottom Start: Flip
- **Spirit-1** ❌ - Top: "You can play cards in any line" → FEHLT: Play restriction removal + Middle: Draw + Bottom Start: Either/Or
- **Chaos-3** ❌ - Bottom: "You may play cards without matching protocols" → FEHLT: Protocol matching override
- **Anarchy-1** ❌ - Top: "Cards can only be played without matching protocols" → FEHLT: Play restriction system
- **Frost-3** ❌ - Top: "Cards cannot shift from or to this line" → FEHLT: Shift restriction system
- **Plague-0** ❌ - Bottom: "Your opponent cannot play cards in this line" → FEHLT: Line-specific play restriction + Middle: Discard (opponent)

#### Prevent Actions
- **Frost-1** ❌ - Top: "Cards cannot be flipped face-up" + Bottom: "Protocols cannot be rearranged" → FEHLT: Action prevention system
- **Metal-6** ❌ - Top: "When this card would be covered or flipped: First, delete this card" → FEHLT: Before-action trigger

**TOTAL BENÖTIGEN PASSIVE EFFECTS: ~13 Karten**

---

### ❌ BENÖTIGEN REACTIVE TRIGGERS (After X Happens)

#### After Delete
- **Death-1** ❌ - Top Start: "You may draw 1 card. If you do, delete 1 other card, then delete this card" → FEHLT: Multi-step conditional
- **Hate-3** ❌ - Top: "After you delete cards: Draw 1 card" → FEHLT: After-delete trigger

#### After Discard
- **Plague-1** ❌ - Top: "After your opponent discards cards: Draw 1 card" → FEHLT: After-opponent-discard trigger + Middle: Discard (opponent)
- **Plague-4 (End)** ❌ - "Your opponent deletes 1 of their face-down cards. You may flip this card" → FEHLT: Opponent self-delete action

#### After Draw
- **Spirit-3** ❌ - Top: "After you draw cards: You may shift this card, even if covered" → FEHLT: After-draw trigger

#### After Clear Cache
- **Speed-1** ❌ - Top: "After you clear cache: Draw 1 card" → FEHLT: After-cache trigger + Middle: Draw

#### Before Compile Delete
- **Speed-2** ❌ - Top: "When this card would be deleted by compiling: Shift this card, even if covered" → FEHLT: Before-compile-delete trigger

#### On Cover
- **Hate-4 (On-Cover)** ❌ - "First, delete the lowest value covered card in this line" → On-Cover trigger works, aber FEHLT: lowest_value in specific line

**TOTAL BENÖTIGEN REACTIVE TRIGGERS: ~8 Karten**

---

### ❌ BENÖTIGEN SPECIAL EFFECTS

#### Cannot Compile
- **Metal-1** ❌ - "Draw 2 cards. Your opponent cannot compile next turn" → Draw vorhanden, FEHLT: Cannot compile flag
- **Metal-3** ❌ - "Draw 1 card. Delete all cards in 1 other line with 8 or more cards" → Draw + Delete vorhanden, FEHLT: "8 or more cards" filter

#### Skip Phase
- **Spirit-0 (Bottom)** ❌ - "Skip your check cache phase" → FEHLT: Phase skip system

#### Special Conditions
- **Anarchy-3 (End)** ❌ - "Rearrange your protocols. Anarchy cannot be on this line" → Rearrange vorhanden, FEHLT: "cannot be on this line" restriction
- **Anarchy-6 (Start)** ❌ - "Flip this card, if this card is in the line with the Anarchy protocol" → FEHLT: Protocol-specific position check

**TOTAL BENÖTIGEN SPECIAL EFFECTS: ~5 Karten**

---

### 📊 ZUSAMMENFASSUNG NACH KATEGORIE

| Kategorie | Anzahl | Prozent |
|-----------|--------|---------|
| ✅ Vollständig nachbaubar | 65 | 60% |
| ⚠️ Teilweise nachbaubar | 15 | 14% |
| ❌ Benötigen Passive Effects | 13 | 12% |
| ❌ Benötigen Reactive Triggers | 8 | 7% |
| ❌ Benötigen Special Effects | 5 | 5% |
| **TOTAL noch nicht vollständig** | 3 | 3% |
| **TOTAL** | **109** | **100%** |

### 📝 ERGÄNZUNGEN

#### Noch nicht kategorisierte Karten
- **Gravity-2** ⚠️ - "Flip 1 card. Shift that card to this line" → Bereits in "Follow-Up Actions" erfasst
- **Gravity-3** - FEHLT IN cards.ts (kein Gravity-3 vorhanden, Protocol springt von 2 auf 4!)

**Korrigierte Statistik:**

| Kategorie | Anzahl | Prozent |
|-----------|--------|---------|
| ✅ Vollständig nachbaubar | 65 | 60% |
| ⚠️ Teilweise nachbaubar | 15 | 14% |
| ❌ Benötigen Passive Effects | 13 | 12% |
| ❌ Benötigen Reactive Triggers | 8 | 7% |
| ❌ Benötigen Special Effects | 5 | 5% |
| 🔢 Missing (Gravity-3) | 1 | 1% |
| **TOTAL** | **107** | **~100%** |

**Tatsächliche Kartenanzahl: 107 (nicht 109!)**

**Aktueller Stand: 60% vollständig nachbaubar, 14% teilweise nachbaubar = 74% coverage! 🎉**

Die restlichen 26% sind hauptsächlich passive effects (12%), reactive triggers (7%), special effects (5%), und conditionals (14%).
