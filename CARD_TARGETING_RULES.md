# Card Targeting Rules - Compile Kartenspiel

## GRUNDREGEL
**NUR UNCOVERED (oberste) Karten dürfen targetiert werden, AUSSER die Karte sagt explizit etwas anderes!**

---

## Definitionen

- **UNCOVERED**: Die oberste Karte in einer Lane (Position `lane[lane.length - 1]`)
- **COVERED**: Alle Karten unter der obersten Karte (Position `0` bis `lane.length - 2`)
- **ALL**: Alle Karten in der Lane, egal ob covered oder uncovered

---

## DELETE Effekte

| Karte | Kartentext | Action Type | Regel | AI Handler | Status |
|-------|------------|-------------|-------|------------|--------|
| Anarchy-2 | "Delete a covered or uncovered card in a line with matching protocol" | `select_card_to_delete_for_anarchy_2` | COVERED OR UNCOVERED (SPEZIAL!) | case `select_card_to_delete_for_anarchy_2` | ✅ KORREKT |
| Death-0 | "Delete 1 card from each other line" | `select_cards_to_delete` | UNCOVERED only | case `select_cards_to_delete` | ✅ KORREKT |
| Death-1 | "Delete 1 card" | `select_card_to_delete_for_death_1` | UNCOVERED only | case `select_card_to_delete_for_death_1` | ✅ KORREKT |
| Death-2 | "Delete **all** cards in 1 line with values 1 or 2" | `select_lane_for_death_2` | ALL in lane (Spezialfall!) | Lane-basiert (resolver) | ✅ KORREKT |
| Death-3 | "Delete 1 face-down card" | `select_face_down_card_to_delete` | UNCOVERED face-down only | case `select_face_down_card_to_delete` | ✅ FIXED |
| Death-4 | "Delete a card with value 0 or 1" | `select_card_from_other_lanes_to_delete` | UNCOVERED only | case `select_card_from_other_lanes_to_delete` | ✅ KORREKT |
| Hate-0 | "Delete 1 card with value 0-1" | `select_low_value_card_to_delete` | UNCOVERED value 0-1 only | case `select_low_value_card_to_delete` | ✅ KORREKT |
| Hate-1 | "Delete 1 card. Delete 1 card." | `select_cards_to_delete` | UNCOVERED (2x) | case `select_cards_to_delete` | ✅ KORREKT |
| Hate-2 | "Delete highest value **uncovered** card" | Auto-delete | UNCOVERED (explizit!) | Automatisch in effect file | ✅ KORREKT |
| Metal-3 | "Delete **all** cards in 1 line with 8+" | `select_lane_for_metal_3_delete` | ALL in lane (Spezialfall!) | case `select_lane_for_metal_3_delete` | ✅ KORREKT |

---

## FLIP Effekte

| Karte | Kartentext | Action Type | Regel | AI Handler | Status |
|-------|------------|-------------|-------|------------|--------|
| Apathy-3 | "Flip 1 of opponent's face-up cards" | `select_opponent_face_up_card_to_flip` | UNCOVERED face-up only | case `select_opponent_face_up_card_to_flip` | ✅ KORREKT |
| Apathy-4 | "Flip 1 of your face-up **covered** cards" | `select_own_face_up_covered_card_to_flip` | COVERED face-up (SPEZIAL!) | case `select_own_face_up_covered_card_to_flip` | ✅ KORREKT |
| Chaos-0 | "In each line, flip 1 **covered** card" | `select_covered_card_to_flip_for_chaos_0` | COVERED (SPEZIAL!) | case `select_covered_card_to_flip_for_chaos_0` | ✅ KORREKT |
| Darkness-1 | "Flip 1 of your opponent's cards" | `select_opponent_card_to_flip` | UNCOVERED only | case `select_opponent_card_to_flip` | ✅ KORREKT |
| Fire-0 | "Flip 1 other card" | `select_any_other_card_to_flip` | UNCOVERED (except source) | case `select_any_other_card_to_flip` | ✅ KORREKT |
| Fire-3 | "Flip 1 card" | `select_card_to_flip_for_fire_3` | UNCOVERED only | case `select_card_to_flip_for_fire_3` | ✅ KORREKT |
| Gravity-2 | "Flip 1 card" | `select_card_to_flip_and_shift_for_gravity_2` | UNCOVERED only | case `select_card_to_flip_and_shift_for_gravity_2` | ✅ KORREKT |
| Life-1 | "Flip 1 card. Flip 1 card." | `select_any_card_to_flip` | UNCOVERED only (2x) | case `select_any_card_to_flip` | ✅ KORREKT |
| Life-2 | "You may flip 1 face-down card" | `select_any_face_down_card_to_flip_optional` | UNCOVERED face-down only | case `select_any_face_down_card_to_flip_optional` | ✅ KORREKT |
| Light-0 | "Flip 1 card" | `select_card_to_flip_for_light_0` | UNCOVERED only | case `select_card_to_flip_for_light_0` | ✅ KORREKT |
| Light-2 | "Reveal 1 face-down card" | `select_face_down_card_to_reveal_for_light_2` | UNCOVERED face-down only | case `select_face_down_card_to_reveal_for_light_2` | ✅ FIXED |
| Love-4 | "Flip 1 card" | `select_any_card_to_flip` | UNCOVERED only | case `select_any_card_to_flip` | ✅ KORREKT |
| Metal-0 | "Flip 1 card" | `select_any_card_to_flip` | UNCOVERED only | case `select_any_card_to_flip` | ✅ KORREKT |
| Plague-3 | "Flip each other face-up card" | Auto-flip | Auto-flip ALL uncovered | Automatisch in effect file | ✅ KORREKT |
| Spirit-2 | "You may flip 1 card" | `select_any_card_to_flip_optional` | UNCOVERED only | case `select_any_card_to_flip_optional` | ✅ KORREKT |
| Water-0 | "Flip 1 other card" | `select_any_other_card_to_flip_for_water_0` | UNCOVERED (except source) | case `select_any_other_card_to_flip_for_water_0` | ✅ KORREKT |

