# Custom Protocol Migration Guide

## Goal

Convert all 18 original protocols (Anarchy, Apathy, Chaos, Darkness, Death, Fire, Frost, Gravity, Hate, Life, Light, Love, Metal, Plague, Psychic, Speed, Spirit, Water) to custom protocol format using **only composable, generic effect parameters**.

**Key Principles**:
- ✅ No card-specific code - everything through parameters
- ✅ All effects must be configurable via UI
- ✅ Full parity with original functionality
- ✅ Easy to use and understand in the editor

---

## Migration Checklist

For each protocol being migrated:

### 1. Analysis Phase

- [ ] List all 6 cards (value 0-5) with their effects
- [ ] Identify effect positions (top/middle/bottom)
- [ ] Identify triggers (on_play, start, end, on_cover)
- [ ] Note special mechanics (conditionals, chains, passive rules)
- [ ] Check for interactions with other cards (Frost-1, Apathy-2, etc.)

### 2. Parameter Mapping Phase

- [ ] Map each effect to a standard effect type (draw, flip, shift, delete, etc.)
- [ ] Define all parameters (count, filters, scope, conditionals)
- [ ] Identify any missing effect types or parameters
- [ ] Design conditional chains for complex effects

### 3. Implementation Phase

- [ ] Create JSON definition with all 6 cards
- [ ] Test each card individually
- [ ] Test card combinations
- [ ] Test against other protocols
- [ ] Verify log messages are correct
- [ ] Check for softlocks with no valid targets

### 4. Validation Phase

- [ ] Compare with original card behavior
- [ ] Test edge cases (empty board, full hand, etc.)
- [ ] Verify all UI elements work (checkboxes, dropdowns, etc.)
- [ ] Ensure export/import works
- [ ] Document any differences from original

---

## Available Effect Types

### Core Effects

1. **draw**: Draw cards from deck
   - Parameters: count, target, source, conditional, preAction
   - Examples: "Draw 2 cards", "Draw 1 for each face-down card"

2. **flip**: Flip cards face-up/face-down
   - Parameters: count, targetFilter, optional, selfFlipAfter
   - Examples: "Flip 1 card", "May flip 2 covered cards"

3. **shift**: Move cards between lanes
   - Parameters: count, targetFilter, destination
   - Examples: "Shift 1 card", "Shift this card"

4. **delete**: Remove cards from board
   - Parameters: count, targetFilter, scope, protocolMatching, excludeSelf
   - Examples: "Delete 1 card", "Delete all in lane with value 1-2"

5. **discard**: Discard from hand
   - Parameters: count, actor, conditional
   - Examples: "Discard 1", "Opponent discards 2"

6. **return**: Return cards to hand
   - Parameters: count, targetFilter
   - Examples: "Return 1 card to hand"

7. **play**: Play cards from hand/deck
   - Parameters: count, faceState, destination, source
   - Examples: "Play 1 card face-down"

8. **rearrange_protocols** / **swap_protocols**: Protocol manipulation
   - Parameters: target, restriction
   - Examples: "Rearrange your protocols", "Swap 2 opponent protocols"

9. **reveal** / **give**: Hand manipulation
   - Parameters: count, optional
   - Examples: "Reveal 1 hand card", "Give 1 card to opponent"

10. **take**: Take from opponent's hand
    - Parameters: count, random
    - Examples: "Take 1 card from opponent"

### Advanced Effects

11. **passive_rule**: Ongoing restrictions
    - Parameters: ruleType, condition, target
    - Examples: "Opponent cannot compile if hand > 3"

12. **reactive_trigger**: Respond to events
    - Parameters: eventType, condition, reaction
    - Examples: "When opponent plays, flip 1 card"

13. **value_modifier**: Dynamic value changes
    - Parameters: modifierType, value, scope
    - Examples: "+1 to all cards in this line"

14. **choice**: Player chooses between effects
    - Parameters: options (array of effect params)
    - Examples: "Draw 2 OR delete 1"

---

## Effect Position Rules

### Top Box (position: 'top')

**When Active**: Always when card is face-up (even if covered)

**Typical Triggers**:
- `on_play` - Activates when played/uncovered

**Use Cases**:
- Passive rules (ongoing restrictions)
- Value modifiers (stat changes)
- Reactive triggers (event responses)

**Examples**:
- "Opponent cannot play cards with value > 4"
- "+1 to all cards in this line"
- "When opponent plays card, flip 1 card"

### Middle Box (position: 'middle')

