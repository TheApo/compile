# 🐛 Debug Tool - Schnellanleitung

## Was ist das Debug Tool?

Ein eingebautes Tool zum **sofortigen Laden** von Test-Szenarien, um die Actor/Owner-Fixes zu validieren.

---

## 🚀 Wie benutze ich es?

### 1. Spiel starten
```bash
npm run dev
```

### 2. Debug-Panel öffnen
- Unten rechts im Spiel erscheint ein **roter "🐛 DEBUG"** Button
- Klicke darauf um das Debug-Panel zu öffnen

### 3. Test-Szenario laden
- Im Debug-Panel siehst du alle vordefinierten Szenarien
- Klicke auf **"Load Scenario"** bei einem Szenario
- Der Coin Flip wird **automatisch übersprungen**
- Das Spiel lädt **sofort** den Board-State für dieses Szenario

### 4. Testen
- Spiele die Situation durch
- Beobachte:
  - ✅ Korrekte Actor-Namen in Logs (drücke "Log" Button)
  - ✅ Keine Softlocks
  - ✅ Turn-Wechsel korrekt
  - ✅ Click-Handler funktionieren

---

## 📋 Verfügbare Szenarien

### Szenario 1: Psychic-3 Uncover
**Was passiert:**
- Player hat Hate-0 in Hand
- Opponent hat face-down card mit Psychic-3 darunter
- Player löscht die face-down card → Psychic-3 wird uncovered

**Was testen:**
- ✅ Player discardet (nicht Opponent)
- ✅ Opponent shiftet Player's card
- ✅ Nur ein Shift (nicht zwei)

---

### Szenario 2: Psychic-4 End Effect
**Was passiert:**
- Opponent's Turn, End Phase
- Opponent's Psychic-4 triggert
- Opponent returnt Player's Fire-2
- Darunter liegt Fire-4 → Interrupt

**Was testen:**
- ✅ Fire-4 Interrupt läuft (Opponent discardet 2 cards)
- ✅ Psychic-4 flippt sich danach (aus Queue)
- ✅ Kein Softlock

---

### Szenario 3: Spirit-3 End Phase
**Was passiert:**
- Player's Spirit-3 auf Board
- End Phase → Spirit-3 triggert draw
- Spirit-3 shift-prompt sollte in Queue

**Was testen:**
- ✅ Player kann lanes klicken
- ✅ Phase zeigt "Your Turn"
- ✅ End Phase endet nicht vorzeitig

---

### Szenario 4: Plague-2 Actor
**Was passiert:**
- Player spielt Plague-2 aus Hand
- Player discardet 2 cards
- Opponent muss 3 discarden

**Was testen:**
- ✅ Richtige Reihenfolge
- ✅ Korrekte Actor-Namen in Logs

---

### Szenario 5: Darkness-1 Interrupt
**Was passiert:**
- Player spielt Darkness-1
- Player flippt Opponent's Fire-0
- Fire-0 delete-interrupt triggert

**Was testen:**
- ✅ Fire-0 wird deleted
- ✅ Player (nicht Opponent) shiftet danach

---

### Szenario 8: Plague-4 Owner Check
**Was passiert:**
- Opponent's Turn, End Phase
- Plague-4 triggert
- Player deletet face-down card
- Opponent (card owner) sollte für flip gefragt werden

**Was testen:**
- ✅ Opponent wird für flip gefragt (nicht turn player)

---

## 📝 Test-Ergebnisse dokumentieren

Nach jedem Test:
1. Öffne `TEST_PLAN.md`
2. Hake das Szenario ab: `- [x] Szenario X`
3. Wenn Bugs gefunden:
   - Trage sie unter "Gefundene Bugs" ein
   - Beschreibe was falsch lief
   - Notiere Log-Auszüge

---

## 🔧 Technische Details

### Dateien:
- `utils/testScenarios.ts` - Szenario-Definitionen
- `components/DebugPanel.tsx` - UI-Komponente
- `screens/GameScreen.tsx` - Integration
- `hooks/useGameState.ts` - `setupTestScenario` Funktion

