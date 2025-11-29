# AI Onboarding Guide for COMPILE Card Game

## WICHTIG: Zuerst diese Dokumente lesen!

Bevor du mit der Arbeit am Code beginnst, lies unbedingt diese Dateien in der folgenden Reihenfolge:

1. **`beschreibung.txt`** - Überblick über das Projekt und seine Struktur
2. **`COMP-MN01_Rulesheet_Updated.pdf`** - Offizielle Spielregeln mit Bildern und Beispielen
3. **`game_rules.md`** - Detaillierte Spielregeln in Textform
4. **`CUSTOM_PROTOCOL_CREATOR.md`** - Anleitung zum Erstellen neuer Protokolle
5. **`CARD_TARGETING_RULES.md`** - Regeln für Card Targeting und Filter

Diese Dokumente sind essentiell um zu verstehen:
- Wie das Spiel funktioniert (Compile-Bedingungen, Turn Order, Card Anatomy)
- Was die verschiedenen Effekt-Typen bedeuten (flip, shift, delete, etc.)
- Wie Covered/Uncovered Cards funktionieren
- Wie das Custom Protocol System aufgebaut ist

---

## Game Overview

COMPILE is a competitive card game where two players (rogue AIs) compete one-on-one in a race to compile their 3 protocols, rewriting reality in their new image.

### Win Condition
The first player to **compile all 3 of their protocol cards** wins the game.

### Basic Setup
- Each player has **3 protocols** arranged in 3 lanes
- Each player builds an **18-card deck** (6 cards per protocol)
- Starting hand: **5 cards**
- Protocols start "Loading..." side up, flip to "Compiled" when compiled

## Core Mechanics

### The Field
```
         LANE 0      LANE 1      LANE 2
       ┌─────────┬─────────┬─────────┐
PLAYER │ Stack 0 │ Stack 1 │ Stack 2 │
       ├─────────┼─────────┼─────────┤
       │Protocol0│Protocol1│Protocol2│  <- Player's protocols
       ├─────────┼─────────┼─────────┤
       │Protocol0│Protocol1│Protocol2│  <- Opponent's protocols
       ├─────────┼─────────┼─────────┤
OPPON. │ Stack 0 │ Stack 1 │ Stack 2 │
       └─────────┴─────────┴─────────┘
```

### Turn Order
1. **Start Phase**: Trigger "Start:" effects on uncovered face-up cards
2. **Check Control**: (Advanced) Control component mechanics
3. **Check Compile**: If lane value ≥10 AND > opponent's lane value, MUST compile
4. **Action Phase**: Either PLAY a card OR REFRESH (draw to 5 cards)
5. **Check Cache**: Discard down to 5 cards if needed
6. **End Phase**: Trigger "End:" effects on uncovered face-up cards

### Playing Cards
- **Face-Up**: Must match lane protocol (card protocol = player's OR opponent's protocol in that lane)
  - Triggers middle box effect immediately
  - Top/bottom effects become active
- **Face-Down**: Can play in ANY lane
  - Value = 2 (default)
  - No effects active until flipped

### Card Anatomy
```
┌─────────────────────────────┐
│ [Protocol] [Value] [Icon]   │  <- Protocol indicator, value, icon
├─────────────────────────────┤
│ TOP BOX (Persistent)        │  <- Always active when face-up (even covered)
├─────────────────────────────┤
│ MIDDLE BOX (Immediate)      │  <- Triggers on play/flip/uncover
├─────────────────────────────┤
│ BOTTOM BOX (Auxiliary)      │  <- Only active when UNCOVERED
└─────────────────────────────┘
```

### Key Terms
- **Compile**: Delete all cards in a line (both sides), flip your protocol to "Compiled"
- **Uncovered**: Top card of a stack (can be targeted by most effects)
- **Covered**: Cards under other cards (protected from most effects)
- **Delete**: Move card from field to owner's trash
- **Discard**: Move card from hand to owner's trash
- **Flip**: Change card facing (face-up ↔ face-down)
- **Shift**: Move card to another lane on same side
- **Return**: Move card from field to owner's hand
- **Reveal**: Show card temporarily, then return to previous state
- **Refresh**: Draw until 5 cards in hand
- **Clear Cache**: Discard down to 5 cards in hand

## Custom Protocol System (CRITICAL!)

### Architecture Overview

The game now uses a **fully data-driven custom protocol system**. All card effects are defined in JSON files, NOT hardcoded in TypeScript.

```
custom_protocols/
├── fire_custom_protocol.json
├── water_custom_protocol.json
├── death_custom_protocol.json
├── life_custom_protocol.json
├── light_custom_protocol.json
├── darkness_custom_protocol.json
├── gravity_custom_protocol.json
├── speed_custom_protocol.json
├── spirit_custom_protocol.json
├── metal_custom_protocol.json
├── plague_custom_protocol.json
├── psychic_custom_protocol.json
├── love_custom_protocol.json
├── anarchy_custom_protocol.json
└── [any new protocols...]
```