**When Active**: Only when card is uncovered

**Typical Triggers**:
- `on_play` (default) - When played or becomes uncovered
- `on_uncover` - When becomes uncovered (same as on_play)

**Use Cases**:
- Primary card effects
- Draw/delete/flip/shift effects
- Most standard actions

**Blocked By**: Apathy-2 in same lane

**Examples**:
- "Draw 2 cards"
- "Delete 1 card"
- "Flip 1 card. Flip this card."

### Bottom Box (position: 'bottom')

**When Active**: Only when card is uncovered AND face-up

**Typical Triggers**:
- `start` - Start of turn
- `end` - End of turn
- `on_cover` - When about to be covered

**Use Cases**:
- Turn-based effects
- Triggered actions
- Reaction to being covered

**Examples**:
- "Start: Draw 1 card"
- "End: Flip 1 card"
- "When covered: Return this to hand"

---

## Conditional Chains

### Optional Effects

Use `optional: true` to make effects skippable:

```typescript
{
  params: { action: "draw", count: 1, optional: true }
}
```
Generates: "You may draw 1 card."

### If-Then Chains

Use `conditional.type: "if_executed"` for conditional effects:

```typescript
{
  params: { action: "draw", count: 1, optional: true },
  conditional: {
    type: "if_executed",
    thenEffect: {
      params: { action: "delete", count: 1, excludeSelf: true }
    }
  }
}
```
Generates: "You may draw 1 card. If you do, delete 1 other card."

### Sequential Chains

Use `conditional.type: "then"` for sequential effects:

```typescript
{
  params: { action: "flip", count: 1 },
  conditional: {
    type: "then",
    thenEffect: {
      params: { action: "flip", count: 1, deleteSelf: true }
    }
  }
}
```
Generates: "Flip 1 card. Flip this card."

### Multi-Step Chains

Nest conditionals for complex chains:

```typescript
{
  params: { action: "draw", count: 1, optional: true },
  conditional: {
    type: "if_executed",
    thenEffect: {
      params: { action: "delete", count: 1, excludeSelf: true },
      conditional: {
        type: "then",
        thenEffect: {
          params: { action: "delete", count: 1, deleteSelf: true }
        }
      }
    }
  }
}
```
Generates: "You may draw 1 card. If you do, delete 1 other card, then delete this card."

---

## Target Filtering

### Owner Filter

```typescript
targetFilter: {
  owner: 'any' | 'own' | 'opponent'
}
```

- `any`: Both players' cards
- `own`: Your cards only
- `opponent`: Opponent's cards only

### Position Filter

```typescript
targetFilter: {
  position: 'any' | 'covered' | 'uncovered' | 'covered_in_this_line'
}
```

- `any`: All cards
- `covered`: Cards with other cards on top
- `uncovered`: Top cards in stacks
- `covered_in_this_line`: Covered cards in same lane

### Face State Filter

```typescript
targetFilter: {
  faceState: 'any' | 'face_up' | 'face_down'
}
```

### Value Range Filter

```typescript
targetFilter: {
  valueRange: { min: 0, max: 2 }
}
```

Filters cards by value (respects face-down = 2 or 4 with Darkness-2).

### Exclude Self

```typescript
targetFilter: {
  excludeSelf: true
}
```

Prevents selecting the source card itself.

### Combined Filters

```typescript
targetFilter: {
  owner: 'opponent',
  position: 'uncovered',
  faceState: 'face_up',
  valueRange: { min: 3, max: 5 },
  excludeSelf: false
}
```

Targets: "Opponent's uncovered face-up cards with value 3-5"

---

## Scope Definitions

For delete/return effects, scope defines where to look:

### Anywhere

```typescript
scope: { type: 'anywhere' }
```

Any card on the board (respects filters).

### Other Lanes

```typescript
scope: { type: 'other_lanes' }
```

Cards in lanes other than source card's lane.

### This Line

```typescript
scope: { type: 'this_line' }
```

Cards in same lane as source card.

### Specific Lane

```typescript
scope: {
  type: 'specific_lane',
  allowedLanes: [0, 1]  // Left and middle only
}
```

Cards in specific lanes.

### Each Other Line

```typescript
scope: { type: 'each_other_line' }
```

One card from EACH other lane (multi-step selection).

---

## Common Patterns

### 1. Simple Draw

```json
{
  "id": "draw-2",
  "params": {
    "action": "draw",
    "count": 2,
    "target": "self",
    "source": "own_deck"
  },
  "position": "middle",
  "trigger": "on_play"
}
```

