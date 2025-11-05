# Custom Protocol Creator

## Overview

The Custom Protocol Creator allows players to design their own custom protocols by selecting and configuring modular effects. Custom protocols are stored in `localStorage` and can be used like Fan-Content protocols in the protocol selection screen.

## Architecture

### 1. Type Definitions (`types/customProtocol.ts`)

Defines the schema for custom protocols:

- **EffectParams**: Union type of all effect parameter interfaces
  - `DrawEffectParams`: Draw cards (count, target, source, conditionals)
  - `FlipEffectParams`: Flip cards (count, target filters, optional)
  - `ShiftEffectParams`: Shift cards (target filters, destination restrictions)
  - `DeleteEffectParams`: Delete cards (count, filters, scope, protocol matching)
  - `DiscardEffectParams`: Discard from hand (count, actor, conditional)
  - `ReturnEffectParams`: Return to hand (count, filters)
  - `PlayEffectParams`: Play from hand/deck (count, face state, destination)
  - `ProtocolEffectParams`: Rearrange/swap protocols (target, restrictions)
  - `RevealEffectParams`: Reveal/give hand cards

- **EffectDefinition**: Single effect with parameters, position, and trigger
- **CustomCardDefinition**: One card with value (0-5) and effects array
- **CustomProtocolDefinition**: Complete protocol with 6 cards, name, description

### 2. Effect Generator (`logic/customProtocols/effectGenerator.ts`)

Converts custom effect definitions into executable effect functions:

```typescript
const generateEffect = (params: EffectParams) => {
    return (card, laneIndex, state, context) => {
        // Execute effect based on params.action
        // Returns EffectResult with updated state
    }
}
```

**Key Features**:
- Handles all 9 effect types (draw, flip, shift, delete, discard, return, play, protocol, reveal)
- Respects game rules (Frost-1 blocking, Apathy-2, etc.)
- Generates appropriate `actionRequired` and `queuedActions`
- Produces human-readable log messages

### 3. Storage Manager (`logic/customProtocols/storage.ts`)

Manages localStorage persistence:

```typescript
// Load all custom protocols
const protocols = loadCustomProtocols();

// Save a protocol
addCustomProtocol(protocolDefinition);

// Delete a protocol
deleteCustomProtocol(id);

// Convert to CardData format
const cards = customProtocolToCards(protocol);
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
      "author": "Player",
      "createdAt": "2025-11-05T...",
      "cards": [...]
    }
  ]
}
```

### 4. UI Component (`screens/CustomProtocolCreator.tsx`)

React component for creating/editing custom protocols:

**Features**:
- List view of existing custom protocols
- Create new protocol
- Edit protocol name and description
- Add/remove effects for each card (0-5)
- Save to localStorage
- Delete protocols

**Workflow**:
1. Click "Create New Protocol"
2. Enter protocol name and description
3. For each card (0-5), add effects by selecting from dropdown
4. Effects are added with default parameters
5. Save protocol

### 5. Styling (`styles/custom-protocol-creator.css`)

Responsive CSS for the creator UI with dark theme support.

---

## Effect System Details

### Effect Positions

Each effect has a **position** that determines where it appears on the card:

1. **Top Box** (`position: 'top'`)
   - Always active when card is face-up (even if covered)
   - Example: Passive blocking effects

2. **Middle Box** (`position: 'middle'`, `trigger: 'on_play'`)
   - Executes when card is played or becomes uncovered
   - Most common effect position
   - Blocked by Apathy-2 in same line

3. **Bottom Box** (`position: 'bottom'`)
   - Only active when card is uncovered (top of stack) AND face-up
   - Has different triggers:
     - `trigger: 'start'` - Start of turn
     - `trigger: 'end'` - End of turn
     - `trigger: 'on_cover'` - When about to be covered

### Effect Parameters

Each effect type has specific parameters:

#### Draw Effect
```typescript
{
  action: 'draw',
  count: 1-6,
  target: 'self' | 'opponent',
  source: 'own_deck' | 'opponent_deck',
  conditional?: {
    type: 'count_face_down' | 'is_covering' | 'non_matching_protocols'
  },
  preAction?: 'refresh'  // Refresh hand first
}
```