### JSON Protocol Structure

```json
{
  "protocolName": "Fire",
  "themeKeywords": ["DISCARD FOR EFFECT"],
  "cards": [
    {
      "value": 0,
      "topEffects": [...],      // Persistent effects (D box)
      "middleEffects": [...],   // Immediate effects (E box)
      "bottomEffects": [...]    // Auxiliary effects (F box)
    },
    // ... cards 1-5
  ]
}
```

### Effect Definition Structure

Each effect has:
```json
{
  "action": "draw" | "flip" | "delete" | "shift" | "discard" | "return" | "reveal" | "play" | "give" | "swap_protocols" | "prevent" | "value_boost" | "draw_from_opponent_deck" | "delete_all_in_lane" | "return_all_in_lane" | "custom_choice",
  "params": {
    "count": 1,
    "targetFilter": {
      "owner": "own" | "opponent" | "any",
      "faceState": "face_up" | "face_down" | "any",
      "position": "uncovered" | "covered" | "any",
      "excludeSelf": true | false
    },
    "actorChooses": "effect_owner" | "card_owner",
    "laneRestriction": "current" | "other" | "any",
    "protocolRestriction": "matching" | "non_matching" | "any"
  },
  "trigger": "immediate" | "start" | "end" | "on_cover" | "after_draw" | "after_delete" | "after_flip" | "after_shift" | "after_return",
  "optional": true | false,
  "conditional": {
    "if_executed": true,
    "then": { /* another effect */ }
  }
}
```

### Key Files in Custom Protocol System

1. **`logic/customProtocols/effectInterpreter.ts`** - The heart of effect execution
   - `executeCustomEffect()` - Main entry point for all effect types
   - Creates `actionRequired` when user/AI input is needed
   - Handles conditionals (`if_executed`, `then`)
   - Parses `targetFilter`, `actorChooses`, `laneRestriction`

2. **`logic/game/resolvers/cardResolver.ts`** - Handles `actionRequired` responses
   - Processes user/AI card selections
   - Routes to appropriate handlers based on action type
   - Contains both legacy (specific) and generic handlers

3. **`logic/game/reactiveEffectProcessor.ts`** - Reactive effect handling
   - Processes top box effects with triggers like `after_draw`, `after_delete`, etc.
   - Queues and processes reactive effects in correct order

4. **`types/customProtocol.ts`** - TypeScript types for custom protocols

### How Effects Flow

```
1. Card played/flipped/uncovered
       ↓
2. effectInterpreter.executeCustomEffect()
       ↓
3. If user input needed → actionRequired created
       ↓
4. AI (easy.ts/normal.ts) or GUI receives actionRequired
       ↓
5. cardResolver.ts processes the response
       ↓
6. Effect completes, triggers reactive effects if any
       ↓
7. reactiveEffectProcessor.ts checks for triggered effects
```

## AI System

### AI Difficulty Levels

1. **Easy AI** (`logic/ai/easy.ts`)
   - Makes random or first-available choices
   - Rarely accepts optional effects
   - No strategic thinking

2. **Normal AI** (`logic/ai/normal.ts`)
   - Makes scoring-based decisions
   - 20% chance to make suboptimal moves (human-like)
   - No memory of revealed cards
   - Balanced strategic choices

3. **Hard AI** (`logic/ai/hardImproved.ts`)
   - **NOTE: Currently being rewritten from scratch**
   - Will have full strategic analysis
   - Memory of revealed cards
   - Predictive opponent modeling

### How AI Handles Effects

The AI receives `ActionRequired` objects and must return `AIAction`:

```typescript
// Example ActionRequired
{
  type: 'select_card_to_flip',
  actor: 'opponent',
  sourceCardId: 'card-123',
  targetFilter: {
    owner: 'opponent',
    faceState: 'face_up',
    position: 'uncovered'
  }
}

// AI returns AIAction
{
  type: 'flipCard',
  cardId: 'target-card-456'
}
```

### Generic vs Specific Handlers

The AI has two types of handlers:

**Generic Handlers** (PREFERRED for custom protocols):
- `select_card_to_flip` - Uses `targetFilter` to find valid targets
- `select_card_to_shift` - Uses `targetFilter` + lane restrictions
- `select_cards_to_delete` - Uses `targetFilter` + `actorChooses`
- `select_card_to_return` - Uses `targetOwner` filter
- `select_lane_for_shift` - Handles lane selection with restrictions
- `select_lane_for_delete_all` - Generic delete all in lane
- `prompt_optional_effect` - Generic optional effect prompt

