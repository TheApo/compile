# Custom Protocol Creator

## Overview

The Custom Protocol Creator allows players to design their own custom protocols by selecting and configuring modular effects. Custom protocols are stored in `localStorage` and can be used like original protocols in the protocol selection screen.

**Key Features**:
- Visual editor with parameter configuration for all effect types
- Support for all effect positions (top/middle/bottom) and triggers
- Conditional effects ("if you do, then..." chains)
- Passive rules (ongoing restrictions)
- Reactive triggers (respond to game events)
- Value modifiers (dynamic card value changes)
- Import/Export protocols as JSON files
- Live validation and helpful error messages

---

## Architecture

### 1. Type Definitions (`types/customProtocol.ts`)

Defines the complete schema for custom protocols:

#### Effect Types

**All 9 Core Effect Types**:
- `DrawEffectParams`: Draw cards (count, target, source, conditionals)
- `FlipEffectParams`: Flip cards (count, target filters, optional, self-flip)
- `ShiftEffectParams`: Shift cards (target filters, destination restrictions)
- `DeleteEffectParams`: Delete cards (count, filters, scope, protocol matching)
- `DiscardEffectParams`: Discard from hand (count, actor, conditional)
- `ReturnEffectParams`: Return to hand (count, filters)
- `PlayEffectParams`: Play from hand/deck (count, face state, destination)
- `ProtocolEffectParams`: Rearrange/swap protocols (target, restrictions)
- `RevealEffectParams`: Reveal/give hand cards (count, optional)
- `TakeEffectParams`: Take cards from opponent's hand
- `ChoiceEffectParams`: Let player choose between multiple effects

#### Advanced Features

- **Passive Rules** (`PassiveRuleParams`): Ongoing restrictions like "Opponent cannot compile if they have >3 cards in hand"
- **Reactive Triggers** (`ReactiveTriggerParams`): Respond to events like "When opponent plays card, flip 1 card"
- **Value Modifiers** (`ValueModifierParams`): Dynamic value changes like "+1 to all cards in this line"

#### Effect Chaining

- **Conditional Chains**: `conditional: { type: 'if_executed', thenEffect: {...} }`
- **Sequential Chains**: `conditional: { type: 'then', thenEffect: {...} }`
- **Follow-up Effects**: `followUpEffect: {...}` for complex sequences

---

### 2. Effect Interpreter (`logic/customProtocols/effectInterpreter.ts`)

The core engine that executes custom protocol effects:

```typescript
export function executeCustomEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    effectDef: EffectDefinition
): EffectResult
```

**Key Features**:
- Validates card state (face-up, uncovered) based on effect position
- Handles all 9+ effect types with full parameter support
- Generates appropriate `actionRequired` and `queuedActions`
- Respects game rules (Frost-1, Apathy-2, Plague-0, etc.)
- Produces human-readable log messages
- Executes conditional chains and follow-up effects

**Position-Based Execution**:
- **Top effects**: Execute when card is face-up (even if covered)
- **Middle effects**: Require uncovered status
- **Bottom effects**: Require uncovered status

---

### 3. Storage Manager (`logic/customProtocols/storage.ts`)

Manages localStorage persistence and protocol lifecycle:

```typescript
// Load all custom protocols
const protocols = loadCustomProtocols();

// Save a protocol
saveCustomProtocol(protocolDefinition);

// Update existing protocol
updateCustomProtocol(id, protocolDefinition);

// Delete a protocol
deleteCustomProtocol(id);

// Import from JSON
importCustomProtocol(jsonString);

// Export to JSON
const json = exportCustomProtocol(protocol);
```

**Storage Format**:
```json
{
  "version": 1,
  "protocols": [
    {
      "id": "uuid",
      "name": "Lightning",
      "description": "Fast and aggressive",
      "color": "#FFEB7F",
      "pattern": "hexagons",
      "author": "Player",
      "createdAt": "2025-11-05T...",
      "cards": [
        {
          "value": 0,
          "topEffects": [...],
          "middleEffects": [...],
          "bottomEffects": [...]
        }
      ]
    }
  ]
}
```