**Examples**:
- `{ action: 'draw', count: 2, target: 'self', source: 'own_deck' }` → "Draw 2 cards."
- `{ action: 'draw', count: 1, conditional: { type: 'count_face_down' } }` → "Draw 1 for each face-down card."

#### Flip Effect
```typescript
{
  action: 'flip',
  count: 1-6,
  targetFilter: {
    owner: 'any' | 'own' | 'opponent',
    position: 'any' | 'covered' | 'uncovered' | 'covered_in_this_line',
    faceState: 'any' | 'face_up' | 'face_down',
    excludeSelf: boolean
  },
  optional: boolean,
  selfFlipAfter?: boolean
}
```

**Examples**:
- `{ action: 'flip', count: 1, targetFilter: { owner: 'opponent', position: 'any', faceState: 'any', excludeSelf: false }, optional: false }` → "Flip 1 opponent's card."
- `{ action: 'flip', count: 2, targetFilter: { owner: 'any', position: 'covered', faceState: 'face_down', excludeSelf: true }, optional: true }` → "May flip 2 covered face-down other cards."

#### Delete Effect
```typescript
{
  action: 'delete',
  count: 1-6 | 'all_in_lane',
  targetFilter: {
    position: 'uncovered' | 'covered' | 'any',
    faceState: 'any' | 'face_up' | 'face_down',
    valueRange?: { min: number, max: number },
    calculation?: 'highest_value' | 'lowest_value'
  },
  scope?: {
    type: 'anywhere' | 'other_lanes' | 'specific_lane' | 'this_line'
  },
  protocolMatching?: 'must_match' | 'must_not_match',
  excludeSelf: boolean
}
```

**Examples**:
- `{ action: 'delete', count: 1, targetFilter: { position: 'uncovered', faceState: 'any' }, excludeSelf: true }` → "Delete 1 card."
- `{ action: 'delete', count: 'all_in_lane', targetFilter: { position: 'any', faceState: 'any', valueRange: { min: 1, max: 2 } } }` → "Delete all cards with value 1 or 2 in 1 line."

#### Protocol Effects
```typescript
{
  action: 'rearrange_protocols' | 'swap_protocols',
  target: 'own' | 'opponent' | 'both_sequential',
  restriction?: {
    disallowedProtocol: string,
    laneIndex: number
  }
}
```

**Examples**:
- `{ action: 'rearrange_protocols', target: 'own' }` → "Rearrange your protocols."
- `{ action: 'swap_protocols', target: 'opponent' }` → "Swap 2 of opponent's protocols."

---

## Integration with Protocol Selection

To integrate custom protocols into the protocol selection system:

### 1. Load Custom Protocols

In `ProtocolSelection.tsx`:

```typescript
import { loadCustomProtocols, customProtocolToCards } from '../logic/customProtocols/storage';

const customProtocols = loadCustomProtocols();
```

### 2. Add to Protocol List

Add custom protocols to the existing protocol categories:

```typescript
const allProtocols = [
  ...existingProtocols,
  ...customProtocols.map(protocol => ({
    name: protocol.name,
    description: protocol.description,
    category: 'Custom',  // or 'Fan-Content'
    cards: customProtocolToCards(protocol),
    isCustom: true,
  }))
];
```

### 3. Register Effects

Custom protocol effects need to be registered at runtime:

```typescript
import { generateEffect } from '../logic/customProtocols/effectGenerator';
import { effectRegistry } from '../logic/effects/effectRegistry';

// For each custom protocol
customProtocols.forEach(protocol => {
  protocol.cards.forEach(card => {
    card.effects.forEach(effect => {
      // Register middle effects
      if (effect.position === 'middle' && effect.trigger === 'on_play') {
        const key = `${protocol.name}-${card.value}`;
        effectRegistry[key] = generateEffect(effect.params);
      }

      // Similar for start, end, on-cover registries
    });
  });
});
```

### 4. Handle Multiple Effects per Card

The current implementation assumes one effect per card. For multiple effects:

