/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Strategy Definitions for AI
 *
 * This module defines strategy-specific scoring modifiers that the AI uses
 * to make decisions based on the current game situation.
 */

import { GameState, PlayedCard, Player } from '../../types';
import { GameAnalysis, Strategy, LaneAnalysis } from './analyzer';

// =============================================================================
// TYPES
// =============================================================================

export interface MoveScore {
    baseScore: number;           // From card value
    strategicBonus: number;      // Does it fit our strategy?
    compileProgress: number;     // Does it help us compile?
    controlImpact: number;       // Does it help control?
    disruptionValue: number;     // Does it disrupt enemy?
    threatResponse: number;      // Does it respond to threats?
    effectValue: number;         // Value of the card's effect
    totalScore: number;
}

export interface PlayOption {
    card: PlayedCard;
    laneIndex: number;
    isFaceUp: boolean;
    score: MoveScore;
    reasoning: string;
}

// =============================================================================
// STRATEGY MODIFIERS
// =============================================================================

/**
 * Get strategic bonus for playing in a specific lane
 */
export function getStrategicBonus(
    strategy: Strategy,
    laneIndex: number,
    lanes: LaneAnalysis[],
    analysis: GameAnalysis
): { bonus: number; reason: string } {
    const lane = lanes[laneIndex];

    switch (strategy) {
        case 'rush': {
            // Rush: Prioritize lanes closest to compile
            if (lane.isCompiled) {
                return { bonus: -200, reason: 'Already compiled' };
            }
            if (lane.ourDistanceToCompile <= 3) {
                return { bonus: 100, reason: `RUSH: Only ${lane.ourDistanceToCompile} from compile!` };
            }
            if (lane.ourDistanceToCompile <= 5) {
                return { bonus: 50, reason: `Rush: ${lane.ourDistanceToCompile} from compile` };
            }
            if (lane.ourDistanceToCompile <= 7) {
                return { bonus: 20, reason: `Building: ${lane.ourDistanceToCompile} from compile` };
            }
            return { bonus: -30, reason: 'Far from compile' };
        }

        case 'control': {
            // Control: Prioritize lanes where we DON'T lead
            if (lane.isCompiled) {
                return { bonus: -200, reason: 'Already compiled' };
            }
            if (lane.weAreLeading) {
                return { bonus: -100, reason: 'CONTROL: Already leading - waste!' };
            }

            // Calculate how much we'd need to lead
            const gapToLead = lane.playerValue - lane.ourValue;
            if (gapToLead <= 2) {
                const lanesWeLead = analysis.position.lanesWeLeadIn;
                if (lanesWeLead === 1) {
                    return { bonus: 150, reason: 'CONTROL: Can get 2nd lead!' };
                }
                return { bonus: 80, reason: 'Control: Close to lead' };
            }
            if (gapToLead <= 4) {
                return { bonus: 40, reason: `Control: Gap ${gapToLead} to lead` };
            }
            return { bonus: 0, reason: `Control: Large gap ${gapToLead}` };
        }

        case 'disrupt': {
            // Disrupt: Target lanes where player is strong
            if (lane.isCompiled) {
                return { bonus: -200, reason: 'Already compiled' };
            }
            if (lane.playerValue >= 8) {
                return { bonus: 80, reason: `DISRUPT: Player at ${lane.playerValue}` };
            }
            if (lane.playerValue >= 5) {
                return { bonus: 40, reason: `Disrupt: Player building (${lane.playerValue})` };
            }
            return { bonus: 10, reason: 'Disrupt: Low priority lane' };
        }

        case 'defend': {
            // Defend: Block compile threats
            if (lane.isCompiled) {
                return { bonus: -200, reason: 'Already compiled' };
            }
            const isThreat = analysis.threats.playerCompileLanes.includes(laneIndex);
            if (isThreat) {
                return { bonus: 200, reason: 'DEFEND: Blocking compile threat!' };
            }
            const isNearThreat = analysis.threats.playerNearCompileLanes.includes(laneIndex);
            if (isNearThreat) {
                return { bonus: 60, reason: 'Defend: Near threat' };
            }
            return { bonus: -50, reason: 'Defend: Not a threat lane' };
        }
    }
}

/**
 * Get compile progress score for a play
 */