### 2. Conditional Draw

```json
{
  "id": "draw-per-face-down",
  "params": {
    "action": "draw",
    "count": 1,
    "target": "self",
    "source": "own_deck",
    "conditional": {
      "type": "count_face_down"
    }
  },
  "position": "middle",
  "trigger": "on_play"
}
```

### 3. Delete with Filters

```json
{
  "id": "delete-low-value",
  "params": {
    "action": "delete",
    "count": 1,
    "targetFilter": {
      "owner": "any",
      "position": "uncovered",
      "faceState": "any",
      "valueRange": { "min": 0, "max": 1 },
      "excludeSelf": true
    },
    "scope": { "type": "anywhere" }
  },
  "position": "middle",
  "trigger": "on_play"
}
```

### 4. Self-Flip After Shift

```json
{
  "id": "shift-then-flip",
  "params": {
    "action": "shift",
    "count": 1,
    "targetFilter": {
      "owner": "own",
      "position": "uncovered",
      "faceState": "face_up",
      "excludeSelf": true
    }
  },
  "position": "bottom",
  "trigger": "end",
  "conditional": {
    "type": "then",
    "thenEffect": {
      "id": "self-flip",
      "params": {
        "action": "flip",
        "count": 1,
        "deleteSelf": true
      }
    }
  }
}
```

### 5. Passive Rule

```json
{
  "id": "prevent-high-cards",
  "params": {
    "action": "passive_rule",
    "ruleType": "prevent_play",
    "condition": {
      "type": "card_value",
      "comparison": "greater_than",
      "value": 3
    },
    "target": "opponent"
  },
  "position": "top",
  "trigger": "on_play"
}
```

### 6. Reactive Trigger

```json
{
  "id": "react-to-delete",
  "params": {
    "action": "reactive_trigger",
    "eventType": "after_delete",
    "condition": {
      "type": "card_deleted_by",
      "player": "opponent"
    },
    "reaction": {
      "id": "draw-reaction",
      "params": {
        "action": "draw",
        "count": 1,
        "target": "self",
        "source": "own_deck"
      }
    }
  },
  "position": "top",
  "trigger": "on_play"
}
```

---

## Migration Examples

### Example 1: Death Protocol

**Original Cards**:
- Death-0: Delete 1 card from each other line
- Death-1: You may draw 1. If you do, delete 1 other card, then delete this card
- Death-2: Delete all cards with value 1 or 2 in 1 line
- Death-3: Delete 1 card with value 2 or less
- Death-4: Delete 1 uncovered card with value 0 or 1
- Death-5: Start: Delete 1 card

**Custom Protocol Definition**:

```json
{
  "name": "Death",
  "description": "Focused on deletion and sacrifice",
  "color": "#E25656",
  "pattern": "skulls",
  "cards": [
    {
      "value": 0,
      "middleEffects": [
        {
          "id": "death-0-delete",
          "params": {
            "action": "delete",
            "count": 1,
            "targetFilter": {
              "owner": "any",
              "position": "uncovered",
              "faceState": "any",
              "excludeSelf": false
            },
            "scope": { "type": "each_other_line" }
          },
          "position": "middle",
          "trigger": "on_play"
        }
      ]
    },
    {
      "value": 1,
      "middleEffects": [
        {
          "id": "death-1-draw",
          "params": {
            "action": "draw",
            "count": 1,
            "target": "self",
            "source": "own_deck",
            "optional": true
          },
          "position": "middle",
          "trigger": "on_play",
          "conditional": {
            "type": "if_executed",
            "thenEffect": {
              "id": "death-1-delete-other",
              "params": {
                "action": "delete",
                "count": 1,
                "targetFilter": {
                  "excludeSelf": true
                }
              },
              "conditional": {
                "type": "then",
                "thenEffect": {
                  "id": "death-1-delete-self",
                  "params": {
                    "action": "delete",
                    "count": 1,
                    "deleteSelf": true
                  }
                }
              }
            }
          }
        }
      ]
    }
  ]
}
```

### Example 2: Water Protocol

**Water-0**: Flip 1 other card. Flip this card.

```json
{
  "value": 0,
  "middleEffects": [
    {
      "id": "water-0-flip",
      "params": {
        "action": "flip",
        "count": 1,
        "targetFilter": {
          "owner": "any",
          "position": "any",
          "faceState": "any",
          "excludeSelf": true
        }
      },
      "position": "middle",
      "trigger": "on_play",
      "conditional": {
        "type": "then",
        "thenEffect": {
          "id": "water-0-self-flip",
          "params": {
            "action": "flip",
            "count": 1,
            "deleteSelf": true
          }
        }
      }
    }
  ]
}
```