---

### 4. Card Factory (`logic/customProtocols/cardFactory.ts`)

Converts custom protocol definitions to playable cards:

```typescript
export function getAllCustomProtocolCards(): Card[]
```

- Attaches `customEffects` to each card
- Generates card text descriptions
- Assigns colors and patterns
- Creates unique card IDs

---

### 5. UI Components

#### Main Screens

**`screens/CustomProtocolCreator/ProtocolList.tsx`**:
- List all custom protocols
- Create new protocol
- Edit/Delete existing protocols
- Import/Export JSON files

**`screens/CustomProtocolCreator/ProtocolWizard.tsx`**:
- Step-by-step protocol creation
- Configure name, description, color, pattern
- Navigate between cards (0-5)
- Add/remove effects per card

**`screens/CustomProtocolCreator/CardEditor.tsx`**:
- Edit single card's effects
- Organize effects by position (top/middle/bottom)
- Set triggers (on_play, start, end, on_cover)
- Drag-and-drop reordering

#### Effect Parameter Editors

Each effect type has a dedicated editor:

- `DrawEffectEditor.tsx`: Count, target, source, conditionals
- `FlipEffectEditor.tsx`: Count, filters, optional, self-flip
- `ShiftEffectEditor.tsx`: Target filters, destination
- `DeleteEffectEditor.tsx`: Count, filters, scope, protocol matching
- `DiscardEffectEditor.tsx`: Count, actor, conditional
- `PlayEffectEditor.tsx`: Count, face state, destination
- `ProtocolEffectEditor.tsx`: Rearrange/swap, target, restrictions
- `ChoiceEffectEditor.tsx`: Multiple effect options
- `PassiveRuleEditor.tsx`: Passive restrictions
- `ValueModifierEditor.tsx`: Dynamic value changes

**Common Features**:
- Dropdown selections for enums
- Number inputs with validation
- Checkboxes for booleans
- Nested editors for complex parameters
- Live validation with error messages

---

### 6. Styling (`styles/custom-protocol-creator.css`)

Comprehensive CSS for the creator UI:
- Dark theme with protocol colors
- Responsive layout
- Card preview styling
- Effect editor forms
- Modal dialogs

---

## Effect System Details

### Effect Positions

Each effect has a **position** that determines activation rules:

1. **Top Box** (`position: 'top'`)
   - Always active when card is face-up (even if covered)
   - Example: "Opponent cannot play cards with value > 4"
   - Used for: Passive effects, ongoing restrictions

2. **Middle Box** (`position: 'middle'`)
   - Only active when card is uncovered
   - Default trigger: `on_play` (when played or uncovered)
   - Blocked by Apathy-2 in same lane
   - Example: "Draw 2 cards"

3. **Bottom Box** (`position: 'bottom'`)
   - Only active when card is uncovered AND face-up
   - Multiple triggers available:
     - `start` - Start of turn
     - `end` - End of turn
     - `on_cover` - When about to be covered
   - Example: "Start: Flip 1 card"

### Effect Triggers

- `on_play`: Executes when card is played or becomes uncovered (middle box)
- `start`: Executes at start of turn (bottom box)
- `end`: Executes at end of turn (bottom box)
- `on_cover`: Executes when card is about to be covered (bottom box)
- `on_uncover`: Executes when card becomes uncovered (middle box)

### Conditional Effects

**If-Then Chains**:
```typescript
{
  id: "draw-effect",
  params: { action: "draw", count: 1, optional: true },
  conditional: {
    type: "if_executed",
    thenEffect: {
      id: "delete-effect",
      params: { action: "delete", count: 1 }
    }
  }
}
```
Generates: "You may draw 1 card. If you do, delete 1 card."