export function getCompileProgressScore(
    laneIndex: number,
    cardValue: number,
    lanes: LaneAnalysis[]
): { score: number; reason: string } {
    const lane = lanes[laneIndex];
    if (lane.isCompiled) {
        return { score: -100, reason: 'Lane already compiled' };
    }

    const newValue = lane.ourValue + cardValue;

    // Can compile!
    if (newValue >= 10 && newValue > lane.playerValue) {
        return { score: 200, reason: `COMPILE! ${lane.ourValue} + ${cardValue} = ${newValue}` };
    }

    // Near compile
    if (newValue >= 8) {
        const remaining = 10 - newValue;
        return { score: 80 - remaining * 15, reason: `Near compile: ${newValue} (need ${remaining} more)` };
    }

    // Building progress
    return { score: cardValue * 8, reason: `Building: ${lane.ourValue} -> ${newValue}` };
}

/**
 * Get control impact score
 */
export function getControlImpactScore(
    laneIndex: number,
    cardValue: number,
    analysis: GameAnalysis
): { score: number; reason: string } {
    const lane = analysis.lanes[laneIndex];
    const newValue = lane.ourValue + cardValue;

    // If we have control, don't need to worry about it
    if (analysis.position.weHaveControl) {
        return { score: 0, reason: 'Already have control' };
    }

    // Check if this would give us a new lead
    const wouldLead = newValue > lane.playerValue;
    const currentlyLeading = lane.weAreLeading;

    if (!currentlyLeading && wouldLead) {
        const currentLeads = analysis.position.lanesWeLeadIn;
        if (currentLeads === 1) {
            return { score: 120, reason: 'CONTROL CAPTURE: 2nd lead!' };
        }
        if (currentLeads === 0) {
            return { score: 60, reason: 'First lead toward control' };
        }
        return { score: 30, reason: 'Additional lead' };
    }

    if (currentlyLeading) {
        return { score: -20, reason: 'Already leading this lane' };
    }

    return { score: 0, reason: 'No control impact' };
}

/**
 * Get threat response score
 */
export function getThreatResponseScore(
    laneIndex: number,
    cardValue: number,
    analysis: GameAnalysis
): { score: number; reason: string } {
    const lane = analysis.lanes[laneIndex];
    const newValue = lane.ourValue + cardValue;

    // Check if player can compile this lane
    const canPlayerCompile = lane.playerValue >= 10 && lane.playerValue > lane.ourValue;

    if (canPlayerCompile) {
        // Can we block?
        if (newValue >= lane.playerValue) {
            return { score: 150, reason: `BLOCKS COMPILE! ${newValue} >= ${lane.playerValue}` };
        }
        // Can't block - card will be wasted when player compiles
        return { score: -80, reason: `Can't block: ${newValue} < ${lane.playerValue}` };
    }

    // Player is near compile
    const isNearThreat = analysis.threats.playerNearCompileLanes.includes(laneIndex);
    if (isNearThreat && newValue > lane.playerValue) {
        return { score: 50, reason: 'Preemptive block' };
    }

    return { score: 0, reason: 'No immediate threat' };
}

/**
 * Calculate full move score
 */
export function calculateMoveScore(
    card: PlayedCard,
    laneIndex: number,
    isFaceUp: boolean,
    analysis: GameAnalysis,
    effectValue: number = 0
): MoveScore {
    const lanes = analysis.lanes;
    const strategy = analysis.recommendedStrategy;

    // Card value depends on face up/down
    const cardValue = isFaceUp ? card.value : 2;

    // Base score from card value
    const baseScore = cardValue * 10;

    // Strategic bonus
    const strategicResult = getStrategicBonus(strategy, laneIndex, lanes, analysis);
    const strategicBonus = strategicResult.bonus;

    // Compile progress
    const compileResult = getCompileProgressScore(laneIndex, cardValue, lanes);
    const compileProgress = compileResult.score;

    // Control impact
    const controlResult = getControlImpactScore(laneIndex, cardValue, analysis);
    const controlImpact = controlResult.score;

    // Threat response
    const threatResult = getThreatResponseScore(laneIndex, cardValue, analysis);
    const threatResponse = threatResult.score;

    // Disruption value (from effect evaluation)
    const disruptionValue = effectValue;

    // Total score
    const totalScore = baseScore + strategicBonus + compileProgress +
                       controlImpact + disruptionValue + threatResponse;

    return {
        baseScore,
        strategicBonus,
        compileProgress,
        controlImpact,
        disruptionValue,
        threatResponse,
        effectValue,
        totalScore,
    };
}

/**
 * Get reasoning string for a move score
 */
