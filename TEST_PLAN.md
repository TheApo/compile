# Test Plan - Actor/Owner Refactoring Validation

## Ziel
Validierung der Phase 1, 2 & 4 Fixes durch manuelle Test-Szenarien.

## Kritische Test-Szenarien

### Szenario 1: Psychic-3 Uncover während Opponent's Turn ✅ (Original Bug)
**Setup:**
1. Player's Turn
2. Player spielt Hate-0 (Delete 1 card)
3. Player löscht Opponent's face-down card
4. Darunter liegt Opponent's Psychic-3 (face-up) → wird uncovered

**Erwartetes Verhalten:**
- Psychic-3 triggert: "Your opponent discards 1 card. Shift 1 of their cards."
- **Player** (opponent von Psychic-3 owner) muss discarden
- **Opponent** (Psychic-3 owner) shiftet Player's card
- Log zeigt korrekte Actor-Namen
- Kein doppelter Shift

**Zu prüfen:**
- [ ] Player discardet (nicht Opponent)
- [ ] Opponent shiftet Player's card (nicht Player shiftet Player's card)
- [ ] Nur ein Shift (nicht zwei)
- [ ] Turn wechselt korrekt zurück nach Interrupt

**Betroffene Fixes:**
- cardResolver.ts Zeile 173 (select_any_opponent_card_to_shift)

---

### Szenario 2: Psychic-4 End Effect mit Uncover-Interrupt ✅ (Original Bug)
**Setup:**
1. Opponent's Turn - End Phase
2. Opponent's Psychic-4 triggert: "Return 1 of your opponent's cards. Flip this card."
3. Opponent wählt Player's Fire-2 zum Return
4. Fire-2 wird returned → darunter liegt Fire-4 (uncovered)
5. Fire-4 triggert Interrupt → Opponent muss discarden

**Erwartetes Verhalten:**
- Fire-4 Interrupt läuft ab (Opponent discardet 2 cards)
- **Danach** flippt Psychic-4 sich selbst (aus Queue)
- Kein Softlock

**Zu prüfen:**
- [ ] Opponent discardet für Fire-4
- [ ] Psychic-4 flippt sich danach
- [ ] Kein Softlock wenn Psychic-4 returned wird vor Flip
- [ ] Queue-System funktioniert korrekt

**Betroffene Fixes:**
- cardResolver.ts Zeile 538-579 (Psychic-4 flip queuing)
- actionUtils.ts Zeile 32-79 (handleChainedEffectsOnDiscard queue support)

---

### Szenario 3: Spirit-3 Draw während End Phase ✅ (Original Bug)
**Setup:**
1. Player's Turn - End Phase
2. Player hat Spirit-3 auf Board (face-up)
3. End Phase effect triggert → Player drawt 2 cards
4. Spirit-3 triggert nach Draw: "You may shift this card."

**Erwartetes Verhalten:**
- Player drawt 2 cards
- Spirit-3 shift-prompt erscheint in queuedActions
- **End Phase endet NICHT** vorzeitig
- Player kann lanes sehen und auswählen
- Click-Handler funktioniert (actionRequired.actor === 'player')

**Zu prüfen:**
- [ ] Player kann lanes klicken
- [ ] Phase zeigt korrekt "Your Turn" / "Player's Turn"
- [ ] End Phase endet nicht bevor queuedActions leer sind
- [ ] Turn wechselt erst nach allen queued actions

**Betroffene Fixes:**
- phaseManager.ts Zeile 107-124 (queuedActions check)
- GameScreen.tsx Zeile 247 (actionRequired.actor check)

---

### Szenario 4: Plague-2 mit Actor Propagation
**Setup:**
1. Player spielt Plague-2
2. Player discardet 2 cards
3. Opponent muss 3 cards discarden

**Erwartetes Verhalten:**
- Player discardet zuerst
- Opponent discardet danach
- Actor wird korrekt propagiert (nicht hardcoded 'player' oder 'opponent')

**Zu prüfen:**
- [ ] Richtige Discard-Reihenfolge
- [ ] Korrekte Actor-Namen in Logs
- [ ] Funktioniert auch wenn Plague-2 von Opponent gespielt wird

**Betroffene Fixes:**
- discardResolver.ts Zeile 162 (resolvePlague2Discard)
- discardResolver.ts Zeile 189 (resolvePlague2OpponentDiscard)

---

### Szenario 5: Darkness-1 Flip + Shift mit Interrupt
**Setup:**
1. Player spielt Darkness-1: "Flip 1 of your opponent's cards. You may shift that card."
2. Player flippt Opponent's face-down card
3. Geflippte Karte ist Fire-0 → triggert "Delete this card"
4. Fire-0 wird deleted (Interrupt)
5. Player sollte dann gefragt werden ob shift

