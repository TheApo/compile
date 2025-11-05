# Custom Protocol Creator - TODO & Checkliste

## ✅ ERLEDIGT

### Phase 1: Basis-Architektur
- [x] Type Definitions (`types/customProtocol.ts`)
- [x] Effect Generator (`logic/customProtocols/effectGenerator.ts`)
- [x] Storage Manager (`logic/customProtocols/storage.ts`)
- [x] Basis UI Component (`screens/CustomProtocolCreator.tsx`)
- [x] CSS Styling (`styles/custom-protocol-creator.css`)
- [x] Dokumentation (`CUSTOM_PROTOCOL_CREATOR.md`)

---

## 🔧 IN ARBEIT

### Phase 2: Erweiterte UI (FERTIG!)
- [x] **Wizard-Flow für neue Protokolle**
  - [x] Step 1: Name eingeben
  - [x] Step 2: Farbe wählen (color picker oder predefined colors)
  - [x] Step 3: Karten-Muster wählen (card pattern/design)
  - [x] Step 4: Für jede Karte (0-5) Effekte konfigurieren

- [x] **Card Editor mit 3 Boxen**
  - [x] Top Box (passive effects, immer aktiv wenn face-up)
  - [x] Middle Box (on play, wenn uncovered)
  - [x] Bottom Box mit Triggers:
    - [x] Start phase
    - [x] End phase
    - [x] On Cover

- [x] **Mehrere Effekte pro Box**
  - [x] Add multiple effects per box (wie Hate-1)
  - [ ] Reihenfolge der Effekte ändern (drag & drop später)
  - [ ] Effekt duplizieren

- [x] **Parameter-Editoren für jeden Effekt-Typ**
  - [x] Draw Effect Editor (count, target, source, conditional, refresh)
  - [x] Flip Effect Editor (count, owner, position, face state, optional, self-flip)
  - [x] Shift Effect Editor (target filter, destination restriction)
  - [x] Delete Effect Editor (count, position, value range, calculation, scope)
  - [x] Discard Effect Editor (count, actor, conditional)
  - [x] Return Effect Editor (count, value filter, scope)
  - [x] Play Effect Editor (source, count, face state, destination)
  - [x] Protocol Effect Editor (action, target, restriction)
  - [x] Reveal Effect Editor (source, count, follow-up)

- [x] **Integration ins Main Menu**
  - [x] Button "Custom Protocols" im Hauptmenü
  - [x] Routing zur CustomProtocolCreator component
  - [x] Back to Menu Button in ProtocolList

- [x] **Design-System Anpassung**
  - [x] CSS auf Spiel-Farbschema umgestellt (--background-color, --surface-color, --primary-color)
  - [x] Buttons auf .btn System umgestellt
  - [x] Fonts auf Orbitron/Poppins umgestellt
  - [x] Landscape-Optimierung mit Scrollbars
  - [x] height: 100vh und overflow: hidden für Main Container
  - [x] Scrollable Bereiche mit ::-webkit-scrollbar Styling

---

## 📋 NÄCHSTE SCHRITTE (Priorität)

### Phase 3: Integration
1. [ ] **Protocol Selection Integration**
   - [ ] Custom Protocols in ProtocolSelection.tsx laden
   - [ ] Als "Custom" oder "Fan-Content" Kategorie anzeigen
   - [ ] Preview für custom cards

2. [ ] **Effect Registration**
   - [ ] Custom effects bei Game-Start registrieren
   - [ ] effectRegistry für Middle effects
   - [ ] effectRegistryStart für Start effects
   - [ ] effectRegistryEnd für End effects
   - [ ] effectRegistryOnCover für On-Cover effects
   - [ ] Mehrere Effekte pro Box handhaben (chaining)

3. [ ] **Card Text Generation**
   - [ ] Automatische Generierung von top/middle/bottom Text
   - [ ] HTML formatting für emphasis tags
   - [ ] Korrekte Satzstellung und Grammatik

---

## 🎯 WICHTIGE IMPLEMENTATION DETAILS

### Farb-System für Custom Protocols
```typescript
interface CustomProtocolDefinition {
  // ... existing fields
  color: string;  // Hex color (e.g., "#FF5722")
  pattern?: 'solid' | 'gradient' | 'diagonal' | 'dots';  // Card background pattern
}
```

