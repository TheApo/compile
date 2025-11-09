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
}

/**
 * Get all active passive rules from face-up custom cards
 */
export function getActivePassiveRules(state: GameState): PassiveRule[] {
    const rules: PassiveRule[] = [];

    for (const player of ['player', 'opponent'] as Player[]) {
        state[player].lanes.forEach((lane, laneIndex) => {
            lane.forEach(card => {
                if (card.isFaceUp) {
                    const customCard = card as any;
                    if (customCard.customEffects) {
                        // Check all three boxes for passive rules
                        const allEffects = [
                            ...(customCard.customEffects.topEffects || []),
                            ...(customCard.customEffects.middleEffects || []),
                            ...(customCard.customEffects.bottomEffects || [])
                        ];

                        allEffects.forEach((effect: any) => {
                            if (effect.params.action === 'passive_rule' && effect.trigger === 'passive') {
                                rules.push({
                                    rule: effect.params.rule,
                                    cardOwner: player,
                                    laneIndex
                                });
                            }
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
    cardProtocol: string
): { allowed: boolean; reason?: string } {
    const rules = getActivePassiveRules(state);
    const opponent = player === 'player' ? 'opponent' : 'player';

    const playerProtocol = state[player].protocols[laneIndex];
    const opponentProtocol = state[opponent].protocols[laneIndex];
    const protocolMatches = cardProtocol === playerProtocol || cardProtocol === opponentProtocol;

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
 * Check if protocol matching rules should be ignored (Spirit-1, Chaos-3)
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
 * Check if middle commands should be ignored in a lane (Apathy-2)
 */
export function shouldIgnoreMiddleCommand(state: GameState, laneIndex: number): boolean {
    const rules = getActivePassiveRules(state);

    return rules.some(({ rule, laneIndex: ruleLaneIndex }) => {
        if (rule.type !== 'ignore_middle_commands') return false;
        return rule.scope === 'global' || ruleLaneIndex === laneIndex;
    });
}