### Funktionsweise:
1. Debug-Panel ruft `setupTestScenario(scenarioSetup)` auf
2. `scenarioSetup` ist eine Funktion die den GameState modifiziert
3. Board wird mit dem neuen State aktualisiert
4. Du kannst sofort weiterspielen

---

## 💡 Tipps

1. **Logs ansehen**: Klicke immer auf "Log" Button um Actor-Namen zu prüfen
2. **Mehrfach testen**: Lade Szenarien mehrmals um Konsistenz zu prüfen
3. **Kombinationen**: Nach einem Szenario kannst du weiterspielen und andere Karten spielen
4. **ESC zum Schließen**: Debug-Panel schließt sich auch mit ESC

---

## ⚠️ Bekannte Einschränkungen

- Szenarien setzen den GameState direkt - keine Animation
- Coin Flip wird übersprungen (immer Player startet)
- AI reagiert sofort wenn Opponent am Zug ist
- Deck-Inhalte sind minimalistisch

---

---

## 🔥 Keyboard Shortcuts (während des Spiels)

Drücke **Ctrl + Shift + [Taste]** für schnellen Szenario-Load:

| Shortcut | Szenario | Beschreibung |
|----------|----------|--------------|
| **Ctrl+Shift+U** | **Death-1 Uncover Test** | 🆕 **NEUER TEST für Bug-Fix!** |
| Ctrl+Shift+P | Speed-0 Interrupt | Speed-0 Interrupt-Test |
| Ctrl+Shift+L | Speed-1 Trigger | Speed-1 Discard Trigger |
| Ctrl+Shift+F | Fire On-Cover | Fire-0 On-Cover Bug-Test |
| Ctrl+Shift+S | Speed-2 Control | Speed-2 + Control Mechanic |

### 🆕 Death-1 Uncover Test (Ctrl+Shift+U)

**Szenario-Datei:** `utils/testScenarios.ts` → `scenario11_Death1UncoverTest`

**Was passiert:**
- **Opponent** hat Death-1 in Lane 0 (Start Phase)
- **Player** hat in Lane 0:
  - Speed-3 (face-up, **covered** - unten)
  - Light-0 (face-up, **uncovered** - oben)
- AI wird Death-1 aktivieren und Light-0 löschen
- Speed-3 wird **uncovered** → Middle command sollte triggern!

**Was zu testen:**
- ✅ **Speed-3 Effekt triggert** (Log: "Speed-3 is uncovered and its effects are re-triggered")
- ✅ **Player wird gefragt eine eigene Karte zu shiften** (Action Required)
- ✅ **Kein Softlock** (das war der Bug!)
- ✅ Shift funktioniert normal
- ✅ Turn endet korrekt

**Erwartete Log-Sequenz:**
```
1. Start Effect: Death-1 triggers.
2. Death-1: Opponent chooses to draw and delete.
3. Death-1: Opponent deletes Player's Light-0 and the Death-1 card itself.
4. Speed-3 is uncovered and its effects are re-triggered.
5. Action: Select one of your cards to shift  ← MUSS ERSCHEINEN!
```

**⚠️ VORHER (Bug):** Speed-3 wurde uncovered, aber Action wurde ignoriert → Kein Shift-Prompt!
**✅ NACHHER (Fix in `cardResolver.ts:333-337`):** Speed-3 uncover setzt actionRequired → Wird NICHT mehr gelöscht → Shift-Prompt erscheint!

---

## 🎯 Nächste Schritte

1. Starte `npm run dev`
2. **Drücke Ctrl+Shift+D** um Debug Button sichtbar zu machen
3. Klicke auf 🐛 DEBUG
4. Lade Szenario 1 **ODER** drücke **Ctrl+Shift+U** für den neuen Death-1 Test
5. Teste und dokumentiere in TEST_PLAN.md
6. Wiederhole für alle Szenarien

Viel Erfolg beim Testen! 🚀