**Sequential Chains**:
```typescript
{
  id: "flip-effect",
  params: { action: "flip", count: 1 },
  conditional: {
    type: "then",
    thenEffect: {
      id: "self-flip",
      params: { action: "flip", count: 1, deleteSelf: true }
    }
  }
}
```
Generates: "Flip 1 card. Flip this card."

---

## Advanced Features

### Passive Rules

Ongoing restrictions that apply while card is active:

```typescript
{
  id: "passive-rule",
  params: {
    action: "passive_rule",
    ruleType: "prevent_compile",
    condition: {
      type: "hand_size",
      comparison: "greater_than",
      value: 3
    },
    target: "opponent"
  },
  position: "top",
  trigger: "on_play"
}
```

**Available Rule Types**:
- `prevent_compile`: Block compiling under conditions
- `prevent_play`: Block playing cards
- `prevent_draw`: Block drawing cards
- `force_discard`: Force discards under conditions

### Reactive Triggers

Respond to game events:

```typescript
{
  id: "reactive-trigger",
  params: {
    action: "reactive_trigger",
    eventType: "after_play",
    condition: {
      type: "card_played_by",
      player: "opponent"
    },
    reaction: {
      id: "flip-reaction",
      params: { action: "flip", count: 1 }
    }
  },
  position: "top",
  trigger: "on_play"
}
```

**Available Event Types**:
- `after_play`: When a card is played
- `after_delete`: When a card is deleted
- `after_compile`: When a lane compiles
- `after_draw`: When cards are drawn

### Value Modifiers

Dynamic card value changes:

```typescript
{
  id: "value-modifier",
  params: {
    action: "value_modifier",
    modifierType: "add",
    value: 1,
    scope: {
      type: "this_line",
      owner: "own"
    }
  },
  position: "top",
  trigger: "on_play"
}
```

Generates: "+1 to all cards in this line"

---

## Integration with Game System

### 1. Protocol Loading

Custom protocols are loaded alongside base protocols:

```typescript
// In ProtocolSelection.tsx
const customCards = isCustomProtocolEnabled()
  ? getAllCustomProtocolCards()
  : [];
const allCards = [...baseCards, ...customCards];
```

### 2. Effect Execution

Custom effects are executed via `effectInterpreter.ts`:

```typescript
// In effectExecutor.ts
const customCard = card as any;
if (customCard.customEffects) {
  const effects = customCard.customEffects.middleEffects;
  for (const effectDef of effects) {
    const result = executeCustomEffect(card, laneIndex, state, context, effectDef);
    // Process result...
  }
}
```

### 3. Multi-Effect Handling

Cards can have multiple effects per position:

```typescript
{
  value: 0,
  topEffects: [
    { /* passive rule */ },
    { /* value modifier */ }
  ],
  middleEffects: [
    { /* draw effect */ },
    { /* flip effect with conditional */ }
  ],
  bottomEffects: [
    { /* start trigger */ },
    { /* end trigger */ }
  ]
}
```

Effects are executed sequentially. If an effect creates `actionRequired`, remaining effects are queued.

---

## Creating a Custom Protocol: Step-by-Step

### 1. Navigate to Custom Protocols

- Main Menu → "Custom Protocols" (activated by clicking "developed" 5 times)

### 2. Create New Protocol

- Click "Create New Protocol"
- Enter name, description
- Choose color and pattern

### 3. Configure Each Card (0-5)

For each card value:

1. **Add Top Effects** (optional):
   - Click "Add Top Effect"
   - Select effect type (passive_rule, value_modifier, etc.)
   - Configure parameters
   - Set trigger (usually `on_play`)

2. **Add Middle Effects**:
   - Click "Add Middle Effect"
   - Select effect type (draw, flip, delete, etc.)
   - Configure parameters
   - Add conditionals if needed

3. **Add Bottom Effects** (optional):
   - Click "Add Bottom Effect"
   - Select effect type
   - Choose trigger (start, end, on_cover)
   - Configure parameters

### 4. Save Protocol

