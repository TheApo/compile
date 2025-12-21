/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player, PlayedCard } from '../../types';
import { PassiveRuleParams } from '../../types/customProtocol';

/**
 * Passive Rule Checker
 *
 * Scans all face-up custom protocol cards for passive rules and checks if an action is allowed.
 * This enables cards like Metal-2, Plague-0, Psychic-1, etc. to work for custom cards.
 */

interface PassiveRule {
    rule: PassiveRuleParams['rule'];
    cardOwner: Player;
    laneIndex: number;
    sourceCardId?: string;  // ID of the card that has this rule (for block_flip_this_card)
}

/**
 * Get all active passive rules from face-up custom cards AND original cards
 */
export function getActivePassiveRules(state: GameState): PassiveRule[] {
    const rules: PassiveRule[] = [];

    for (const player of ['player', 'opponent'] as Player[]) {
        state[player].lanes.forEach((lane, laneIndex) => {
            lane.forEach((card, cardIndex) => {
                if (card.isFaceUp) {
                    const customCard = card as any;

                    // Check custom protocol cards
                    if (customCard.customEffects) {
                        const isUncovered = cardIndex === lane.length - 1;

                        // Top effects: ALWAYS active when face-up (even if covered)
                        const topEffects = customCard.customEffects.topEffects || [];
                        topEffects.forEach((effect: any) => {
                            if (effect.params.action === 'passive_rule' && effect.trigger === 'passive') {
                                rules.push({
                                    rule: effect.params.rule,
                                    cardOwner: player,
                                    laneIndex,
                                    sourceCardId: card.id  // Track which card has this rule
                                });
                            }
                        });

                        // Middle effects: ALWAYS active when face-up (even if covered)
                        const middleEffects = customCard.customEffects.middleEffects || [];
                        middleEffects.forEach((effect: any) => {
                            if (effect.params.action === 'passive_rule' && effect.trigger === 'passive') {
                                rules.push({
                                    rule: effect.params.rule,
                                    cardOwner: player,
                                    laneIndex,
                                    sourceCardId: card.id  // Track which card has this rule
                                });
                            }
                        });

                        // Bottom effects: ONLY active when face-up AND uncovered (top card in stack)
                        if (isUncovered) {
                            const bottomEffects = customCard.customEffects.bottomEffects || [];
                            bottomEffects.forEach((effect: any) => {
                                if (effect.params.action === 'passive_rule' && effect.trigger === 'passive') {
                                    rules.push({
                                        rule: effect.params.rule,
                                        cardOwner: player,
                                        laneIndex,
                                        sourceCardId: card.id  // Track which card has this rule
                                    });
                                }
                            });
                        }
                    }

                    // BRIDGE: Handle original Frost-1 until it's migrated to custom protocol
                    if (card.protocol === 'Frost' && card.value === 1) {
                        // Top effect: block_flips (ALWAYS active when face-up, even if covered)
                        rules.push({
                            rule: { type: 'block_flips', target: 'all', scope: 'global' },
                            cardOwner: player,
                            laneIndex
                        });

                        // Bottom effect: block_protocol_rearrange (ONLY when uncovered)
                        const isUncovered = cardIndex === lane.length - 1;
                        if (isUncovered) {
                            rules.push({
                                rule: { type: 'block_protocol_rearrange', target: 'all', scope: 'global' },
                                cardOwner: player,
                                laneIndex
                            });
                        }
                    }

                    // BRIDGE: Handle original Frost-3 until it's migrated to custom protocol
                    if (card.protocol === 'Frost' && card.value === 3) {
                        // Top effect: block shifts from and to this lane (ALWAYS active when face-up, even if covered)
                        rules.push({
                            rule: { type: 'block_shifts_from_and_to_lane', target: 'all', scope: 'this_lane' },
                            cardOwner: player,
                            laneIndex
                        });
                    }
                }
            });
        });
    }

    return rules;
}

/**
 * Check if playing a card is allowed
 */