### Box-System (3 Bereiche pro Karte)
```typescript
interface CustomCardDefinition {
  value: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  topEffects: EffectDefinition[];     // Always active when face-up
  middleEffects: EffectDefinition[];  // On play / when uncovered
  bottomEffects: EffectDefinition[];  // Start/End/On-Cover triggers
}
```

### Effect mit Trigger
```typescript
interface EffectDefinition {
  id: string;
  params: EffectParams;
  position: 'top' | 'middle' | 'bottom';
  trigger: 'on_play' | 'start' | 'end' | 'on_cover' | 'passive';
}
```

### Mehrere Effekte pro Box (wie Hate-1)
**Hate-1 Example**: "Discard 3 cards. Delete 2 cards."

```typescript
{
  value: 1,
  middleEffects: [
    {
      params: { action: 'discard', count: 3, actor: 'self' },
      position: 'middle',
      trigger: 'on_play'
    },
    {
      params: { action: 'delete', count: 2, excludeSelf: true, ... },
      position: 'middle',
      trigger: 'on_play'
    }
  ]
}
```

**Implementation**: Effekte werden sequenziell ausgeführt, wenn actionRequired → queuedActions

---

## 🔍 TESTING CHECKLISTE

### Vor Integration testen:
- [ ] Protocol erstellen und speichern
- [ ] Protocol laden
- [ ] Protocol löschen
- [ ] Protocol bearbeiten
- [ ] Farbe anzeigen in UI
- [ ] Mehrere Effekte pro Box
- [ ] Start effects funktionieren
- [ ] End effects funktionieren
- [ ] On-Cover effects funktionieren

### Nach Integration testen:
- [ ] Custom protocol in selection angezeigt
- [ ] Cards werden korrekt generiert
- [ ] Effects werden ausgeführt
- [ ] Frost-1 blockiert custom flip effects
- [ ] Apathy-2 blockiert custom middle effects
- [ ] Multiple effects pro box funktionieren sequenziell
- [ ] Logging ist korrekt

---

## 📁 DATEI-ÜBERSICHT

### Existierende Dateien
```
types/customProtocol.ts                    # Type definitions
logic/customProtocols/effectGenerator.ts   # Effect → executable function
logic/customProtocols/storage.ts           # localStorage CRUD
screens/CustomProtocolCreator.tsx          # UI Component (BASIS)
styles/custom-protocol-creator.css         # Styling
CUSTOM_PROTOCOL_CREATOR.md                 # Dokumentation
CUSTOM_PROTOCOL_TODO.md                    # Diese Checkliste
```

### Zu erstellende Dateien
```
screens/CustomProtocolCreator/             # Aufteilen in Subcomponents
  ├── ProtocolWizard.tsx                   # Wizard flow
  ├── ProtocolList.tsx                     # List view
  ├── CardEditor.tsx                       # Single card editor
  ├── EffectEditor.tsx                     # Effect parameter editor
  └── EffectParameterEditors/              # Specific editors
      ├── DrawEffectEditor.tsx
      ├── FlipEffectEditor.tsx
      ├── DeleteEffectEditor.tsx
      └── ...

logic/customProtocols/registration.ts      # Register custom protocols at runtime
logic/customProtocols/cardTextGenerator.ts # Generate card text from effects
```

---

## 🚀 SCHNELLSTART FÜR MORGEN

### 1. Wo weitermachen?
**Datei**: `screens/CustomProtocolCreator.tsx`
**Aufgabe**: Wizard-Flow implementieren

### 2. Was ist der Plan?
1. Component umstrukturieren in Wizard mit Steps
2. Step 1: Name & Description
3. Step 2: Color picker
4. Step 3: Pattern/Design selector
5. Step 4: Card editor (0-5) mit Top/Middle/Bottom boxes

### 3. Wichtige Referenzen
- **Hate-1** (`logic/effects/hate/Hate-1.ts`): Mehrere Effekte in einer Box
- **Water-2** (`logic/effects/water/Water-2.ts`): Draw + Rearrange (sequential)
- **Chaos-1** (`logic/effects/chaos/Chaos-1.ts`): Own + Opponent sequential
- **Anarchy-3-end** (`logic/effects/anarchy/Anarchy-3-end.ts`): End effect mit restriction

