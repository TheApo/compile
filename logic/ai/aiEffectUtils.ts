/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player, PlayedCard } from '../../types';
import { getActivePassiveRules } from '../game/passiveRuleChecker';

/**
 * AI Effect Utilities
 *
 * Generic functions to check card effects without hardcoding protocol names.
 * These allow the AI to understand custom protocol cards by reading their customEffects.
 */

/**
 * Check if any passive rule forces face-down play (like Psychic-1)
 */
export function hasRequireFaceDownPlayRule(state: GameState, affectedPlayer: Player): boolean {
    const rules = getActivePassiveRules(state);
    const opponent = affectedPlayer === 'player' ? 'opponent' : 'player';

    return rules.some(({ rule, cardOwner }) => {
        if (rule.type !== 'require_face_down_play') return false;

        // Check if this rule applies to the affected player
        const appliesToPlayer =
            rule.target === 'all' ||
            (rule.target === 'opponent' && cardOwner !== affectedPlayer);

        return appliesToPlayer;
    });
}

/**
 * Check if a card has a "delete self when covered" effect (like Metal-6)
 */
export function hasDeleteSelfOnCoverEffect(card: PlayedCard): boolean {
    const customCard = card as any;
    if (!customCard.customEffects) return false;

    const bottomEffects = customCard.customEffects.bottomEffects || [];
    return bottomEffects.some((effect: any) => {
        return effect.trigger === 'on_cover' &&
            effect.params.action === 'delete' &&
            effect.params.deleteSelf === true;
    });
}

/**
 * Check if a card has a "return own card" requirement (like Water-4)
 */
export function hasReturnOwnCardEffect(card: PlayedCard): boolean {
    const customCard = card as any;
    if (!customCard.customEffects) return false;

    const allEffects = [
        ...(customCard.customEffects.topEffects || []),
        ...(customCard.customEffects.middleEffects || []),
        ...(customCard.customEffects.bottomEffects || [])
    ];

    return allEffects.some((effect: any) => {
        return effect.params.action === 'return' &&
            effect.params.targetFilter?.owner === 'own';
    });
}

/**
 * Check if a card has a "delete highest own card" effect (like Hate-2)
 */
export function hasDeleteHighestOwnCardEffect(card: PlayedCard): boolean {
    const customCard = card as any;
    if (!customCard.customEffects) return false;

    const allEffects = [
        ...(customCard.customEffects.topEffects || []),
        ...(customCard.customEffects.middleEffects || []),
        ...(customCard.customEffects.bottomEffects || [])
    ];

    return allEffects.some((effect: any) => {
        return effect.params.action === 'delete' &&
            effect.params.targetFilter?.owner === 'own' &&
            effect.params.targetFilter?.valueFilter === 'highest';
    });
}

/**
 * Check if a card has a passive value modifier (like Darkness-2 or Apathy-0)
 */
export function hasValueModifierEffect(card: PlayedCard): { hasModifier: boolean; modifier?: number; condition?: string } {
    const customCard = card as any;
    if (!customCard.customEffects) return { hasModifier: false };

    const topEffects = customCard.customEffects.topEffects || [];
    for (const effect of topEffects) {
        if (effect.trigger === 'passive' && effect.params.action === 'value_modifier') {
            return {
                hasModifier: true,
                modifier: effect.params.modifier,
                condition: effect.params.condition
            };
        }
    }

    return { hasModifier: false };
}

/**
 * Get the draw count from a card's effects (for evaluating card strength)
 */
export function getDrawCount(card: PlayedCard): number {
    const customCard = card as any;
    if (!customCard.customEffects) return 0;

    const allEffects = [
        ...(customCard.customEffects.topEffects || []),
        ...(customCard.customEffects.middleEffects || []),
        ...(customCard.customEffects.bottomEffects || [])
    ];

    let totalDraw = 0;
    for (const effect of allEffects) {
        if (effect.params.action === 'draw') {
            totalDraw += effect.params.count || 1;
        }
    }

    return totalDraw;
}

/**
 * Get the delete count from a card's effects (for evaluating disruption power)
 */
export function getDeleteCount(card: PlayedCard, targetOwner?: 'own' | 'opponent' | 'any'): number {
    const customCard = card as any;
    if (!customCard.customEffects) return 0;

    const allEffects = [
        ...(customCard.customEffects.topEffects || []),
        ...(customCard.customEffects.middleEffects || []),
        ...(customCard.customEffects.bottomEffects || [])
    ];

    let totalDelete = 0;
    for (const effect of allEffects) {
        if (effect.params.action === 'delete') {
            const effectOwner = effect.params.targetFilter?.owner || 'any';
            if (!targetOwner || targetOwner === 'any' || effectOwner === targetOwner || effectOwner === 'any') {
                totalDelete += effect.params.count || 1;
            }
        }
    }

    return totalDelete;
}

/**
 * Check if a card has a discard effect that affects opponent
 */
export function hasOpponentDiscardEffect(card: PlayedCard): { hasEffect: boolean; count?: number } {
    const customCard = card as any;
    if (!customCard.customEffects) return { hasEffect: false };

    const allEffects = [
        ...(customCard.customEffects.topEffects || []),
        ...(customCard.customEffects.middleEffects || []),
        ...(customCard.customEffects.bottomEffects || [])
    ];

    for (const effect of allEffects) {
        if (effect.params.action === 'discard' && effect.params.actor === 'opponent') {
            return { hasEffect: true, count: effect.params.count || 1 };
        }
    }

    return { hasEffect: false };
}

