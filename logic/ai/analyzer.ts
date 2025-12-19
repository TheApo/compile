/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GameStateAnalyzer - Analyzes the current game state to recommend strategies
 *
 * This module provides deep analysis of the game state to help the AI make
 * intelligent decisions based on the current situation rather than just card values.
 */

import { GameState, Player, PlayedCard } from '../../types';

// =============================================================================
// TYPES
// =============================================================================

export type GamePhase = 'early' | 'mid' | 'late' | 'endgame';
export type Strategy = 'rush' | 'control' | 'disrupt' | 'defend';

export interface ThreatAnalysis {
    playerCanCompile: boolean;
    playerCompileLanes: number[];
    playerNearCompileLanes: number[];  // Lanes at 8-9 (one card away)
    turnsUntilPlayerCompile: number;   // Estimated turns
    playerHasControl: boolean;
    playerCompiledCount: number;
}

export interface PositionAnalysis {
    ourCompileProgress: number[];      // Lane values [7, 4, 2]
    closestLane: number;               // Best lane to compile
    closestLaneDistance: number;       // How far from 10
    weHaveControl: boolean;
    lanesWeLeadIn: number;
    canGetControlThisTurn: boolean;    // If we play right, can we get control?
    ourCompiledCount: number;
}

export interface LaneAnalysis {
    laneIndex: number;
    ourValue: number;
    playerValue: number;
    weAreLeading: boolean;
    playerIsLeading: boolean;
    isTied: boolean;
    ourDistanceToCompile: number;
    playerDistanceToCompile: number;
    ourProtocol: string;
    playerProtocol: string;
    isCompiled: boolean;
    playerLaneCompiled: boolean;
}