### 4. Nächste Code-Änderungen
```typescript
// In CustomProtocolCreator.tsx
const [wizardStep, setWizardStep] = useState<'list' | 'name' | 'color' | 'pattern' | 'cards'>('list');
const [currentCardIndex, setCurrentCardIndex] = useState(0);

// Wizard navigation
const nextStep = () => {
  if (wizardStep === 'name') setWizardStep('color');
  else if (wizardStep === 'color') setWizardStep('pattern');
  else if (wizardStep === 'pattern') setWizardStep('cards');
};

// Card navigation
const nextCard = () => {
  if (currentCardIndex < 5) setCurrentCardIndex(currentCardIndex + 1);
  else handleSaveProtocol(); // Last card done
};
```

---

## ⚠️ WICHTIGE NOTIZEN

### Farben
- Vordefinierte Farben anbieten (basierend auf existierenden Protokollen)
- Custom hex color picker
- Farbe wird in card background/border verwendet

### Patterns
- Solid: Einfarbig
- Gradient: Verlauf
- Diagonal: Diagonale Linien
- Dots: Punkte-Muster

### Effect Chaining
Bei mehreren Effekten in einer Box:
1. Erster Effekt setzt `actionRequired`
2. Folgende Effekte in `queuedActions`
3. Resolver processed nach Completion

### Start vs End Effects
- **Start**: Zu Beginn der Turn (vor Control phase)
- **End**: Am Ende der Turn (nach Hand limit check)
- **On Cover**: Wenn Karte bedeckt wird (unmittelbar vor dem Bedecken)

### Top vs Bottom Box
- **Top**: IMMER aktiv wenn face-up (auch wenn covered)
- **Bottom**: NUR aktiv wenn uncovered UND face-up

---

## 💡 IDEEN FÜR SPÄTER

### Advanced Features
- [ ] Drag & Drop für Effekt-Reihenfolge
- [ ] Effect Templates (vordefinierte Kombinationen)
- [ ] Balance Calculator (Power-Level berechnen)
- [ ] Import/Export JSON
- [ ] Protocol Sharing (URL oder Code)
- [ ] AI-powered Effect Suggestions
- [ ] Card Preview (Live-Vorschau während Bearbeitung)
- [ ] Duplicate Protocol (als Basis für neue)
- [ ] Version History (Änderungen nachverfolgen)

### UI Improvements
- [ ] Tooltips für alle Parameter
- [ ] Keyboard shortcuts
- [ ] Undo/Redo
- [ ] Auto-save draft
- [ ] Search/Filter protocols
- [ ] Sort by name/date/power-level

---

## 📞 SUPPORT & REFERENZEN

### Effect Examples aus bestehendem Code
- **Multi-lane iteration**: `Chaos-0.ts`, `Death-0.ts`
- **Conditional chains**: `Fire-1.ts`, `Fire-2.ts`, `Death-1.ts`
- **Calculated effects**: `Frost-0.ts`, `Gravity-0.ts`, `Anarchy-0.ts`
- **Complex targeting**: `Hate-2.ts`, `Hate-4.ts`, `Water-3.ts`
- **Protocol effects**: `Anarchy-3.ts`, `Psychic-2.ts`, `Chaos-1.ts`

### Registry Files
```typescript
logic/effects/effectRegistry.ts       // Middle effects
logic/effects/effectRegistryStart.ts  // Start phase
logic/effects/effectRegistryEnd.ts    // End phase
logic/effects/effectRegistryOnCover.ts // On-cover
```

### Effect Executor
```typescript
logic/effectExecutor.ts
- executeMiddleEffect()
- processTriggeredEffects() // Start & End
- executeOnCoverEffect()
```

---

## ✨ VISION

**Ziel**: Spieler können eigene balanced Protokolle erstellen mit:
1. Eigener Farbe und Design
2. 6 Karten (0-5)
3. Bis zu 3 Effekte pro Karte (Top/Middle/Bottom)
4. Alle bestehenden Effect-Typen verfügbar
5. Vollständige Parameter-Kontrolle
6. Integration in normales Gameplay

**Wichtig**: System muss flexibel genug sein für komplexe Effekte wie:
- "Draw 1 for each face-down card"
- "Delete highest value, then opponent deletes highest value"
- "Rearrange protocols (Anarchy cannot be on this line)"
- "In each line, flip 1 covered card"