```typescript
// Instead of single execute function, chain multiple:
effectRegistry[`${protocol.name}-${card.value}`] = (card, laneIndex, state, context) => {
  let result = { newState: state };

  for (const effect of card.effects.filter(e => e.position === 'middle')) {
    const effectFn = generateEffect(effect.params);
    result = effectFn(card, laneIndex, result.newState, context);

    // If action required, queue remaining effects
    if (result.newState.actionRequired) {
      const remainingEffects = card.effects.slice(card.effects.indexOf(effect) + 1);
      result.newState.queuedActions = [
        ...(result.newState.queuedActions || []),
        ...remainingEffects.map(e => ({ type: 'custom_effect', effect: e }))
      ];
      break;
    }
  }

  return result;
};
```

---

## Future Enhancements

### 1. Advanced Effect Configuration UI

Create detailed editors for each effect parameter:

```tsx
interface EffectConfiguratorProps {
  effect: EffectDefinition;
  onChange: (updated: EffectDefinition) => void;
}

const DrawEffectConfigurator: React.FC<{params: DrawEffectParams, onChange: ...}> = ({ params, onChange }) => {
  return (
    <div>
      <label>
        Count:
        <input
          type="number"
          min={1}
          max={6}
          value={params.count}
          onChange={e => onChange({ ...params, count: parseInt(e.target.value) })}
        />
      </label>

      <label>
        Target:
        <select value={params.target} onChange={...}>
          <option value="self">Self</option>
          <option value="opponent">Opponent</option>
        </select>
      </label>

      <label>
        Conditional:
        <select value={params.conditional?.type || 'none'} onChange={...}>
          <option value="none">None</option>
          <option value="count_face_down">1 per face-down card</option>
          <option value="is_covering">If covering</option>
        </select>
      </label>
    </div>
  );
};
```

### 2. Effect Chaining ("If you do, then...")

Add conditional chaining:

```typescript
interface EffectDefinition {
  // ... existing fields
  conditional?: {
    type: 'if_you_do';
    thenEffect: EffectDefinition;  // Chained effect
  };
}
```

### 3. Card Preview

Show live preview of custom card with rendered text:

```tsx
<CardComponent
  card={{
    protocol: protocolName,
    value: cardValue,
    top: generateTopText(card.effects.filter(e => e.position === 'top')),
    middle: generateMiddleText(card.effects.filter(e => e.position === 'middle')),
    bottom: generateBottomText(card.effects.filter(e => e.position === 'bottom')),
    isFaceUp: true,
  }}
  isFaceUp={true}
/>
```

### 4. Import/Export

Allow sharing custom protocols:

```typescript
const exportProtocol = (protocol: CustomProtocolDefinition) => {
  const json = JSON.stringify(protocol, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${protocol.name}.protocol.json`;
  a.click();
};