---

## SHIFT Effekte

| Karte | Kartentext | Action Type | Regel | AI Handler | Status |
|-------|------------|-------------|-------|------------|--------|
| Anarchy-0 | "Shift 1 card. For each line that contains a face-up card without matching protocol, draw 1 card" | `select_card_to_shift_for_anarchy_0` | UNCOVERED only | case `select_card_to_shift_for_anarchy_0` | ✅ KORREKT |
| Anarchy-1 | "Shift 1 other card to a line without a matching protocol" | `select_card_to_shift_for_anarchy_1` | UNCOVERED only (non-matching!) | case `select_card_to_shift_for_anarchy_1` | ✅ KORREKT |
| Chaos-2 | "Shift 1 of your **covered** cards" | `select_own_covered_card_to_shift` | COVERED (SPEZIAL!) | case `select_own_covered_card_to_shift` | ✅ KORREKT |
| Darkness-0 | "Shift 1 opponent's **covered** cards" | `select_opponent_covered_card_to_shift` | COVERED (SPEZIAL!) | case `select_opponent_covered_card_to_shift` | ✅ KORREKT |
| Darkness-4 | "Shift 1 face-down card" | `select_face_down_card_to_shift_for_darkness_4` | UNCOVERED face-down only | case `select_face_down_card_to_shift_for_darkness_4` | ✅ KORREKT |
| Gravity-0 | "Shift this card" | `select_lane_for_shift` | Verschiebt UNCOVERED (self) | case `select_lane_for_shift` | ✅ KORREKT |
| Gravity-1 | "Shift 1 card to/from this line" | `select_card_to_shift_for_gravity_1` | UNCOVERED only | case `select_card_to_shift_for_gravity_1` | ✅ FIXED |
| Gravity-4 | "Shift 1 face-down card to this line" | `select_face_down_card_to_shift_for_gravity_4` | UNCOVERED face-down only | case `select_face_down_card_to_shift_for_gravity_4` | ✅ KORREKT |
| Light-2 | "Shift revealed card" | `select_lane_to_shift_revealed_card_for_light_2` | Verschiebt enthüllte | case `select_lane_to_shift_revealed_card_for_light_2` | ✅ KORREKT |
| Light-3 | "Shift **all** face-down cards in line" | `select_lane_to_shift_cards_for_light_3` | ALL face-down (SPEZIAL!) | case `select_lane_to_shift_cards_for_light_3` | ✅ KORREKT |
| Psychic-1 | "Shift 1 opponent card" | `select_any_opponent_card_to_shift` | UNCOVERED only | case `select_any_opponent_card_to_shift` | ✅ FIXED |
| Psychic-3 | "Shift 1 of their face-down cards" | `select_opponent_face_down_card_to_shift` | UNCOVERED face-down only | case `select_opponent_face_down_card_to_shift` | ✅ FIXED |
| Speed-2 | "Shift 1 of your other cards" | `select_own_other_card_to_shift` | UNCOVERED (except source) | case `select_own_other_card_to_shift` | ✅ FIXED |
| Speed-3 | "Shift 1 of your other cards" | `select_own_card_to_shift_for_speed_3` | UNCOVERED only | case `select_own_card_to_shift_for_speed_3` | ✅ KORREKT |

---

## RETURN Effekte

| Karte | Kartentext | Action Type | Regel | AI Handler | Status |
|-------|------------|-------------|-------|------------|--------|
| Fire-2 | "Return 1 card" | `select_card_to_return` | UNCOVERED only | case `select_card_to_return` | ✅ KORREKT |
| Psychic-4 | "Return 1 opponent's card" | `select_opponent_card_to_return` | UNCOVERED only | case `select_opponent_card_to_return` | ✅ KORREKT |
| Water-4 | "Return 1 of your cards" | `select_own_card_to_return_for_water_4` | UNCOVERED only | case `select_own_card_to_return_for_water_4` | ✅ KORREKT |