**Erwartetes Verhalten:**
- Fire-0 Delete-Interrupt läuft korrekt
- Player wird danach gefragt ob shift (optional)
- Actor bleibt korrekt (Player shiftet, nicht Opponent)

**Zu prüfen:**
- [ ] Fire-0 delete läuft ab
- [ ] Player (nicht Opponent) shiftet die Karte
- [ ] cardOwner wird korrekt berechnet

**Betroffene Fixes:**
- laneResolver.ts Zeile 92 (shift_flipped_card_optional)

---

### Szenario 6: Death-2 / Metal-3 Lane Selection
**Setup:**
1. Player spielt Death-2: "Delete all cards in 1 line with values of 1 or 2"
2. Player wählt Lane

**Erwartetes Verhalten:**
- Richtige Actor-Namen in Logs
- Funktioniert auch während Interrupts

**Zu prüfen:**
- [ ] Korrekte Actor-Namen
- [ ] Lane-Targeting funktioniert

**Betroffene Fixes:**
- laneResolver.ts Zeile 141 (select_lane_for_death_2)
- laneResolver.ts Zeile 193 (select_lane_for_metal_3_delete)

---

### Szenario 7: Water-3 Lane Return
**Setup:**
1. Player spielt Water-3: "Select 1 line. All cards with a value of 2 in that line are returned."
2. Player wählt Lane

**Erwartetes Verhalten:**
- Richtige Actor-Namen
- Alle Value-2 cards werden returned

**Zu prüfen:**
- [ ] Korrekte Actor-Namen
- [ ] Return funktioniert für beide Spieler's cards in der Lane

**Betroffene Fixes:**
- laneResolver.ts Zeile 338 (select_lane_for_water_3)

---

### Szenario 8: Plague-4 Delete + Flip mit Uncover
**Setup:**
1. Opponent's Turn - End Phase
2. Opponent's Plague-4 triggert: "Your opponent deletes 1 of their face-down cards. You may flip this card."
3. Player (opponent) löscht face-down card
4. Darunter liegt eine face-up card → Uncover-Interrupt
5. Opponent sollte dann gefragt werden ob Plague-4 flip

**Erwartetes Verhalten:**
- Player löscht seine eigene card
- Uncover-Interrupt läuft ab
- **Opponent** (Plague-4 owner) wird gefragt ob flip
- Nicht der turn-player, sondern der card-owner

**Zu prüfen:**
- [ ] Opponent (card owner) wird für flip gefragt
- [ ] Nicht turn-player wird gefragt
- [ ] sourceCardOwner wird korrekt ermittelt

**Betroffene Fixes:**
- cardResolver.ts Zeile 511 (plague_4_player_flip_optional actor fix)

---

### Szenario 9: internalReturnCard mit Interrupt
**Setup:**
1. Player spielt Psychic-4 (End effect)
2. Returns Opponent's card
3. Uncover-Interrupt passiert
4. Log sollte korrekten Actor zeigen

**Erwartetes Verhalten:**
- Log zeigt "Player returns Opponent's [card] to their hand"
- Auch während Interrupt korrekt

**Zu prüfen:**
- [ ] Korrekte Actor-Namen in Log
- [ ] Auch bei Interrupts korrekt

**Betroffene Fixes:**
- actionUtils.ts Zeile 215 (internalReturnCard actor fix)

---

## Test-Ausführung

### Manuelle Tests (Browser)
1. `npm run dev` starten
2. Gegen AI spielen (Normal Difficulty)
3. Szenarien nachstellen durch gezieltes Spielen
4. Logs und Verhalten beobachten

### Zu beobachten:
- ✅ Korrekte Actor-Namen in Logs
- ✅ Keine Softlocks
- ✅ Turn-Wechsel funktioniert korrekt
- ✅ Queue-System funktioniert
- ✅ Interrupt-System funktioniert
- ✅ Click-Handler reagieren korrekt

---

## Test-Ergebnisse

### Durchgeführte Tests:
- [ ] Szenario 1: Psychic-3 Uncover
- [ ] Szenario 2: Psychic-4 End Effect
- [ ] Szenario 3: Spirit-3 End Phase
- [ ] Szenario 4: Plague-2 Actor
- [ ] Szenario 5: Darkness-1 Interrupt
- [ ] Szenario 6: Death-2/Metal-3
- [ ] Szenario 7: Water-3
- [ ] Szenario 8: Plague-4 owner check
- [ ] Szenario 9: Return mit Interrupt

### Gefundene Bugs:
(Hier eintragen wenn Tests fehlschlagen)

### Notizen:
(Beobachtungen während Tests)