export interface GameAnalysis {
    gamePhase: GamePhase;
    threats: ThreatAnalysis;
    position: PositionAnalysis;
    lanes: LaneAnalysis[];
    recommendedStrategy: Strategy;
    urgency: number;  // 0-100, how urgent is action needed?
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Count total cards on the board (both players)
 */
function countCardsOnBoard(state: GameState): number {
    const playerCards = state.player.lanes.flat().length;
    const opponentCards = state.opponent.lanes.flat().length;
    return playerCards + opponentCards;
}

/**
 * Count compiled protocols for a player
 */
function countCompiled(state: GameState, player: Player): number {
    return state[player].compiled.filter(c => c).length;
}

/**
 * Determine game phase based on board state
 */
function determinePhase(state: GameState): GamePhase {
    const totalCards = countCardsOnBoard(state);
    const playerCompiled = countCompiled(state, 'player');
    const opponentCompiled = countCompiled(state, 'opponent');
    const totalCompiled = playerCompiled + opponentCompiled;

    // Endgame: Someone is one compile away from winning
    if (playerCompiled === 2 || opponentCompiled === 2) {
        return 'endgame';
    }

    // Late game: Multiple compiles have happened
    if (totalCompiled >= 2) {
        return 'late';
    }

    // Early game: Few cards on board
    if (totalCards <= 4) {
        return 'early';
    }

    // Mid game: Everything else
    return 'mid';
}

/**
 * Estimate how many turns until a player can compile a lane
 * Returns -1 if lane is already compiled
 */
function estimateTurnsToCompile(
    currentValue: number,
    opponentValue: number,
    isCompiled: boolean,
    averageCardValue: number = 3.5
): number {
    if (isCompiled) return -1;

    const valueNeeded = Math.max(10 - currentValue, opponentValue - currentValue + 1);
    if (valueNeeded <= 0) return 0; // Can compile now!

    return Math.ceil(valueNeeded / averageCardValue);
}

/**
 * Analyze lanes individually
 */
function analyzeLanes(state: GameState): LaneAnalysis[] {
    const lanes: LaneAnalysis[] = [];

    for (let i = 0; i < 3; i++) {
        const ourValue = state.opponent.laneValues[i];
        const playerValue = state.player.laneValues[i];
        const isCompiled = state.opponent.compiled[i];
        const playerLaneCompiled = state.player.compiled[i];

        lanes.push({
            laneIndex: i,
            ourValue,
            playerValue,
            weAreLeading: ourValue > playerValue,
            playerIsLeading: playerValue > ourValue,
            isTied: ourValue === playerValue,
            ourDistanceToCompile: isCompiled ? -1 : Math.max(10 - ourValue, playerValue - ourValue + 1),
            playerDistanceToCompile: playerLaneCompiled ? -1 : Math.max(10 - playerValue, ourValue - playerValue + 1),
            ourProtocol: state.opponent.protocols[i],
            playerProtocol: state.player.protocols[i],
            isCompiled,
            playerLaneCompiled,
        });
    }

    return lanes;
}

/**
 * Analyze threats from the player
 */
function analyzeThreats(state: GameState, lanes: LaneAnalysis[]): ThreatAnalysis {
    const playerCanCompileLanes: number[] = [];
    const playerNearCompileLanes: number[] = [];

    for (const lane of lanes) {
        if (lane.playerLaneCompiled) continue;

        // Player can compile NOW
        if (lane.playerValue >= 10 && lane.playerValue > lane.ourValue) {
            playerCanCompileLanes.push(lane.laneIndex);
        }
        // Player is near compile (8-9)
        else if (lane.playerValue >= 8 && lane.playerValue < 10) {
            playerNearCompileLanes.push(lane.laneIndex);
        }
    }

    // Estimate turns until player can compile
    let minTurnsToCompile = Infinity;
    for (const lane of lanes) {
        if (lane.playerLaneCompiled) continue;
        const turns = estimateTurnsToCompile(
            lane.playerValue,
            lane.ourValue,
            lane.playerLaneCompiled
        );
        if (turns >= 0 && turns < minTurnsToCompile) {
            minTurnsToCompile = turns;
        }
    }

    return {
        playerCanCompile: playerCanCompileLanes.length > 0,
        playerCompileLanes: playerCanCompileLanes,
        playerNearCompileLanes,
        turnsUntilPlayerCompile: minTurnsToCompile === Infinity ? 99 : minTurnsToCompile,
        playerHasControl: state.controlCardHolder === 'player',
        playerCompiledCount: countCompiled(state, 'player'),
    };
}

/**
 * Analyze our position
 */
function analyzePosition(state: GameState, lanes: LaneAnalysis[]): PositionAnalysis {
    const ourCompileProgress = lanes.map(l => l.ourValue);
    const lanesWeLeadIn = lanes.filter(l => l.weAreLeading && !l.isCompiled).length;
    const weHaveControl = state.controlCardHolder === 'opponent';

    // Find closest lane to compile
    let closestLane = -1;
    let closestDistance = Infinity;
    for (const lane of lanes) {
        if (lane.isCompiled) continue;
        if (lane.ourDistanceToCompile >= 0 && lane.ourDistanceToCompile < closestDistance) {
            closestDistance = lane.ourDistanceToCompile;
            closestLane = lane.laneIndex;
        }
    }

    // Can we get control this turn?
    // Control requires leading in 2+ lanes
    const canGetControlThisTurn = !weHaveControl && lanesWeLeadIn >= 1;

    return {
        ourCompileProgress,
        closestLane,
        closestLaneDistance: closestDistance === Infinity ? 99 : closestDistance,
        weHaveControl,
        lanesWeLeadIn,
        canGetControlThisTurn,
        ourCompiledCount: countCompiled(state, 'opponent'),
    };
}

/**
 * Calculate urgency score (0-100)
 * Higher = more urgent action needed
 */
function calculateUrgency(
    threats: ThreatAnalysis,
    position: PositionAnalysis,
    gamePhase: GamePhase
): number {
    let urgency = 0;

    // Player can compile RIGHT NOW = MAXIMUM URGENCY
    if (threats.playerCanCompile) {
        urgency += 80;
    }

    // Player is near compile
    urgency += threats.playerNearCompileLanes.length * 20;

    // Game phase urgency
    switch (gamePhase) {
        case 'endgame':
            urgency += 30;
            break;
        case 'late':
            urgency += 15;
            break;
        case 'mid':
            urgency += 5;
            break;
    }

    // Player has compiled more than us
    if (threats.playerCompiledCount > position.ourCompiledCount) {
        urgency += 20;
    }

    // Player has control (dangerous!)
    if (threats.playerHasControl) {
        urgency += 15;
        // CRITICAL: Player has control AND compiled protocols = EXTREMELY dangerous!
        // They can swap our protocols at will, preventing our wins
        if (threats.playerCompiledCount >= 1) {
            urgency += 30;  // Maximum urgency to get control back!
        }
    }

    return Math.min(100, urgency);
}

/**
 * Recommend a strategy based on analysis
 */
function recommendStrategy(
    gamePhase: GamePhase,
    threats: ThreatAnalysis,
    position: PositionAnalysis,
    lanes: LaneAnalysis[]
): Strategy {
    // DEFEND: Player can compile RIGHT NOW and we might be able to block
    if (threats.playerCanCompile) {
        // Check if we can block any of the threatening lanes
        for (const laneIdx of threats.playerCompileLanes) {
            const lane = lanes[laneIdx];
            // If we're close enough to potentially block with one card
            if (lane.playerValue - lane.ourValue <= 6) {
                return 'defend';
            }
        }
        // Can't block - try to disrupt or rush our own
        return position.closestLaneDistance <= 3 ? 'rush' : 'disrupt';
    }

    // CRITICAL: Player HAS Control AND compiled protocols = MUST get control back!
    // When player has control + compiled protocols, they can swap our protocols
    // on every compile/refresh - this is DEVASTATING. Priority #1 to reclaim control!
    if (threats.playerHasControl && threats.playerCompiledCount >= 1) {
        // AGGRESSIVE control hunting - we MUST lead in 2+ lanes to steal control
        return 'control';
    }

    // ENDGAME: We or player is one compile from winning
    if (gamePhase === 'endgame') {
        // If we're winning, RUSH to finish
        if (position.ourCompiledCount === 2) {
            return 'rush';
        }
        // If player is winning, DISRUPT or DEFEND
        if (threats.playerCompiledCount === 2) {
            return threats.playerNearCompileLanes.length > 0 ? 'defend' : 'disrupt';
        }
    }

    // CONTROL STRATEGY: Player has compiled protocols, control is valuable!
    if (threats.playerCompiledCount >= 1) {
        // If we don't have control and could get it, prioritize it
        if (!position.weHaveControl && position.canGetControlThisTurn) {
            return 'control';
        }
        // If player is near compile, prioritize control to block via swap
        if (threats.playerNearCompileLanes.length > 0) {
            return position.lanesWeLeadIn >= 1 ? 'control' : 'disrupt';
        }
    }

    // RUSH: We're close to compile
    if (position.closestLaneDistance <= 4) {
        return 'rush';
    }

    // EARLY/MID GAME: Build up efficiently
    if (gamePhase === 'early' || gamePhase === 'mid') {
        // Focus on rushing if we're making good progress
        if (position.closestLaneDistance <= 6) {
            return 'rush';
        }
        // If player is building up faster, consider disruption
        if (threats.turnsUntilPlayerCompile < 3) {
            return 'disrupt';
        }
    }

    // Default: Rush to compile
    return 'rush';
}

// =============================================================================
// MAIN EXPORT
// =============================================================================

/**
 * Analyze the current game state and recommend a strategy
 */
export function analyzeGameState(state: GameState): GameAnalysis {
    // Analyze lanes
    const lanes = analyzeLanes(state);

    // Determine game phase
    const gamePhase = determinePhase(state);

    // Analyze threats
    const threats = analyzeThreats(state, lanes);

    // Analyze our position
    const position = analyzePosition(state, lanes);

    // Calculate urgency
    const urgency = calculateUrgency(threats, position, gamePhase);

    // Recommend strategy
    const recommendedStrategy = recommendStrategy(gamePhase, threats, position, lanes);

    return {
        gamePhase,
        threats,
        position,
        lanes,
        recommendedStrategy,
        urgency,
    };
}

/**
 * Get a simple description of the current strategy for debugging
 */
export function describeStrategy(analysis: GameAnalysis): string {
    const { gamePhase, recommendedStrategy, urgency, threats, position } = analysis;

    let description = `[${gamePhase.toUpperCase()}] Strategy: ${recommendedStrategy.toUpperCase()} (Urgency: ${urgency})`;

    if (threats.playerCanCompile) {
        description += ` | DANGER: Player can compile lanes ${threats.playerCompileLanes.join(', ')}!`;
    }

    if (position.closestLaneDistance <= 3) {
        description += ` | We can compile lane ${position.closestLane} (need ${position.closestLaneDistance})`;
    }

    if (position.weHaveControl) {
        description += ' | We have CONTROL';
    }

    return description;
}

/**
 * Check if a lane is a good target for our strategy
 */
export function isGoodLaneForStrategy(
    laneIndex: number,
    analysis: GameAnalysis
): { isGood: boolean; reason: string; score: number } {
    const lane = analysis.lanes[laneIndex];
    const { recommendedStrategy } = analysis;

    if (lane.isCompiled) {
        return { isGood: false, reason: 'Already compiled', score: -1000 };
    }

    switch (recommendedStrategy) {
        case 'rush': {
            // Rush: Prefer lanes closest to compile
            const score = 100 - lane.ourDistanceToCompile * 10;
            return {
                isGood: lane.ourDistanceToCompile <= 6,
                reason: `Distance to compile: ${lane.ourDistanceToCompile}`,
                score,
            };
        }

        case 'control': {
            // Control: Prefer lanes where we DON'T lead (to get 2+ leads)
            if (lane.weAreLeading) {
                return {
                    isGood: false,
                    reason: 'Already leading - need other lanes for control',
                    score: -50,
                };
            }
            // Prefer lanes where we can overtake
            const gapToLead = lane.playerValue - lane.ourValue;
            const score = 100 - gapToLead * 15;
            return {
                isGood: gapToLead <= 4,
                reason: `Gap to lead: ${gapToLead}`,
                score,
            };
        }

        case 'disrupt': {
            // Disrupt: Target player's strongest lanes
            if (lane.playerLaneCompiled) {
                return { isGood: false, reason: 'Player already compiled', score: -100 };
            }
            const score = lane.playerValue * 10;
            return {
                isGood: lane.playerValue >= 5,
                reason: `Player value: ${lane.playerValue}`,
                score,
            };
        }

        case 'defend': {
            // Defend: Block player's compile threats
            const isThreateningLane = analysis.threats.playerCompileLanes.includes(laneIndex);
            if (isThreateningLane) {
                return {
                    isGood: true,
                    reason: 'BLOCKING COMPILE THREAT',
                    score: 200,
                };
            }
            return {
                isGood: false,
                reason: 'Not a threat lane',
                score: 0,
            };
        }
    }
}

/**
 * Find the best card to play for the current strategy
 * Returns lane recommendations sorted by priority
 */
export function getLaneRecommendations(analysis: GameAnalysis): Array<{
    laneIndex: number;
    score: number;
    reason: string;
}> {
    const recommendations: Array<{ laneIndex: number; score: number; reason: string }> = [];

    for (let i = 0; i < 3; i++) {
        const evaluation = isGoodLaneForStrategy(i, analysis);
        if (evaluation.score > -100) {
            recommendations.push({
                laneIndex: i,
                score: evaluation.score,
                reason: evaluation.reason,
            });
        }
    }

    // Sort by score descending
    recommendations.sort((a, b) => b.score - a.score);
    return recommendations;
}