**Specific Handlers** (Legacy, for original protocols):
- `select_card_to_flip_for_fire_3` - Fire-3 specific
- `select_card_to_delete_for_death_1` - Death-1 specific
- etc.

### Adding New Effects for AI

When creating new custom protocols:

1. **Use generic action types** when possible:
   - `select_card_to_flip` with appropriate `targetFilter`
   - `select_card_to_shift` with appropriate `targetFilter`
   - `select_cards_to_delete` with `targetFilter` and `actorChooses`

2. **If generic types don't fit**, you may need to:
   - Add a new specific handler in `easy.ts` and `normal.ts`
   - Add corresponding case in `cardResolver.ts`

3. **Test with AI** to ensure the effect works correctly

## Effect Action Types Reference

### Draw
```json
{ "action": "draw", "params": { "count": 2 } }
```

### Flip
```json
{
  "action": "flip",
  "params": {
    "count": 1,
    "targetFilter": {
      "owner": "opponent",
      "faceState": "face_up",
      "position": "uncovered"
    }
  }
}
```

### Delete
```json
{
  "action": "delete",
  "params": {
    "count": 1,
    "targetFilter": {
      "owner": "any",
      "faceState": "face_down",
      "position": "uncovered"
    },
    "actorChooses": "effect_owner"
  }
}
```

### Shift
```json
{
  "action": "shift",
  "params": {
    "count": 1,
    "targetFilter": {
      "owner": "own",
      "position": "uncovered",
      "excludeSelf": true
    },
    "laneRestriction": "other"
  }
}
```

### Discard
```json
{
  "action": "discard",
  "params": {
    "count": 1,
    "targetFilter": { "owner": "opponent" },
    "actorChooses": "card_owner"
  }
}
```

### Return
```json
{
  "action": "return",
  "params": {
    "count": 1,
    "targetFilter": {
      "owner": "opponent",
      "position": "uncovered"
    }
  }
}
```

### Play (from hand or deck)
```json
{
  "action": "play",
  "params": {
    "source": "hand" | "top_deck",
    "faceState": "face_down",
    "laneRestriction": "other"
  }
}
```

### Delete All in Lane
```json
{
  "action": "delete_all_in_lane",
  "params": {
    "targetFilter": {
      "owner": "any",
      "valueFilter": 2
    }
  }
}
```

### Custom Choice (Either/Or)
```json
{
  "action": "custom_choice",
  "params": {
    "choices": [
      { "action": "draw", "params": { "count": 1 } },
      { "action": "flip", "params": { "count": 1 } }
    ]
  }
}
```

### Value Boost (Passive)
```json
{
  "action": "value_boost",
  "params": {
    "targetFilter": { "faceState": "face_down" },
    "boostAmount": 1,
    "scope": "lane" | "all"
  },
  "trigger": "passive"
}
```

### Prevent (Passive Protection)
```json
{
  "action": "prevent",
  "params": {
    "preventedAction": "delete" | "flip" | "shift" | "return",
    "targetFilter": { "owner": "own" }
  },
  "trigger": "passive"
}
```

## UI System (React + CSS)

### UI-Architektur

Die UI ist eine **React-Anwendung** mit folgender Struktur:

```
├── index.html              # Entry point
├── index.tsx               # React root render
├── App.tsx                 # Main App component mit Routing
├── index.css               # Global styles (importiert alle anderen)
│
├── screens/                # Hauptbildschirme
│   ├── MainMenu.tsx        # Hauptmenü
│   ├── ProtocolSelection.tsx # Protocol-Auswahl vor dem Spiel
│   ├── GameScreen.tsx      # Hauptspielbildschirm
│   ├── ResultsScreen.tsx   # Spielergebnis
│   ├── StatisticsScreen.tsx # Statistiken
│   ├── CardLibraryScreen.tsx # Kartenübersicht
│   └── CustomProtocolCreator/ # Protocol-Editor
│       ├── CustomProtocolCreator.tsx
│       ├── CardEditor.tsx
│       ├── EffectEditor.tsx
│       ├── ProtocolList.tsx
│       ├── ProtocolWizard.tsx
│       └── EffectParameterEditors/  # Spezifische Editoren pro Effekttyp
│           ├── DrawEffectEditor.tsx
│           ├── FlipEffectEditor.tsx
│           ├── DeleteEffectEditor.tsx
│           ├── ShiftEffectEditor.tsx
│           └── ... (weitere Editoren)
│
├── components/             # Wiederverwendbare Komponenten
│   ├── Card.tsx            # Kartenkomponente
│   ├── Lane.tsx            # Lane/Stack-Darstellung
│   ├── GameBoard.tsx       # Spielfeld
│   ├── GameInfoPanel.tsx   # Info-Panel (Hand, Deck, etc.)
│   ├── PhaseController.tsx # Phase-Buttons und Anzeige
│   ├── Header.tsx          # Header mit Navigation
│   ├── ControlDisplay.tsx  # Control-Komponente Anzeige
│   ├── RulesModal.tsx      # Regeln-Modal
│   ├── LogModal.tsx        # Spiellog-Modal
│   ├── DebugPanel.tsx      # Debug-Informationen
│   └── ... (weitere Modals)
│
├── styles/                 # CSS-Dateien
│   ├── base.css            # Grundlegende Styles, Variablen, Fonts
│   ├── components.css      # Komponenten-Styles
│   ├── custom-protocol-creator.css
│   ├── StatisticsScreen.css
│   └── layouts/            # Screen-spezifische Layouts
│       ├── main-menu.css
│       ├── protocol-selection.css
│       ├── game-screen.css
│       └── card-library.css
│   └── responsive/
│       └── tablet.css      # Responsive Anpassungen
```