export function canPlayCard(
    state: GameState,
    player: Player,
    laneIndex: number,
    isFaceUp: boolean,
    cardProtocol: string,
    card?: PlayedCard,  // Optional: pass the card to check its own passive rules
    ignoreProtocolMatching?: boolean  // Optional: skip protocol matching check (Diversity-0 effect)
): { allowed: boolean; reason?: string } {
    const rules = getActivePassiveRules(state);
    const opponent = player === 'player' ? 'opponent' : 'player';

    const playerProtocol = state[player].protocols[laneIndex];
    const opponentProtocol = state[opponent].protocols[laneIndex];
    const protocolMatches = cardProtocol === playerProtocol || cardProtocol === opponentProtocol;

    // CRITICAL: Check if the CARD ITSELF has allow_play_on_opponent_side rule
    // Cards with this rule can play face-up on ANY lane (like allow_any_protocol_play)
    // Note: This rule can be in top, middle, OR bottom box - check all three
    let cardHasPlayAnywhereRule = false;
    let cardIgnoresProtocolMatching = false;
    if (card) {
        const customCard = card as any;
        const allEffects = [
            ...(customCard.customEffects?.topEffects || []),
            ...(customCard.customEffects?.middleEffects || []),
            ...(customCard.customEffects?.bottomEffects || [])
        ];
        cardHasPlayAnywhereRule = allEffects.some((effect: any) =>
            effect.params?.action === 'passive_rule' && effect.params?.rule?.type === 'allow_play_on_opponent_side'
        );
        // Check if card has ignore_protocol_matching card_property (e.g., Chaos-3 style effect)
        cardIgnoresProtocolMatching = allEffects.some((effect: any) =>
            effect.params?.action === 'card_property' && effect.params?.property === 'ignore_protocol_matching'
        );
    }

    for (const { rule, cardOwner, laneIndex: ruleLaneIndex } of rules) {
        const appliesToLane = rule.scope === 'global' || ruleLaneIndex === laneIndex;
        const appliesToPlayer =
            rule.target === 'all' ||
            (rule.target === 'self' && cardOwner === player) ||
            (rule.target === 'opponent' && cardOwner === opponent);

        if (!appliesToLane || !appliesToPlayer) continue;

        switch (rule.type) {
            case 'block_all_play':
                return { allowed: false, reason: `Cannot play cards in this lane (passive rule)` };

            case 'block_face_down_play':
                if (!isFaceUp) {
                    return { allowed: false, reason: `Cannot play cards face-down in this lane (passive rule)` };
                }
                break;

            case 'block_face_up_play':
                if (isFaceUp) {
                    return { allowed: false, reason: `Cannot play cards face-up in this lane (passive rule)` };
                }
                break;

            case 'require_face_down_play':
                if (isFaceUp) {
                    return { allowed: false, reason: `Can only play cards face-down (passive rule)` };
                }
                break;

            case 'allow_any_protocol_play':
                // This rule ALLOWS playing, doesn't block
                // Will be checked in playCard logic
                break;

            case 'require_non_matching_protocol':
                if (isFaceUp && protocolMatches) {
                    return { allowed: false, reason: `Can only play cards without matching protocols (passive rule)` };
                }
                break;
        }
    }

    // CRITICAL: Check if there's an 'allow_any_protocol_play' rule that would bypass protocol matching
    const hasAnyProtocolRule = rules.some(({ rule, cardOwner, laneIndex: ruleLaneIndex }) => {
        if (rule.type !== 'allow_any_protocol_play') return false;
        const appliesToLane = rule.scope === 'global' || ruleLaneIndex === laneIndex;
        const appliesToPlayer =
            rule.target === 'all' ||
            (rule.target === 'self' && cardOwner === player) ||
            (rule.target === 'opponent' && cardOwner === opponent);
        return appliesToLane && appliesToPlayer;
    });

    // CRITICAL: Check if there's a 'require_non_matching_protocol' rule (Anarchy-1)
    // If active, the BASE RULE is INVERTED - non-matching is required, matching is blocked
    const hasNonMatchingRule = rules.some(({ rule, cardOwner, laneIndex: ruleLaneIndex }) => {
        if (rule.type !== 'require_non_matching_protocol') return false;
        const appliesToLane = rule.scope === 'global' || ruleLaneIndex === laneIndex;
        const appliesToPlayer =
            rule.target === 'all' ||
            (rule.target === 'self' && cardOwner === player) ||
            (rule.target === 'opponent' && cardOwner === opponent);
        return appliesToLane && appliesToPlayer;
    });

    // CRITICAL: Check if same-protocol face-up play rule allows this (Unity-1 Bottom)
    const hasSameProtocolFaceUpRule = canPlayFaceUpDueToSameProtocolRule(state, player, laneIndex, cardProtocol);

    // BASE RULE: Face-up play requires matching protocol (unless bypassed by passive rule)
    // EXCEPTION: If require_non_matching_protocol is active, the rule is INVERTED
    // (non-matching is required, which was already checked above in the switch)
    // EXCEPTION: Cards with allow_play_on_opponent_side can play face-up on ANY lane
    // EXCEPTION: Same-protocol face-up play rule allows face-up play for cards of that protocol
    // EXCEPTION: Cards with ignore_protocol_matching card_property can play face-up on ANY lane
    // EXCEPTION: ignoreProtocolMatching flag from effect (Diversity-0 "in this line" play)
    if (isFaceUp && !protocolMatches && !hasAnyProtocolRule && !hasNonMatchingRule && !cardHasPlayAnywhereRule && !hasSameProtocolFaceUpRule && !cardIgnoresProtocolMatching && !ignoreProtocolMatching) {
        return { allowed: false, reason: `Face-up play requires matching protocol` };
    }

    return { allowed: true };
}