const importProtocol = (file: File) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const protocol = JSON.parse(e.target.result as string);
    addCustomProtocol(protocol);
  };
  reader.readAsText(file);
};
```

### 5. AI-Powered Effect Generation

Allow AI to suggest balanced effects:

```typescript
const generateBalancedCard = async (value: number, theme: string) => {
  const prompt = `Generate a ${theme} protocol card with value ${value}.
    Suggest 1-2 balanced effects following these patterns:
    - Low values (0-2): Draw/utility effects
    - Mid values (3-4): Moderate impact effects
    - High values (5-6): Powerful but risky effects`;

  const response = await callAI(prompt);
  return parseEffectsFromResponse(response);
};
```

### 6. Balance Checker

Analyze custom protocols for balance:

```typescript
const analyzeBalance = (protocol: CustomProtocolDefinition) => {
  let score = 0;

  protocol.cards.forEach(card => {
    card.effects.forEach(effect => {
      // Award points based on effect power
      if (effect.params.action === 'draw') {
        score += effect.params.count * 2;
      }
      if (effect.params.action === 'delete') {
        score += 5;
      }
      // etc.
    });

    // Deduct points for high card values (risk)
    score -= card.value;
  });

  return {
    score,
    rating: score < 20 ? 'Weak' : score < 40 ? 'Balanced' : 'Overpowered',
    suggestions: ['Consider adding a discard cost to value-5 card', ...],
  };
};
```

### 7. Template System

Provide pre-made templates:

```typescript
const TEMPLATES = {
  aggressive: {
    name: 'Aggressive Template',
    cards: [
      { value: 0, effects: [{ action: 'delete', count: 1, ... }] },
      { value: 1, effects: [{ action: 'discard', count: 1, actor: 'opponent', ... }] },
      // ...
    ]
  },

  control: {
    name: 'Control Template',
    cards: [
      { value: 0, effects: [{ action: 'flip', count: 1, ... }] },
      { value: 1, effects: [{ action: 'shift', ... }] },
      // ...
    ]
  },
};
```

---

## Testing Custom Protocols

### Unit Tests

Test effect generation:

```typescript
describe('Effect Generator', () => {
  it('should generate draw effect correctly', () => {
    const params: DrawEffectParams = {
      action: 'draw',
      count: 2,
      target: 'self',
      source: 'own_deck',
    };

    const effectFn = generateEffect(params);
    const mockCard = createMockCard();
    const mockState = createMockState();

    const result = effectFn(mockCard, 0, mockState, { cardOwner: 'player', opponent: 'opponent' });

    expect(result.newState.player.hand.length).toBe(mockState.player.hand.length + 2);
  });
});
```

### Integration Tests

Test in actual gameplay:

```typescript
describe('Custom Protocol Integration', () => {
  it('should register and execute custom protocol effects', () => {
    const customProtocol: CustomProtocolDefinition = {
      id: 'test-1',
      name: 'TestProtocol',
      cards: [
        { value: 0, effects: [{ params: { action: 'draw', count: 1, ... }, ... }] }
      ],
      // ...
    };

    registerCustomProtocol(customProtocol);

    const gameState = createGameWithProtocol('TestProtocol');
    const result = playCard(gameState, 'TestProtocol-0');

    expect(result.player.hand.length).toBe(initialHandSize + 1);
  });
});
```

---

## Limitations and Considerations

### Current Limitations

1. **No Complex Conditionals**: Effects like "Flip 1 card. If face-up, delete it" not yet supported
2. **No Multi-Target Effects**: Can't target "all cards in line" with one effect
3. **No Variable Calculations**: Can't reference other card values (e.g., "Draw X where X = this card's value")
4. **No Effect Combos**: Can't easily combine effects like "Draw 2 AND flip 1" in single effect slot

### Performance Considerations

- Custom protocols stored in localStorage (5-10MB limit)
- Effect generation happens at runtime (minimal overhead)
- Consider protocol count limit (e.g., max 20 custom protocols)

### Balance Concerns

- Players can create overpowered protocols
- Consider adding validation rules:
  - Max total effect "power" per protocol
  - Restrict certain combinations (e.g., no "Draw 6" on value-0)
  - Require balance between beneficial and detrimental effects

---

## Example: Creating a "Lightning" Protocol

```typescript
const lightningProtocol: CustomProtocolDefinition = {
  id: uuidv4(),
  name: 'Lightning',
  description: 'Fast and aggressive, focused on quick draws and disruption',
  author: 'Player',
  createdAt: new Date().toISOString(),
  cards: [
    {
      value: 0,
      effects: [
        {
          id: uuidv4(),
          params: {
            action: 'draw',
            count: 2,
            target: 'self',
            source: 'own_deck',
          },
          position: 'middle',
          trigger: 'on_play',
        }
      ]
    },
    {
      value: 1,
      effects: [
        {
          id: uuidv4(),
          params: {
            action: 'flip',
            count: 1,
            targetFilter: {
              owner: 'opponent',
              position: 'any',
              faceState: 'any',
              excludeSelf: false,
            },
            optional: false,
          },
          position: 'middle',
          trigger: 'on_play',
        }
      ]
    },
    {
      value: 2,
      effects: [
        {
          id: uuidv4(),
          params: {
            action: 'discard',
            count: 1,
            actor: 'opponent',
          },
          position: 'middle',
          trigger: 'on_play',
        }
      ]
    },
    // ... values 3-5
  ]
};

addCustomProtocol(lightningProtocol);
```

This creates a "Lightning" protocol where:
- **Lightning-0**: Draw 2 cards
- **Lightning-1**: Flip 1 opponent's card
- **Lightning-2**: Opponent discards 1
- etc.

---

## Conclusion

The Custom Protocol Creator provides a modular foundation for player-created content. By abstracting effects into parameterizable components, it enables creative deck building while maintaining game balance and consistency.

Future enhancements should focus on:
1. Better UI for configuring effect parameters
2. Balance checking and validation
3. Sharing and importing protocols
4. Advanced effect patterns (conditionals, chains, calculations)