---

## SPEZIALFÄLLE (explizit COVERED oder ALL erlaubt)

1. **Anarchy-2**: "Delete a **covered or uncovered** card in a line with matching protocol" → COVERED ODER UNCOVERED erlaubt
2. **Apathy-4**: "Flip 1 of your face-up **covered** cards" → COVERED erlaubt
3. **Chaos-0**: "In each line, flip 1 **covered** card" → COVERED erlaubt
4. **Chaos-2**: "Shift 1 of your **covered** cards" → COVERED erlaubt
5. **Darkness-0**: "Shift 1 of opponent's **covered** cards" → COVERED erlaubt
6. **Death-2**: "Delete **all** cards in 1 line with values 1 or 2" → ALL in lane
7. **Light-3**: "Shift **all** face-down cards in this line" → ALL face-down
8. **Metal-3**: "Delete **all** cards in 1 line with 8+" → ALL in lane
9. **Plague-3**: "Flip **each** other face-up card" → Auto-flip ALL uncovered

---

## Bugs gefunden und gefixt:

### TARGETING BUGS (covered statt uncovered)
1. ✅ **Death-3 (hardImproved.ts:2146-2182)**: Iterierte über ALLE Karten statt nur UNCOVERED → **FIXED**
   - Vorher: `lane.forEach(c => ...)`
   - Jetzt: `lane[lane.length - 1]` (nur oberste Karte)

### RETURN TYPE BUGS (falscher Action Type)
2. ✅ **Light-2 reveal (hardImproved.ts:1262)**: Gab `deleteCard` statt `flipCard` zurück → **FIXED**
3. ✅ **Gravity-1 (hardImproved.ts:1675)**: Gab `flipCard` statt `shiftCard` zurück → **FIXED**
4. ✅ **select_opponent_face_down_card_to_shift (hardImproved.ts:1923)**: Gab `deleteCard` statt `shiftCard` zurück → **FIXED**
5. ✅ **select_any_opponent_card_to_shift (hardImproved.ts:1941)**: Gab `deleteCard` statt `shiftCard` zurück → **FIXED**
6. ✅ **select_own_other_card_to_shift (hardImproved.ts:2201)**: Gab `deleteCard` statt `shiftCard` zurück → **FIXED**
7. ✅ **select_opponent_covered_card_to_shift (hardImproved.ts:2467)**: Gab `deleteCard` statt `shiftCard` zurück → **FIXED**

---

## Zusammenfassung der Fixes:

**7 kritische Bugs in hardImproved.ts gefunden und behoben:**
- 1x Targeting-Bug: Death-3 targetierte covered Karten
- 6x Return-Type-Bugs: Falsche Action-Types (deleteCard/flipCard statt shiftCard/flipCard)

**Alle 84 Karten systematisch gegen Kartentexte geprüft:**
- ✅ **DELETE** (10 Karten): Alle korrekt - nur UNCOVERED, außer Anarchy-2 (covered/uncovered), Death-2 & Metal-3 (ganze Lane)
- ✅ **FLIP** (15 Karten): Alle korrekt - nur UNCOVERED, außer Apathy-4 & Chaos-0 (covered)
- ✅ **SHIFT** (13 Karten): Alle korrekt - nur UNCOVERED, außer Chaos-2 & Darkness-0 (covered), Light-3 (all)
- ✅ **RETURN** (3 Karten): Alle korrekt - nur UNCOVERED

**Alle Kartentexte mit "all", "each", "covered" wurden als Spezialfälle identifiziert und sind korrekt implementiert.**

**Neu hinzugefügt:**
- Anarchy-Protokoll (Anarchy-0, Anarchy-1, Anarchy-2)
- Chaos-Protokoll (Chaos-0, Chaos-2)
- Love-Protokoll (Love-4)
- Metal-Protokoll (Metal-0)
- Spirit-Protokoll (Spirit-1, Spirit-2 war bereits vorhanden)

---

## Verwendung dieser Dokumentation

Wenn du in Zukunft neue Karten hinzufügst oder AI-Handler änderst:

1. **Prüfe den Kartentext**: Steht "1 card" = UNCOVERED, steht "all" oder "covered" = Spezialfall
2. **Prüfe die Effect-Datei**: Nur zum Zählen von Targets, NICHT zum Filtern
3. **Prüfe die UI**: Muss nur UNCOVERED anklickbar machen (außer Spezialfälle)
4. **Prüfe die AI**: Muss nur `lane[lane.length - 1]` targetieren (außer Spezialfälle)
5. **Prüfe den Action-Type**: `flipCard`, `shiftCard`, `deleteCard`, `returnCard` - nicht verwechseln!