/**
 * Check if any face-up card requires non-matching protocols (Anarchy-1 custom)
 * This affects BOTH players globally
 */
export function hasRequireNonMatchingProtocolRule(state: GameState): boolean {
    const rules = getActivePassiveRules(state);

    return rules.some(({ rule }) => {
        return rule.type === 'require_non_matching_protocol' && rule.scope === 'global';
    });
}

/**
 * Check if protocol matching rules should be ignored (Spirit-1 style - global passive effect)
 * NOTE: Chaos-3 uses card_property instead (only affects that card being played, not all cards)
 */
export function hasAnyProtocolPlayRule(state: GameState, player: Player, laneIndex?: number): boolean {
    const rules = getActivePassiveRules(state);
    const opponent = player === 'player' ? 'opponent' : 'player';

    return rules.some(({ rule, cardOwner, laneIndex: ruleLaneIndex }) => {
        if (rule.type !== 'allow_any_protocol_play') return false;

        const appliesToLane = rule.scope === 'global' || (laneIndex !== undefined && ruleLaneIndex === laneIndex);
        const appliesToPlayer =
            rule.target === 'all' ||
            (rule.target === 'self' && cardOwner === player) ||
            (rule.target === 'opponent' && cardOwner === opponent);

        return appliesToLane && appliesToPlayer;
    });
}

/**
 * Check if a specific card can be played on opponent's side (Corruption-0)
 * Returns true if the card has the allow_play_on_opponent_side passive rule
 */
export function hasPlayOnOpponentSideRule(state: GameState, card: PlayedCard): boolean {
    // Check if the card itself has a bottom effect with allow_play_on_opponent_side
    const customEffects = (card as any).customEffects;
    if (!customEffects) return false;

    const bottomEffects = customEffects.bottomEffects || [];
    return bottomEffects.some((effect: any) => {
        if (effect.params?.action !== 'passive_rule') return false;
        return effect.params?.rule?.type === 'allow_play_on_opponent_side';
    });
}

/**
 * Check if flipping is blocked (Frost-1)
 */
export function canFlipCard(state: GameState, laneIndex: number): { allowed: boolean; reason?: string } {
    const rules = getActivePassiveRules(state);

    for (const { rule, laneIndex: ruleLaneIndex } of rules) {
        if (rule.type !== 'block_flips') continue;

        const appliesToLane = rule.scope === 'global' || ruleLaneIndex === laneIndex;
        if (!appliesToLane) continue;

        return { allowed: false, reason: `Cards cannot be flipped face-up in this lane (passive rule)` };
    }

    return { allowed: true };
}

/**
 * Check if shifting is blocked (Frost-3)
 */
export function canShiftCard(
    state: GameState,
    fromLaneIndex: number,
    toLaneIndex: number
): { allowed: boolean; reason?: string } {
    const rules = getActivePassiveRules(state);

    for (const { rule, laneIndex: ruleLaneIndex } of rules) {
        // Check FROM lane
        if (rule.type === 'block_shifts_from_lane' && ruleLaneIndex === fromLaneIndex) {
            const appliesToLane = rule.scope === 'global' || true; // FROM is always specific lane
            if (appliesToLane) {
                return { allowed: false, reason: `Cards cannot shift from this lane (passive rule)` };
            }
        }

        // Check TO lane
        if (rule.type === 'block_shifts_to_lane' && ruleLaneIndex === toLaneIndex) {
            const appliesToLane = rule.scope === 'global' || true; // TO is always specific lane
            if (appliesToLane) {
                return { allowed: false, reason: `Cards cannot shift to this lane (passive rule)` };
            }
        }

        // NEW: Frost-3 and Frost_custom-3: block shifts FROM AND TO this lane
        if (rule.type === 'block_shifts_from_and_to_lane') {
            const blocksFrom = ruleLaneIndex === fromLaneIndex;
            const blocksTo = ruleLaneIndex === toLaneIndex;

            if (blocksFrom || blocksTo) {
                return { allowed: false, reason: `Cards cannot shift from or to this lane (passive rule)` };
            }
        }
    }

    return { allowed: true };
}

