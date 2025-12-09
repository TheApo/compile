# Main 2 Protokoll Hinzufügen - Checkliste

## Aktueller Stand Main 2
- **Chaos** (existiert)
- **Smoke** (neu hinzugefügt)

---

## Checkliste für jedes neue Protokoll

### 1. Analyse der Karten
- [ ] Alle 6 Karten (Value 0-5) durchgehen
- [ ] Für jede Karte dokumentieren:
  - Welche Effekte hat sie (Top/Middle/Bottom)?
  - Original-Text notieren
  - Existiert der Effekt-Typ bereits im Editor?
  - Wenn nicht: Was genau muss erweitert werden?
- [ ] Zusammenfassung erstellen: Welche Karten funktionieren sofort, welche brauchen Erweiterungen

### 2. Erweiterungen implementieren (falls nötig)

#### 2.1 Types erweitern
- [ ] `types/customProtocol.ts`
  - Neue Parameter zu bestehenden EffectParams hinzufügen
  - Oder neuen EffectParams Type erstellen
  - Alle Optionen/Enums erweitern

#### 2.2 Logik/Executors erweitern
- [ ] `logic/effects/actions/[action]Executor.ts`
  - Neuen Handler für neue Mechanik
  - Edge Cases behandeln (keine Targets → Skip mit Log)
  - NICHT effectInterpreter aufblähen - in Executor-Klasse auslagern!

#### 2.3 EffectInterpreter prüfen
- [ ] `logic/customProtocols/effectInterpreter.ts`
  - Verweist auf Executor-Klassen
  - Bei neuer Action: Import + Case hinzufügen
  - Logik bleibt in den Executor-Klassen!

#### 2.4 Textgenerierung (cardFactory)
- [ ] `logic/customProtocols/cardFactory.ts`
  - Neuen Case für Action/Parameter
  - Text muss exakt dem Original-Kartentext entsprechen
  - Alle Varianten abdecken (optional, count, owner, etc.)

#### 2.5 Resolver erweitern
- [ ] `logic/game/resolvers/laneResolver.ts` - Lane-Auswahl
- [ ] `logic/game/resolvers/cardResolver.ts` - Karten-Auswahl
- [ ] `logic/game/resolvers/miscResolver.ts` - Sonstige Actions
- [ ] Validierung von Eingaben
- [ ] Korrekte State-Übergänge

#### 2.6 AI erweitern - BEIDE!
- [ ] `logic/ai/easy.ts`
  - Case für neue actionRequired.type
  - Einfache aber funktionierende Logik
  - Alle neuen Parameter berücksichtigen (z.B. validLanes)
- [ ] `logic/ai/normal.ts`
  - Case für neue actionRequired.type
  - Intelligentere Entscheidungslogik
  - Scoring/Bewertung wo sinnvoll
  - Alle neuen Parameter berücksichtigen

#### 2.7 UI/GameBoard erweitern
- [ ] `components/GameBoard.tsx`
  - `getLanePlayability()` - Lanes highlighten
  - `getLaneShiftTargetability()` - Shift-Ziele
  - `getLaneEffectTargetability()` - Effekt-Ziele
  - Neue actionRequired.type Cases
- [ ] `components/PhaseController.tsx`
  - Beschreibungstext für neue Actions
- [ ] `hooks/useGameState.ts`
  - Falls neue Resolver-Aufrufe nötig

#### 2.8 Effect Editor UI erweitern - WICHTIG!
- [ ] `screens/CustomProtocolCreator/EffectParameterEditors/[Action]EffectEditor.tsx`
  - Neue Dropdown-Optionen
  - Neue Checkboxen/Inputs
  - Bedingte Felder (wenn Option X, zeige Feld Y)
  - Preview muss korrekt sein
- [ ] `screens/CustomProtocolCreator/EffectEditor.tsx`
  - Falls neue Action: zu Action-Liste hinzufügen
  - renderEffectParams() erweitern

### 3. Protocol JSON erstellen
- [ ] Datei: `custom_protocols/[name]_custom_protocol.json`
- [ ] Struktur:
```json
{
  "id": "[name]-custom-001",
  "name": "[Name]",
  "description": "...",
  "author": "System",
  "createdAt": "YYYY-MM-DDTHH:mm:ss.000Z",
  "color": "#XXXXXX",
  "pattern": "radial|solid|dual-radial|chaos|grid|...",
  "cards": [ ... 6 Karten ... ],
  "category": "Main 2"
}
```
- [ ] Jeden Effekt korrekt in JSON übersetzen
- [ ] IDs eindeutig vergeben

### 4. System-Registrierung
- [ ] `screens/CustomProtocolCreator/ProtocolList.tsx`
  - ID zu `SYSTEM_PROTOCOL_IDS` Array hinzufügen (alphabetisch sortiert)