export function getMoveReasoning(
    card: PlayedCard,
    laneIndex: number,
    isFaceUp: boolean,
    score: MoveScore,
    analysis: GameAnalysis
): string {
    const parts: string[] = [];

    parts.push(`${card.protocol}-${card.value} ${isFaceUp ? 'face-up' : 'face-down'} -> Lane ${laneIndex}`);
    parts.push(`[${analysis.recommendedStrategy.toUpperCase()}]`);

    if (score.compileProgress >= 150) {
        parts.push('COMPILE!');
    } else if (score.compileProgress >= 60) {
        parts.push('Near compile');
    }

    if (score.threatResponse >= 100) {
        parts.push('BLOCKS THREAT!');
    } else if (score.threatResponse < -50) {
        parts.push('WASTED (player compiles)');
    }

    if (score.controlImpact >= 100) {
        parts.push('CONTROL CAPTURE!');
    }

    if (score.strategicBonus < -50) {
        parts.push('Off-strategy');
    }

    parts.push(`Score: ${score.totalScore}`);

    return parts.join(' | ');
}

// =============================================================================
// FACE-UP VS FACE-DOWN DECISION
// =============================================================================

/**
 * Determine if face-up or face-down is better
 */
export function shouldPlayFaceUp(
    card: PlayedCard,
    laneIndex: number,
    analysis: GameAnalysis,
    canPlayFaceUp: boolean,
    effectValue: number = 0
): { faceUp: boolean; reason: string } {
    if (!canPlayFaceUp) {
        return { faceUp: false, reason: 'Cannot play face-up (wrong protocol or restriction)' };
    }

    const lane = analysis.lanes[laneIndex];

    // If face-up completes compile, ALWAYS face-up
    const faceUpValue = lane.ourValue + card.value;
    if (faceUpValue >= 10 && faceUpValue > lane.playerValue && !lane.isCompiled) {
        return { faceUp: true, reason: `Face-up COMPILES (${faceUpValue})` };
    }

    // If face-down completes compile, face-down
    const faceDownValue = lane.ourValue + 2;
    if (faceDownValue >= 10 && faceDownValue > lane.playerValue && !lane.isCompiled) {
        return { faceUp: false, reason: `Face-down COMPILES (${faceDownValue})` };
    }

    // If blocking compile threat, use whatever gets us there
    const canPlayerCompile = lane.playerValue >= 10 && lane.playerValue > lane.ourValue;
    if (canPlayerCompile) {
        if (faceUpValue >= lane.playerValue) {
            return { faceUp: true, reason: 'Face-up blocks compile' };
        }
        if (faceDownValue >= lane.playerValue) {
            return { faceUp: false, reason: 'Face-down blocks compile' };
        }
        // Neither blocks - prefer face-down to save the card's value
        return { faceUp: false, reason: 'Cannot block - save value for later' };
    }

    // Effect value consideration
    if (effectValue > 30) {
        return { faceUp: true, reason: `Good effect value (${effectValue})` };
    }
    if (effectValue < -20) {
        return { faceUp: false, reason: `Bad effect value (${effectValue}) - play face-down` };
    }

    // High value cards (4-6) generally better face-up
    if (card.value >= 4) {
        return { faceUp: true, reason: `High value (${card.value}) - face-up preferred` };
    }

    // Low value cards (0-1) might be better face-down (2 > 0 or 1)
    if (card.value <= 1) {
        return { faceUp: false, reason: `Low value (${card.value}) - face-down gives 2` };
    }

    // Default: face-up for effect potential
    return { faceUp: true, reason: 'Default: face-up for effect' };
}

// =============================================================================
// REFRESH DECISION
// =============================================================================

/**
 * Determine if we should refresh (draw cards) instead of playing
 */
export function shouldRefresh(
    state: GameState,
    analysis: GameAnalysis,
    bestPlayScore: number
): { shouldRefresh: boolean; reason: string } {
    const handSize = state.opponent.hand.length;

    // Empty hand - MUST refresh
    if (handSize === 0) {
        return { shouldRefresh: true, reason: 'Empty hand - must refresh' };
    }

    // Can't refresh with 5+ cards
    if (handSize >= 5) {
        return { shouldRefresh: false, reason: 'Hand full - cannot refresh' };
    }

    // Strategic refresh with control
    if (analysis.position.weHaveControl && analysis.threats.playerCompiledCount >= 1) {
        // Check if player is about to compile
        if (analysis.threats.playerCanCompile) {
            return {
                shouldRefresh: true,
                reason: 'CONTROL PLAY: Refresh triggers protocol swap to block compile!',
            };
        }
    }

    // Very low hand and no good plays
    if (handSize <= 2 && bestPlayScore < 50) {
        return { shouldRefresh: true, reason: 'Low hand and no good plays' };
    }

    // Default: play cards
    return { shouldRefresh: false, reason: 'Play cards' };
}