/**
 * Check if protocol rearrangement is blocked (Frost-1)
 */
export function canRearrangeProtocols(state: GameState): { allowed: boolean; reason?: string } {
    const rules = getActivePassiveRules(state);

    for (const { rule } of rules) {
        if (rule.type === 'block_protocol_rearrange') {
            return { allowed: false, reason: `Protocols cannot be rearranged (passive rule)` };
        }
    }

    return { allowed: true };
}

/**
 * Check if middle commands should be ignored in a lane
 * @param state - Current game state
 * @param laneIndex - Lane to check
 * @param cardOwnerToCheck - Optional: only check if the card owner's middle commands should be ignored
 *                           This is used for "ignore opponent's middle commands" rules
 */
export function shouldIgnoreMiddleCommand(
    state: GameState,
    laneIndex: number,
    cardOwnerToCheck?: Player
): boolean {
    return getMiddleCommandBlocker(state, laneIndex, cardOwnerToCheck) !== null;
}

/**
 * Get the card that is blocking middle commands in a lane
 * Returns the blocking card, or null if no block is active
 * @param state - Current game state
 * @param laneIndex - Lane to check
 * @param cardOwnerToCheck - Optional: only check if the card owner's middle commands should be ignored
 */
export function getMiddleCommandBlocker(
    state: GameState,
    laneIndex: number,
    cardOwnerToCheck?: Player
): PlayedCard | null {
    const rules = getActivePassiveRules(state);
    // FIX: Use state.turn instead of non-existent state.currentPlayer
    const currentPlayer = state.turn;

    for (const { rule, cardOwner, laneIndex: ruleLaneIndex, sourceCardId } of rules) {
        if (rule.type !== 'ignore_middle_commands') continue;

        // Check if rule applies to this lane
        const appliesToLane = rule.scope === 'global' || ruleLaneIndex === laneIndex;
        if (!appliesToLane) continue;

        // Check onlyDuringYourTurn: rule only applies if it's the rule owner's turn
        if (rule.onlyDuringYourTurn && currentPlayer !== cardOwner) {
            continue;
        }

        // Check target: if rule targets 'opponent', only apply to opponent's cards
        if (cardOwnerToCheck !== undefined) {
            const opponent = cardOwner === 'player' ? 'opponent' : 'player';
            if (rule.target === 'opponent' && cardOwnerToCheck !== opponent) {
                continue;
            }
            if (rule.target === 'self' && cardOwnerToCheck !== cardOwner) {
                continue;
            }
            // 'all' target applies to everyone
        }

        // Find the card that has this rule
        if (sourceCardId) {
            for (const player of ['player', 'opponent'] as Player[]) {
                for (const lane of state[player].lanes) {
                    const card = lane.find(c => c.id === sourceCardId);
                    if (card) {
                        return card;
                    }
                }
            }
        }

        // Fallback: couldn't find specific card
        return null;
    }

    return null;
}

/**
 * Check if any Frost-1 (block_flips) is active globally
 * Legacy helper for code that needs a simple boolean check
 */
export function isFrost1Active(state: GameState): boolean {
    const rules = getActivePassiveRules(state);
    return rules.some(({ rule }) => rule.type === 'block_flips' && rule.scope === 'global');
}

/**
 * Check if Frost-1 bottom effect (block_protocol_rearrange) is active
 * Legacy helper for code that needs a simple boolean check
 */
export function isFrost1BottomActive(state: GameState): boolean {
    const rules = getActivePassiveRules(state);
    return rules.some(({ rule }) => rule.type === 'block_protocol_rearrange');
}

/**
 * Check if a SPECIFIC card can be flipped (Ice-4: block_flip_this_card)
 * Different from canFlipCard which checks lane-based block_flips rules
 * @param state Current game state
 * @param cardId ID of the card to check
 * @returns Whether the specific card can be flipped
 */