### Design-Stil

Das Spiel hat einen **Cyberpunk/Tech-Stil**:
- **Fonts**: `Orbitron` (Headlines), `Poppins` (Body text)
- **Farbschema**: Dunkle Hintergründe mit Neon-Akzenten (Lila, Cyan, Pink)
- **CSS-Variablen**: Definiert in `styles/base.css`

### Wichtige UI-Komponenten

1. **`GameScreen.tsx`** - Hauptspiellogik
   - Verwaltet GameState
   - Ruft AI-Funktionen auf
   - Handelt User-Interaktionen

2. **`Card.tsx`** - Kartenrendering
   - Zeigt Karten mit allen Effekten
   - Highlightet selektierbare Karten
   - Animation für Flip/Delete/etc.

3. **`PhaseController.tsx`** - Phasensteuerung
   - Zeigt aktuelle Phase
   - Buttons für Aktionen (Play, Refresh, etc.)

4. **`CustomProtocolCreator/`** - Protocol-Editor
   - Erstellt/Bearbeitet Custom Protocols
   - Validiert Effect-Definitionen
   - Exportiert JSON-Dateien

---

## Critical Files Summary

| File | Purpose |
|------|---------|
| `logic/customProtocols/effectInterpreter.ts` | Execute all custom effects |
| `logic/game/resolvers/cardResolver.ts` | Handle user/AI responses to actionRequired |
| `logic/game/reactiveEffectProcessor.ts` | Process triggered/reactive effects |
| `logic/game/phaseManager.ts` | Game phase transitions and turn management |
| `logic/game/stateManager.ts` | GameState mutations and calculations |
| `logic/ai/easy.ts` | Easy AI decision making |
| `logic/ai/normal.ts` | Normal AI decision making |
| `logic/ai/aiEffectUtils.ts` | Utility functions for AI effect detection |
| `logic/game/passiveRuleChecker.ts` | Check passive rules for play restrictions |
| `types/index.ts` | Core TypeScript types |
| `types/customProtocol.ts` | Custom protocol types |
| **UI Files** | |
| `screens/GameScreen.tsx` | Main game screen with state management |
| `screens/ProtocolSelection.tsx` | Protocol selection before game |
| `screens/CustomProtocolCreator/` | Protocol editor UI |
| `components/Card.tsx` | Card rendering component |
| `components/GameBoard.tsx` | Game board layout |
| `components/PhaseController.tsx` | Phase control buttons |
| `styles/base.css` | CSS variables and base styles |
| `styles/components.css` | Component-specific styles |

## Common Pitfalls

### 1. Owner Filter Perspective
The `targetFilter.owner` is **relative to the effect owner**, not absolute:
- `"own"` = cards belonging to whoever owns the effect
- `"opponent"` = cards belonging to the opponent OF the effect owner

### 2. actorChooses Confusion
- `"effect_owner"` = The player who played the card chooses targets
- `"card_owner"` = The owner of potential target cards chooses (forced self-targeting)

### 3. Position Filter
- `"uncovered"` = Only the TOP card of each stack
- `"covered"` = Only cards UNDER other cards
- `"any"` or omitted = All cards in stack

### 4. Lane Restrictions for Shift
- `"current"` = Must stay in same lane (no shift)
- `"other"` = Must move to different lane
- `"to_from_this_line"` = Special: must shift TO or FROM the source card's lane

### 5. AI Fallback Behavior
If the AI doesn't have a handler for an action type, it returns `{ type: 'skip' }`. This may cause effects to be skipped entirely!

## Testing Custom Protocols

1. **Unit test the JSON**: Ensure it parses correctly
2. **Test with human player**: Verify effects work as expected
3. **Test with Easy AI**: Check AI handles all action types
4. **Test with Normal AI**: Verify strategic decisions make sense
5. **Check edge cases**: Empty hands, no valid targets, etc.

## Version History

- **v2.0**: Full migration to custom protocol system
- **v1.x**: Original hardcoded protocol implementations (deprecated)