- Click "Save Protocol"
- Protocol is stored in localStorage
- Immediately available in Protocol Selection

### 5. Export/Share

- Click "Export" to download JSON file
- Share with other players
- Import via "Import Protocol" button

---

## Validation Rules

The editor validates:

1. **Required Fields**: All effect parameters must be filled
2. **Value Ranges**: Numbers must be within valid ranges (1-6 for counts, etc.)
3. **Position Rules**: Top effects can only have certain triggers
4. **Effect Completeness**: Conditional effects must have thenEffect
5. **Protocol Uniqueness**: Protocol names must be unique

**Validation Errors**:
- Shown inline with red borders
- Save button disabled until all errors resolved
- Helpful tooltips explain requirements

---

## Limitations and Best Practices

### Current Limitations

1. **No Variable Calculations**: Can't reference card values dynamically (e.g., "Draw X where X = this card's value")
2. **No Complex Target Expressions**: Can't target "all cards with value < opponent's highest card"
3. **No Cost-Benefit Effects**: Can't easily create "Draw 3, then opponent draws 2"

### Best Practices

1. **Balance Low/High Values**:
   - Value 0-1: Moderate effects (draw 1-2, flip 1, shift 1)
   - Value 2-3: Medium effects (delete 1, discard 1, rearrange)
   - Value 4-5: Powerful effects (draw 3+, delete multiple, play from deck)

2. **Use Conditionals Wisely**:
   - "Optional" effects add flexibility
   - "If you do" chains create interesting choices
   - Don't overload with too many chains

3. **Mix Effect Types**:
   - Combine offensive (delete, discard) and defensive (draw, play)
   - Add utility effects (flip, shift, protocol swap)
   - Include passive effects for ongoing impact

4. **Test Thoroughly**:
   - Play against AI to test balance
   - Try different scenarios (early game, late game)
   - Check for softlocks (no valid targets)

---

## Example: Creating "Storm" Protocol

A weather-themed protocol focused on card manipulation:

**Storm-0** (Value 0):
- Middle: Draw 2 cards

**Storm-1** (Value 1):
- Middle: Flip 1 card
- Conditional: If target becomes face-up, flip this card

**Storm-2** (Value 2):
- Middle: Shift 1 card
- Bottom (on_cover): Flip 1 covered card

**Storm-3** (Value 3):
- Top: +1 to all cards in this line
- Middle: Delete 1 card with value ≤ 2

**Storm-4** (Value 4):
- Middle: Swap 2 of opponent's protocols
- Bottom (end): Draw 1 card

**Storm-5** (Value 5):
- Middle: You may draw 3 cards. If you do, opponent draws 2.
- Bottom (start): Flip all covered cards in this line

This creates a balanced protocol with:
- Draw power (0, 4, 5)
- Disruption (1, 2, 3)
- Protocol manipulation (4)
- Positional strategy (2, 5)

---

## Troubleshooting

### Effect Not Executing

1. Check card is face-up
2. Check card is uncovered (for middle/bottom effects)
3. Check trigger matches (on_play vs start/end)
4. Check target filters (owner, position, faceState)
5. Check game rules (Frost-1, Apathy-2, Plague-0)

### Validation Errors

1. Fill all required fields
2. Check value ranges (1-6 for counts)
3. Ensure conditionals have thenEffect
4. Check protocol name is unique

### Softlock After Effect

1. Add "optional: true" to effects that might have no targets
2. Use appropriate target filters
3. Test with different board states

---

## Conclusion

The Custom Protocol Creator provides a powerful, flexible system for creating custom content. By using modular, parameterizable effects, players can recreate any original protocol card or design entirely new strategies.

**Key Strengths**:
- Full parity with original cards (all effects reproducible)
- No card-specific code required
- User-friendly visual editor
- Import/Export for sharing
- Comprehensive validation

**Future Potential**:
- Community protocol library
- AI-assisted balancing
- Tournament-legal custom protocols
- Advanced scripting for complex effects