export function canFlipSpecificCard(
    state: GameState,
    cardId: string
): { allowed: boolean; reason?: string } {
    const rules = getActivePassiveRules(state);

    for (const { rule, sourceCardId } of rules) {
        // Check block_flip_this_card - only blocks the card that has this rule
        if (rule.type === 'block_flip_this_card' && sourceCardId === cardId) {
            return {
                allowed: false,
                reason: `This card cannot be flipped (passive rule)`
            };
        }
    }

    return { allowed: true };
}

/**
 * Check if a player can draw cards (Ice-6: block_draw_conditional)
 * Supports flexible condition and block targets
 * @param state Current game state
 * @param player Player who wants to draw
 * @returns Whether the player can draw
 */
export function canPlayerDraw(
    state: GameState,
    player: Player
): { allowed: boolean; reason?: string } {
    const rules = getActivePassiveRules(state);

    for (const { rule, cardOwner } of rules) {
        if (rule.type === 'block_draw_conditional') {
            // Determine who must have cards for the condition to apply
            const conditionTarget = (rule as any).conditionTarget || 'self';
            const conditionPlayer = conditionTarget === 'self' ? cardOwner :
                                   (cardOwner === 'player' ? 'opponent' : 'player');

            // Determine who is blocked from drawing
            const blockTarget = (rule as any).blockTarget || 'self';
            let blockedPlayer: Player | 'all';
            if (blockTarget === 'self') {
                blockedPlayer = cardOwner;
            } else if (blockTarget === 'opponent') {
                blockedPlayer = cardOwner === 'player' ? 'opponent' : 'player';
            } else {
                blockedPlayer = 'all';
            }

            // Check if the condition is met (condition player has cards in hand)
            if (state[conditionPlayer].hand.length > 0) {
                // Condition met - check if this player is blocked
                if (blockedPlayer === 'all' || blockedPlayer === player) {
                    return {
                        allowed: false,
                        reason: `Cannot draw cards (passive rule)`
                    };
                }
            }
        }
    }

    return { allowed: true };
}

/**
 * Check if a card can be played face-up due to same-protocol face-up play rule (Unity-1 Bottom)
 * This rule allows cards of the same protocol to be played face-up in the lane with this rule.
 *
 * @param state Current game state
 * @param player Player who wants to play
 * @param laneIndex Lane to play in
 * @param cardProtocol Protocol of the card being played
 * @returns true if face-up play is allowed due to same-protocol rule
 */
export function canPlayFaceUpDueToSameProtocolRule(
    state: GameState,
    player: Player,
    laneIndex: number,
    cardProtocol: string
): boolean {
    const rules = getActivePassiveRules(state);

    for (const { rule, cardOwner, laneIndex: ruleLaneIndex } of rules) {
        if (rule.type !== 'allow_same_protocol_face_up_play') continue;
        if (rule.scope !== 'this_lane' || ruleLaneIndex !== laneIndex) continue;
        if (cardOwner !== player) continue;

        // Find the source card's protocol
        // The rule allows cards of the SAME protocol as the source card
        // to be played face-up in this lane
        if ((rule as any).protocolScope === 'same_as_source') {
            // Find the card that has this rule in the lane
            const lane = state[cardOwner].lanes[ruleLaneIndex];
            for (let i = 0; i < lane.length; i++) {
                const card = lane[i];
                if (!card.isFaceUp) continue;
                // CRITICAL: Card must be UNCOVERED (last in lane or not covered by another card)
                const isUncovered = i === lane.length - 1;
                if (!isUncovered) continue;

                const customCard = card as any;
                if (!customCard.customEffects) continue;

                // Check if this card has the allow_same_protocol_face_up_play rule
                const allEffects = [
                    ...(customCard.customEffects.topEffects || []),
                    ...(customCard.customEffects.middleEffects || []),
                    ...(customCard.customEffects.bottomEffects || [])
                ];

                const hasRule = allEffects.some((effect: any) =>
                    effect.params?.action === 'passive_rule' &&
                    effect.params?.rule?.type === 'allow_same_protocol_face_up_play'
                );

                // If this card has the rule AND its protocol matches the card being played
                if (hasRule && card.protocol === cardProtocol) {
                    return true;
                }
            }
        }
    }
    return false;
}