---

## Testing Strategy

### Unit Testing

For each card:

1. **No Targets Test**: Ensure effect skips gracefully when no valid targets
2. **Single Target Test**: Verify effect works with exactly one valid target
3. **Multiple Targets Test**: Verify UI shows correct options
4. **Conditional Test**: Test both branches of optional/conditional effects

### Integration Testing

1. **Protocol vs Protocol**: Test against other protocols
2. **Game Rules**: Verify Frost-1, Apathy-2, Plague-0 interactions
3. **Edge Cases**: Empty board, full hand, all face-down, etc.
4. **Softlock Check**: Ensure no infinite loops or stuck states

### Comparison Testing

1. **Side-by-Side**: Play original and custom version in same scenario
2. **Log Comparison**: Verify log messages match
3. **Behavior Verification**: Ensure identical outcomes

---

## UI Configurability Requirements

All parameters must be configurable via UI:

### Must Have

- ✅ Dropdown for effect type (draw, flip, delete, etc.)
- ✅ Number inputs for counts (with min/max validation)
- ✅ Checkboxes for boolean flags (optional, excludeSelf, etc.)
- ✅ Nested dropdowns for filters (owner, position, faceState)
- ✅ Value range inputs (min/max)
- ✅ Conditional editor (if_executed, then)
- ✅ Position selector (top/middle/bottom)
- ✅ Trigger selector (on_play, start, end, on_cover)

### Should Have

- ✅ Preview of generated text
- ✅ Validation error messages
- ✅ Helpful tooltips
- ✅ Example templates

### Nice to Have

- Visual card preview
- Balance checker
- AI suggestions
- Community templates

---

## Common Pitfalls

### 1. Forgetting Position Requirements

❌ **Wrong**: Top effect with trigger `start`
✅ **Correct**: Bottom effect with trigger `start`

### 2. Missing Target Validation

❌ **Wrong**: Delete effect without `optional: true` when targets might not exist
✅ **Correct**: Add `optional: true` or ensure targets always exist

### 3. Incorrect Filter Combinations

❌ **Wrong**: `owner: 'own', excludeSelf: false` for self-targeting
✅ **Correct**: Use `deleteSelf: true` for self-targeting delete

### 4. Overcomplicated Chains

❌ **Wrong**: 5-level nested conditionals
✅ **Correct**: Break into multiple effects or simplify logic

### 5. Missing Scope Definition

❌ **Wrong**: Delete effect without scope (assumes 'anywhere')
✅ **Correct**: Explicitly set scope for clarity

---

## Migration Status Tracking

Use this checklist to track progress:

### Original Protocols (18 total)

- [ ] Anarchy
- [ ] Apathy
- [ ] Chaos
- [ ] Darkness
- [ ] Death ✅ (Example completed)
- [ ] Fire ✅
- [ ] Frost
- [ ] Gravity
- [ ] Hate
- [ ] Life
- [ ] Light
- [ ] Love
- [ ] Metal
- [ ] Plague
- [ ] Psychic
- [ ] Speed
- [ ] Spirit
- [ ] Water

### Per Protocol Checklist

For each protocol:

- [ ] All 6 cards analyzed
- [ ] Parameters mapped
- [ ] JSON created
- [ ] Cards tested individually
- [ ] Cards tested together
- [ ] Tested vs other protocols
- [ ] Edge cases tested
- [ ] Comparison with original verified
- [ ] Export/import tested
- [ ] Documentation updated

---

## Success Criteria

A protocol is successfully migrated when:

1. ✅ All 6 cards functional via custom protocol system
2. ✅ No card-specific code in codebase
3. ✅ All parameters configurable in UI
4. ✅ Behavior matches original exactly
5. ✅ Log messages match original
6. ✅ No softlocks or bugs
7. ✅ Export/import works correctly
8. ✅ Can be combined with any other protocol

---

## Conclusion

This guide provides a systematic approach to migrating all original protocols to the custom protocol system. By following these patterns and guidelines, each protocol can be faithfully recreated using only composable, generic effect parameters.

**Key Takeaways**:
- Use effect types + parameters, never card-specific code
- Test thoroughly, especially edge cases
- Ensure full UI configurability
- Validate against original behavior
- Document any necessary deviations
