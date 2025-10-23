/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { GameState, PlayedCard, Player } from '../types';
import { Lane } from './Lane';
import { CardComponent } from './Card';
import { isCardTargetable } from '../utils/targeting';

interface GameBoardProps {
    gameState: GameState;
    onLanePointerDown: (laneIndex: number) => void;
    onPlayFaceDown: (laneIndex: number) => void;
    onCardPointerDown: (card: PlayedCard, owner: Player, laneIndex: number) => void;
    onCardPointerEnter: (card: PlayedCard, owner: Player) => void;
    onCardPointerLeave: () => void;
    onOpponentHandCardPointerEnter: (card: PlayedCard) => void;
    onOpponentHandCardPointerLeave: () => void;
    selectedCardId: string | null;
    sourceCardId: string | null;
}

export const GameBoard: React.FC<GameBoardProps> = ({ gameState, onLanePointerDown, onPlayFaceDown, onCardPointerDown, onCardPointerEnter, onCardPointerLeave, onOpponentHandCardPointerEnter, onOpponentHandCardPointerLeave, selectedCardId, sourceCardId }) => {
    const { player, opponent, animationState, phase, turn, compilableLanes, actionRequired, controlCardHolder } = gameState;

    const getLanePlayability = (laneIndex: number): { isPlayable: boolean, isMatching: boolean, isCompilable: boolean } => {
        const isCompilable = phase === 'compile' && turn === 'player' && !actionRequired && compilableLanes.includes(laneIndex);

        const isPlayerTurn = turn === 'player';
        const isPlayFromHand = phase === 'action' && !actionRequired && selectedCardId;
        const isPlayFromEffect = actionRequired?.type === 'select_lane_for_play';
    
        if (!isPlayerTurn || (!isPlayFromHand && !isPlayFromEffect)) {
            return { isPlayable: false, isMatching: false, isCompilable };
        }
        
        let card: PlayedCard | undefined;
        if (isPlayFromHand) {
            card = player.hand.find(c => c.id === selectedCardId);
        } else if (isPlayFromEffect) {
            card = player.hand.find(c => c.id === actionRequired.cardInHandId);
        }
    
        if (!card) {
            return { isPlayable: false, isMatching: false, isCompilable };
        }
    
        if (isPlayFromEffect && laneIndex === actionRequired.disallowedLaneIndex) {
            return { isPlayable: false, isMatching: false, isCompilable };
        }
        
        // Rule: Lane completely blocked by opponent's uncovered Plague-0
        const oppLane = opponent.lanes[laneIndex];
        const isLaneBlocked = oppLane.length > 0 &&
                              oppLane[oppLane.length - 1].isFaceUp &&
                              oppLane[oppLane.length - 1].protocol === 'Plague' &&
                              oppLane[oppLane.length - 1].value === 0;
        if (isLaneBlocked) {
            return { isPlayable: false, isMatching: false, isCompilable };
        }
        
        const opponentHasPsychic1 = opponent.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Psychic' && c.value === 1);
        const playerHasSpiritOne = player.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Spirit' && c.value === 1);

        // Check for Chaos-3: Must be uncovered (last in lane) AND face-up
        const playerHasChaosThree = player.lanes.some((lane) => {
            if (lane.length === 0) return false;
            const uncoveredCard = lane[lane.length - 1];
            return uncoveredCard.isFaceUp && uncoveredCard.protocol === 'Chaos' && uncoveredCard.value === 3;
        });

        // Check for Anarchy-1 on ANY player's field (affects both players)
        const anyPlayerHasAnarchy1 = [...player.lanes.flat(), ...opponent.lanes.flat()]
            .some(c => c.isFaceUp && c.protocol === 'Anarchy' && c.value === 1);

        let isMatching: boolean;
        if (anyPlayerHasAnarchy1) {
            // Anarchy-1 active: INVERTED rule - can only play face-up if protocol does NOT match
            const doesNotMatch = card.protocol !== player.protocols[laneIndex] && card.protocol !== opponent.protocols[laneIndex];
            isMatching = doesNotMatch && !opponentHasPsychic1;
        } else {
            // Normal rule: can play face-up if protocol DOES match (or Spirit-1/Chaos-3 override)
            isMatching = (
                playerHasSpiritOne ||
                playerHasChaosThree ||
                card.protocol === player.protocols[laneIndex] ||
                card.protocol === opponent.protocols[laneIndex]
            ) && !opponentHasPsychic1;
        }
    
        const opponentHasMetalTwo = oppLane.some(c => c.isFaceUp && c.protocol === 'Metal' && c.value === 2);
        if (opponentHasMetalTwo && !isMatching) {
            return { isPlayable: false, isMatching: false, isCompilable };
        }
    
        return { isPlayable: true, isMatching, isCompilable };
    }

    const getLaneEffectTargetability = (targetLaneIndex: number): boolean => {
        if (!actionRequired || actionRequired.actor !== 'player') return false;
        switch (actionRequired.type) {
            case 'select_lane_for_death_2':
            case 'select_lane_for_water_3':
                return true;
            case 'select_lane_for_metal_3_delete': {
                if (targetLaneIndex === actionRequired.disallowedLaneIndex) return false;
                const totalCards = player.lanes[targetLaneIndex].length + opponent.lanes[targetLaneIndex].length;
                return totalCards >= 8;
            }
            default:
                return false;
        }
    };

    const getLaneShiftTargetability = (targetLaneIndex: number, targetOwner: Player): boolean => {
        if (!actionRequired || actionRequired.actor !== 'player') return false;

        switch (actionRequired.type) {
            case 'select_lane_for_shift': {
                // Target lane must belong to the card's owner and not be the original lane.
                if (targetOwner !== actionRequired.cardOwner || targetLaneIndex === actionRequired.originalLaneIndex) {
                    return false;
                }

                // CRITICAL VALIDATION for Gravity-1: "Shift 1 card either to or from this line"
                // The shift must involve the Gravity-1's lane (either as source OR destination)
                const sourceCard = [...gameState.player.lanes.flat(), ...gameState.opponent.lanes.flat()]
                    .find(c => c.id === actionRequired.sourceCardId);

                if (sourceCard && sourceCard.protocol === 'Gravity' && sourceCard.value === 1) {
                    // Find Gravity-1's lane
                    let gravity1LaneIndex = -1;
                    for (const owner of ['player', 'opponent'] as Player[]) {
                        for (let i = 0; i < gameState[owner].lanes.length; i++) {
                            if (gameState[owner].lanes[i].some(c => c.id === actionRequired.sourceCardId)) {
                                gravity1LaneIndex = i;
                                break;
                            }
                        }
                        if (gravity1LaneIndex !== -1) break;
                    }

                    // RULE: Either originalLaneIndex OR targetLaneIndex must be the Gravity-1 lane
                    if (gravity1LaneIndex !== -1) {
                        const isFromGravityLane = actionRequired.originalLaneIndex === gravity1LaneIndex;
                        const isToGravityLane = targetLaneIndex === gravity1LaneIndex;

                        // At least ONE must be true
                        if (!isFromGravityLane && !isToGravityLane) {
                            return false; // ILLEGAL: Neither source nor target is Gravity lane
                        }
                    }
                }

                return true;
            }
            case 'shift_flipped_card_optional': {
                // Darkness-1 card is always on the opponent's side.
                const cardOwner: Player = 'opponent';
                if (targetOwner !== cardOwner) return false;
    
                const cardId = actionRequired.cardId;
                let originalLaneIndex = -1;
                // Find the original lane of the card being shifted
                for(let i = 0; i < opponent.lanes.length; i++) {
                    if (opponent.lanes[i].some(c => c.id === cardId)) {
                        originalLaneIndex = i;
                        break;
                    }
                }
                return targetLaneIndex !== originalLaneIndex;
            }
            case 'select_lane_for_life_3_play':
                return targetOwner === 'player' && targetLaneIndex !== actionRequired.disallowedLaneIndex;
            case 'select_lane_to_shift_revealed_card_for_light_2':
                 return targetOwner === 'player'; // TODO: Check card owner
            case 'select_lane_to_shift_cards_for_light_3':
                 return targetLaneIndex !== actionRequired.sourceLaneIndex;
            default:
                return false;
        }
    }

    const getProtocolClass = (baseClass: string, isCompiled: boolean, laneIndex: number) => {
        let classes = [baseClass];
        if (isCompiled) classes.push('compiled');
        if (animationState?.type === 'compile' && animationState.laneIndex === laneIndex) {
            classes.push('is-compiling');
        }
        return classes.join(' ');
    }

    const getFaceDownValue = (lane: PlayedCard[]): number => {
        const hasDarkness2 = lane.some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2);
        return hasDarkness2 ? 4 : 2;
    };

    const getControlCoinClass = () => {
        if (controlCardHolder === 'player') return 'player-controlled';
        if (controlCardHolder === 'opponent') return 'opponent-controlled';
        return 'neutral';
    };

    const getControlCoinTitle = () => {
        if (controlCardHolder === 'player') return 'Player has control.';
        if (controlCardHolder === 'opponent') return 'Opponent has control.';
        return 'Control is neutral.';
    };

    const getControlCoinLabel = () => {
        if (controlCardHolder === 'player') return 'Control Player';
        if (controlCardHolder === 'opponent') return 'Control Opponent';
        return 'Control Neutral';
    };

    return (
        <div className="game-board">
            <div className="opponent-hand-area">
                {opponent.hand.map(card => (
                    <CardComponent
                        key={card.id}
                        card={card}
                        isFaceUp={card.isRevealed || false}
                        additionalClassName="in-hand"
                        onPointerEnter={() => onOpponentHandCardPointerEnter(card)}
                        onPointerLeave={onOpponentHandCardPointerLeave}
                    />
                ))}
            </div>

            {/* Opponent's Side */}
            <div className={`player-side opponent-side ${turn === 'opponent' ? 'active-turn' : ''}`}>
                <div className="lanes">
                    {opponent.lanes.map((laneCards, i) => {
                        const faceDownValue = getFaceDownValue(laneCards);
                        return <Lane 
                            key={`opp-lane-${i}`} 
                            cards={laneCards} 
                            isPlayable={false} 
                            isCompilable={false} 
                            isShiftTarget={getLaneShiftTargetability(i, 'opponent')}
                            isEffectTarget={getLaneEffectTargetability(i)}
                            onLanePointerDown={() => onLanePointerDown(i)}
                            onCardPointerDown={(card) => onCardPointerDown(card, 'opponent', i)} 
                            onCardPointerEnter={(card) => onCardPointerEnter(card, 'opponent')} 
                            onCardPointerLeave={() => onCardPointerLeave()} 
                            owner="opponent" 
                            animationState={animationState}
                            isCardTargetable={(card) => isCardTargetable(card, gameState)}
                            faceDownValue={faceDownValue}
                            sourceCardId={sourceCardId}
                            gameState={gameState}
                        />
                    })}
                </div>
            </div>

            {/* Central Protocol Bars */}
            <div className="protocol-bars-container">
                {gameState.useControlMechanic && (
                    <div className="control-coin-container">
                        <div
                            className={`control-coin ${getControlCoinClass()}`}
                            title={getControlCoinTitle()}
                        >
                            C
                        </div>
                        <div className={`control-coin-label ${getControlCoinClass()}`}>
                            {getControlCoinLabel()}
                        </div>
                    </div>
                )}
                <div className="protocol-bar opponent-bar">
                    {opponent.protocols.map((p, i) => 
                        <div key={`opp-proto-${p}-${i}`} className={getProtocolClass('protocol-display', opponent.compiled[i], i)}>
                            <span className="protocol-name">{p}</span>
                            <span className="protocol-value">{opponent.laneValues[i]}</span>
                        </div>
                    )}
                </div>
                <div className="protocol-bar player-bar">
                    {player.protocols.map((p, i) => 
                        <div key={`player-proto-${p}-${i}`} className={getProtocolClass('protocol-display', player.compiled[i], i)}>
                            <span className="protocol-name">{p}</span>
                            <span className="protocol-value">{player.laneValues[i]}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Player's Side */}
            <div className={`player-side ${turn === 'player' ? 'active-turn' : ''}`}>
                <div className="lanes">
                    {player.lanes.map((laneCards, i) => {
                        const { isPlayable, isMatching, isCompilable } = getLanePlayability(i);
                        const faceDownValue = getFaceDownValue(laneCards);
                        return <Lane 
                            key={`player-lane-${i}`} 
                            cards={laneCards} 
                            isPlayable={isPlayable} 
                            isMatching={isMatching} 
                            isCompilable={isCompilable} 
                            isShiftTarget={getLaneShiftTargetability(i, 'player')}
                            isEffectTarget={getLaneEffectTargetability(i)}
                            onLanePointerDown={() => onLanePointerDown(i)} 
                            onPlayFaceDown={() => onPlayFaceDown(i)}
                            onCardPointerDown={(card) => onCardPointerDown(card, 'player', i)} 
                            onCardPointerEnter={(card) => onCardPointerEnter(card, 'player')} 
                            onCardPointerLeave={() => onCardPointerLeave()} 
                            owner="player" 
                            animationState={animationState}
                            isCardTargetable={(card) => isCardTargetable(card, gameState)}
                            faceDownValue={faceDownValue}
                            sourceCardId={sourceCardId}
                            gameState={gameState}
                        />
                    })}
                </div>
            </div>
        </div>
    );
};