/**
 * Check if a card has any flip effects
 */
export function hasFlipEffect(card: PlayedCard): boolean {
    const customCard = card as any;
    if (!customCard.customEffects) return false;

    const allEffects = [
        ...(customCard.customEffects.topEffects || []),
        ...(customCard.customEffects.middleEffects || []),
        ...(customCard.customEffects.bottomEffects || [])
    ];

    return allEffects.some((effect: any) => effect.params.action === 'flip');
}

/**
 * Check if a card has any shift effects
 */
export function hasShiftEffect(card: PlayedCard): boolean {
    const customCard = card as any;
    if (!customCard.customEffects) return false;

    const allEffects = [
        ...(customCard.customEffects.topEffects || []),
        ...(customCard.customEffects.middleEffects || []),
        ...(customCard.customEffects.bottomEffects || [])
    ];

    return allEffects.some((effect: any) => effect.params.action === 'shift');
}

/**
 * Evaluate card's overall disruption power (higher = more disruptive)
 */
export function evaluateDisruptionPower(card: PlayedCard): number {
    let power = 0;

    // Delete opponent cards is strong
    power += getDeleteCount(card, 'opponent') * 50;

    // Opponent discard is good
    const discardEffect = hasOpponentDiscardEffect(card);
    if (discardEffect.hasEffect) {
        power += (discardEffect.count || 1) * 20;
    }

    // Flip and shift add some disruption
    if (hasFlipEffect(card)) power += 15;
    if (hasShiftEffect(card)) power += 10;

    return power;
}

/**
 * Evaluate card's overall value for AI decision making (higher = better to play)
 */
export function evaluateCardValue(card: PlayedCard, state: GameState, player: Player): number {
    let value = card.value * 10; // Base value from card value

    // Add disruption power
    value += evaluateDisruptionPower(card);

    // Draw cards is good
    value += getDrawCount(card) * 15;

    // Penalize cards that delete own cards
    if (hasDeleteHighestOwnCardEffect(card)) {
        value -= 30;
    }

    // Penalize cards that delete themselves when covered
    if (hasDeleteSelfOnCoverEffect(card)) {
        value -= 20;
    }

    return value;
}

/**
 * Check if a card has a "shift to/from this lane" restriction effect (like Gravity-1)
 */
export function hasShiftToFromLaneEffect(card: PlayedCard): boolean {
    const customCard = card as any;
    if (!customCard.customEffects) return false;

    const allEffects = [
        ...(customCard.customEffects.topEffects || []),
        ...(customCard.customEffects.middleEffects || []),
        ...(customCard.customEffects.bottomEffects || [])
    ];

    return allEffects.some((effect: any) => {
        return effect.params.action === 'shift' &&
            effect.params.laneRestriction === 'to_or_from_this_lane';
    });
}

/**
 * Check if a card has a "shift to non-matching protocol" restriction (like Anarchy-1)
 */
export function hasShiftToNonMatchingProtocolEffect(card: PlayedCard): boolean {
    const customCard = card as any;
    if (!customCard.customEffects) return false;

    const allEffects = [
        ...(customCard.customEffects.topEffects || []),
        ...(customCard.customEffects.middleEffects || []),
        ...(customCard.customEffects.bottomEffects || [])
    ];

    return allEffects.some((effect: any) => {
        return effect.params.action === 'shift' &&
            effect.params.laneRestriction === 'non_matching_protocol';
    });
}

/**
 * Check if a card has a face-down value modifier (like Darkness-2 or Apathy-0)
 */
export function getFaceDownValueModifier(card: PlayedCard): number {
    const customCard = card as any;
    if (!customCard.customEffects) return 0;

    const topEffects = customCard.customEffects.topEffects || [];
    for (const effect of topEffects) {
        if (effect.trigger === 'passive' && effect.params.action === 'value_modifier') {
            // Check for face-down specific modifiers
            if (effect.params.condition === 'per_face_down_card' ||
                effect.params.applyTo === 'face_down_cards') {
                return effect.params.modifier || 0;
            }
        }
    }

    return 0;
}

/**
 * Check if any card in a lane has a face-down value boost effect (like Darkness-2)
 */
export function getLaneFaceDownValueBoost(state: GameState, laneIndex: number): number {
    let boost = 0;

    for (const player of ['player', 'opponent'] as Player[]) {
        for (const card of state[player].lanes[laneIndex]) {
            if (card.isFaceUp) {
                const modifier = getFaceDownValueModifier(card);
                if (modifier > 0) {
                    boost = Math.max(boost, modifier);
                }
            }
        }
    }

    return boost;
}

/**
 * Get the effective value of a card considering lane modifiers
 */
export function getEffectiveCardValue(card: PlayedCard, state: GameState, laneIndex: number): number {
    if (card.isFaceUp) {
        return card.value;
    }

    // Face-down card - check for value modifiers in lane
    const boost = getLaneFaceDownValueBoost(state, laneIndex);
    return 2 + boost; // Base face-down value is 2
}