- [ ] `logic/customProtocols/loadDefaultProtocols.ts`
  - Import Statement hinzufügen
  - `addCustomProtocol()` Aufruf hinzufügen

### 5. Testszenarien erstellen
- [ ] `utils/testScenarios.ts` - Zwei Szenarien hinzufügen:

**Szenario A: Player Playground**
- Player hat das Protokoll
- Player hat alle 6 Karten (0-5) auf der Hand
- Board-Setup für alle Effekte vorbereiten
- Player's Turn, Action Phase

**Szenario B: AI Test**
- Opponent (AI) hat das Protokoll
- AI hat alle 6 Karten auf der Hand
- Board-Setup für AI-Aktionen
- Opponent's Turn, Action Phase

- [ ] Beide Szenarien zum `allScenarios` Array hinzufügen

### 6. Build & Test
- [ ] `npm run build` - Keine Fehler, keine TypeScript-Warnings
- [ ] Manuell testen im Browser:
  - [ ] Jede Karte einzeln im Playground spielen
  - [ ] Effekte funktionieren wie erwartet
  - [ ] AI-Szenario durchspielen - AI macht sinnvolle Züge
  - [ ] Im Editor: Protokoll öffnen, Text-Preview für alle Karten prüfen
  - [ ] Im Editor: Neues Protokoll erstellen mit gleichen Effekten möglich

---

## Wichtige Dateien - Schnellreferenz

### Types
- `types/customProtocol.ts` - Alle Effect Parameter Types

### Logik (Executors)
- `logic/effects/actions/flipExecutor.ts`
- `logic/effects/actions/shiftExecutor.ts`
- `logic/effects/actions/deleteExecutor.ts`
- `logic/effects/actions/drawExecutor.ts`
- `logic/effects/actions/playExecutor.ts`
- `logic/effects/actions/returnExecutor.ts`
- `logic/effects/actions/discardExecutor.ts`

### Interpreter & Factory
- `logic/customProtocols/effectInterpreter.ts` - Delegiert an Executors
- `logic/customProtocols/cardFactory.ts` - Textgenerierung

### Resolver
- `logic/game/resolvers/laneResolver.ts`
- `logic/game/resolvers/cardResolver.ts`
- `logic/game/resolvers/miscResolver.ts`

### AI
- `logic/ai/easy.ts` - Einfache AI
- `logic/ai/normal.ts` - Normale AI

### UI Components
- `components/GameBoard.tsx` - Lane/Card Highlighting
- `components/PhaseController.tsx` - Action Descriptions

### Editor
- `screens/CustomProtocolCreator/EffectEditor.tsx` - Haupt-Editor
- `screens/CustomProtocolCreator/EffectParameterEditors/*.tsx` - Parameter-Editoren

### Registration
- `screens/CustomProtocolCreator/ProtocolList.tsx` - System IDs
- `logic/customProtocols/loadDefaultProtocols.ts` - Auto-Load

### Tests
- `utils/testScenarios.ts` - Test-Szenarien

---

## Häufige Fehlerquellen

1. **AI vergessen** - IMMER beide AIs (easy + normal) für neue Actions updaten
2. **Editor vergessen** - Neue Optionen müssen im EffectEditor wählbar sein
3. **validLanes/targetFilter nicht weitergereicht** - Durch alle Schichten prüfen
4. **Textgenerierung falsch** - Preview im Editor testen!
5. **UI Highlighting fehlt** - GameBoard.tsx für neue Actions prüfen
6. **Edge Case: Keine Targets** - Immer graceful skippen mit Log-Message

---

## Bekannte Patterns aus existierenden Protokollen

| Mechanik | Beispiel | Dateien |
|----------|----------|---------|
| Flip own/opponent | Light-0, Darkness-1 | flipExecutor, FlipEffectEditor |
| Shift with restrictions | Gravity-1, Speed-3 | shiftExecutor, ShiftEffectEditor |
| Draw conditional | Spirit-1 | drawExecutor, DrawEffectEditor |
| Delete with filter | Death-1, Death-3 | deleteExecutor, DeleteEffectEditor |
| Play from deck | Life-0, Water-1 | playExecutor, PlayEffectEditor |
| Play to filtered lanes | Smoke-0, Smoke-3 | playExecutor, PlayEffectEditor |
| Value modifier | Smoke-2, Spirit-2 | cardFactory, ValueModifierEditor |
| Discard for effect | Fire-4, Fire-5 | discardExecutor, DiscardEffectEditor |
| Return to hand | Water-4 | returnExecutor, ReturnEffectEditor |
| Block effects | Metal-2, Plague-0 | passive_rule, PassiveRuleEditor |
| Reactive triggers | Speed-2, Metal-6 | topEffects mit trigger |
