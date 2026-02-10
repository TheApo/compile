/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { GameState, PlayedCard, Player } from '../types';
import { CardPosition } from '../types/animation';
import { Lane } from './Lane';
import { CardComponent } from './Card';
import { DeckTrashArea } from './DeckTrashArea';
import { isCardTargetable } from '../utils/targeting';
import { hasRequireNonMatchingProtocolRule, hasAnyProtocolPlayRule, canShiftCard, hasPlayOnOpponentSideRule, canPlayFaceUpDueToSameProtocolRule } from '../logic/game/passiveRuleChecker';
import { getEffectiveCardValue } from '../logic/game/stateManager';
import { useAnimationQueue } from '../contexts/AnimationQueueContext';

interface GameBoardProps {
    gameState: GameState;
    onLanePointerDown: (laneIndex: number, owner: Player) => void;
    onPlayFaceDown: (laneIndex: number) => void;
    onCardPointerDown: (card: PlayedCard, owner: Player, laneIndex: number) => void;
    onCardPointerEnter: (card: PlayedCard, owner: Player) => void;
    onCardPointerLeave: () => void;
    onOpponentHandCardPointerEnter: (card: PlayedCard) => void;
    onOpponentHandCardPointerLeave: () => void;
    selectedCardId: string | null;
    sourceCardId: string | null;
    animatingCardIds?: Set<string>;  // Cards being animated (hide via CSS)
    animatingCardInfo?: { cardId: string; fromPosition: CardPosition } | null;  // Extended info for shift animation hiding
    // Deck/Trash callbacks
    onDeckClick?: (owner: Player) => void;
    onTrashClick?: (owner: Player) => void;
    onTrashCardHover?: (card: PlayedCard, owner: Player) => void;
    onTrashCardLeave?: () => void;
}

export const GameBoard: React.FC<GameBoardProps> = ({ gameState, onLanePointerDown, onPlayFaceDown, onCardPointerDown, onCardPointerEnter, onCardPointerLeave, onOpponentHandCardPointerEnter, onOpponentHandCardPointerLeave, selectedCardId, sourceCardId, animatingCardIds, animatingCardInfo, onDeckClick, onTrashClick, onTrashCardHover, onTrashCardLeave }) => {
    const { player, opponent, phase, turn, compilableLanes, actionRequired, controlCardHolder } = gameState;
    const { currentAnimation } = useAnimationQueue();

    const getLanePlayability = (laneIndex: number): { isPlayable: boolean, isMatching: boolean, isCompilable: boolean } => {
        const isCompilable = phase === 'compile' && turn === 'player' && !actionRequired && compilableLanes.includes(laneIndex);

        const isPlayerTurn = turn === 'player';
        const isPlayFromHand = phase === 'action' && !actionRequired && selectedCardId;
        const isPlayFromEffect = actionRequired?.type === 'select_lane_for_play';

        // CRITICAL: For effect-based plays, check actor not turn (handles interrupts)
        const canPlayerAct = isPlayFromEffect
            ? (actionRequired as any)?.actor === 'player'
            : isPlayerTurn;

        if (!canPlayerAct || (!isPlayFromHand && !isPlayFromEffect)) {
            return { isPlayable: false, isMatching: false, isCompilable };
        }
        
        let card: PlayedCard | undefined;
        if (isPlayFromHand) {
            card = player.hand.find(c => c.id === selectedCardId);
        } else if (isPlayFromEffect) {
            // CRITICAL: Check disallowedLaneIndex FIRST before any other checks
            // This handles Darkness-3 "Play to OTHER lines" - excludes current lane
            if (actionRequired.disallowedLaneIndex !== undefined && laneIndex === actionRequired.disallowedLaneIndex) {
                return { isPlayable: false, isMatching: false, isCompilable };
            }

            // NEW: Smoke-3 - validLanes restricts which lanes can be selected
            const validLanes = (actionRequired as any).validLanes;
            if (validLanes && !validLanes.includes(laneIndex)) {
                return { isPlayable: false, isMatching: false, isCompilable };
            }

            // Life-3: Playing from deck - no card in hand
            if ((actionRequired as any).source === 'deck') {
                // Exclude current lane if specified (legacy check for excludeCurrentLane)
                if ((actionRequired as any).excludeCurrentLane && laneIndex === (actionRequired as any).currentLaneIndex) {
                    return { isPlayable: false, isMatching: false, isCompilable };
                }
                // All other lanes are playable (face-down from deck, no protocol matching needed)
                return { isPlayable: true, isMatching: false, isCompilable };
            }

            // Time-0, Time-3: Playing from trash - card is pre-selected (preDrawnCard)
            if ((actionRequired as any).source === 'trash') {
                const useNormalPlayRules = (actionRequired as any).useNormalPlayRules;
                const preDrawnCard = (actionRequired as any).preDrawnCard;

                if (useNormalPlayRules && preDrawnCard) {
                    // Normal play rules: check protocol matching EXACTLY like hand plays
                    // Card matches if it matches EITHER player's OR opponent's assigned protocol for this lane
                    const playerProtocol = player.protocols[laneIndex];
                    const opponentProtocol = opponent.protocols[laneIndex];
                    const isMatching = preDrawnCard.protocol === playerProtocol || preDrawnCard.protocol === opponentProtocol;
                    return { isPlayable: true, isMatching, isCompilable };
                }

                // Time-3: play face-down, no protocol matching needed
                return { isPlayable: true, isMatching: false, isCompilable };
            }

            card = player.hand.find(c => c.id === actionRequired.cardInHandId);
        }

        if (!card) {
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

        // Check if the card being played has ignore_protocol_matching card_property (generic check)
        const thisCardIgnoresMatching = (card as any).customEffects?.bottomEffects?.some(
            (e: any) => e.params?.action === 'card_property' && e.params?.property === 'ignore_protocol_matching'
        ) || (card as any).customEffects?.topEffects?.some(
            (e: any) => e.params?.action === 'card_property' && e.params?.property === 'ignore_protocol_matching'
        ) || (card as any).customEffects?.middleEffects?.some(
            (e: any) => e.params?.action === 'card_property' && e.params?.property === 'ignore_protocol_matching'
        );

        // Check for Anarchy-1 on ANY player's field (affects both players)
        const anyPlayerHasAnarchy1 = [...player.lanes.flat(), ...opponent.lanes.flat()]
            .some(c => c.isFaceUp && c.protocol === 'Anarchy' && c.value === 1);

        // NEW: Check for custom cards with require_non_matching_protocol passive rule
        const hasCustomNonMatchingRule = hasRequireNonMatchingProtocolRule(gameState);

        // NEW: Check for custom cards with allow_any_protocol_play passive rule (Spirit_custom-1)
        const hasCustomAllowAnyProtocol = hasAnyProtocolPlayRule(gameState, 'player', laneIndex);

        // Check if card can play on any lane (allow_play_on_opponent_side passive rule)
        const canPlayAnywhere = hasPlayOnOpponentSideRule(gameState, card);

        // NEW: Check for Unity-1 same-protocol face-up play rule
        const hasSameProtocolFaceUpRule = canPlayFaceUpDueToSameProtocolRule(gameState, 'player', laneIndex, card.protocol);

        // NEW: Check if effect allows any orientation (Diversity-0: player chooses)
        const effectIgnoresProtocol = isPlayFromEffect && (actionRequired as any).ignoreProtocolMatching;

        let isMatching: boolean;
        if (canPlayAnywhere || effectIgnoresProtocol) {
            // Can play face-up on ANY lane (ignores protocol matching)
            isMatching = !opponentHasPsychic1;
        } else if (anyPlayerHasAnarchy1 || hasCustomNonMatchingRule) {
            // Anarchy-1 OR custom require_non_matching_protocol: INVERTED rule - can only play face-up if protocol does NOT match
            const doesNotMatch = card.protocol !== player.protocols[laneIndex] && card.protocol !== opponent.protocols[laneIndex];
            isMatching = doesNotMatch && !opponentHasPsychic1;
        } else {
            // Normal rule: can play face-up if protocol DOES match (or Spirit-1/custom override)
            // OR if THIS CARD ignores protocol matching (Chaos-3 or custom cards with ignore_protocol_matching)
            // OR if Unity-1 same-protocol face-up rule allows it
            isMatching = (
                playerHasSpiritOne ||
                hasCustomAllowAnyProtocol ||
                thisCardIgnoresMatching ||
                hasSameProtocolFaceUpRule ||
                card.protocol === player.protocols[laneIndex] ||
                card.protocol === opponent.protocols[laneIndex]
            ) && !opponentHasPsychic1;
        }
    
        const opponentHasMetalTwo = oppLane.some(c => c.isFaceUp && c.protocol === 'Metal' && c.value === 2);
        if (opponentHasMetalTwo && !isMatching) {
            return { isPlayable: false, isMatching: false, isCompilable };
        }

        // CRITICAL: Force face-down play if required by effect (e.g., Darkness-3, Darkness_custom-3)
        if (isPlayFromEffect && (actionRequired.isFaceDown || (actionRequired as any).faceDown)) {
            return { isPlayable: true, isMatching: false, isCompilable };
        }

        return { isPlayable: true, isMatching, isCompilable };
    }

    // NEW: Check if opponent's lane is playable (for cards with allow_play_on_opponent_side)
    const getOpponentLanePlayability = (laneIndex: number): { isPlayable: boolean, isMatching: boolean } => {
        const isPlayerTurn = turn === 'player';
        const isPlayFromHand = phase === 'action' && !actionRequired && selectedCardId;

        if (!isPlayerTurn || !isPlayFromHand) {
            return { isPlayable: false, isMatching: false };
        }

        const card = player.hand.find(c => c.id === selectedCardId);
        if (!card) {
            return { isPlayable: false, isMatching: false };
        }

        // Check if the selected card has allow_play_on_opponent_side passive rule
        if (!hasPlayOnOpponentSideRule(gameState, card)) {
            return { isPlayable: false, isMatching: false };
        }

        // Rule: Lane blocked by own uncovered Plague-0 (from player's perspective, opponent's Plague-0 blocks player)
        // But here we're playing ON opponent's side, so check if PLAYER's Plague-0 blocks opponent lane
        const playerLane = player.lanes[laneIndex];
        const isLaneBlocked = playerLane.length > 0 &&
                              playerLane[playerLane.length - 1].isFaceUp &&
                              playerLane[playerLane.length - 1].protocol === 'Plague' &&
                              playerLane[playerLane.length - 1].value === 0;
        if (isLaneBlocked) {
            return { isPlayable: false, isMatching: false };
        }

        // Cards with allow_play_on_opponent_side can play on ANY lane (face-up only on opponent's side)
        return { isPlayable: true, isMatching: true };
    }

    const getLaneEffectTargetability = (targetLaneIndex: number): boolean => {
        if (!actionRequired || actionRequired.actor !== 'player') return false;
        switch (actionRequired.type) {
            case 'select_lane_for_delete': {
                // NEW: Check validLanes for Courage-1 (opponent_higher_value)
                const validLanes = (actionRequired as any).validLanes;
                if (validLanes && !validLanes.includes(targetLaneIndex)) return false;
                return true;
            }
            case 'select_lane_for_death_2':
            case 'select_lane_for_water_3':
            case 'select_lane_for_return':
                return true;
            case 'select_lane_for_metal_3_delete': {
                if (targetLaneIndex === actionRequired.disallowedLaneIndex) return false;
                const totalCards = player.lanes[targetLaneIndex].length + opponent.lanes[targetLaneIndex].length;
                return totalCards >= 8;
            }
            case 'select_lane_for_delete_all': {
                // Custom protocol version: use validLanes from actionRequired
                const validLanes = (actionRequired as any).validLanes || [];
                return validLanes.includes(targetLaneIndex);
            }
            case 'select_lanes_for_swap_stacks': {
                // Mirror-2: Swap stacks - use validLanes from actionRequired
                const validLanes = (actionRequired as any).validLanes || [];
                return validLanes.includes(targetLaneIndex);
            }
            default:
                return false;
        }
    };

    const getLaneShiftTargetability = (targetLaneIndex: number, targetOwner: Player): boolean => {
        if (!actionRequired || actionRequired.actor !== 'player') return false;

        // RULE: Check passive rules for shift restrictions (Frost-3, custom protocols with block_shifts rules)
        // This is needed for UI highlighting - check if shift TO this lane is allowed
        // We use originalLaneIndex as FROM and targetLaneIndex as TO
        const originalLaneIndex = actionRequired.type === 'select_lane_for_shift' ? actionRequired.originalLaneIndex :
                                  actionRequired.type === 'select_card_to_shift' ? -1 : -1; // -1 = unknown/not applicable

        if (originalLaneIndex !== -1) {
            const shiftCheck = canShiftCard(gameState, originalLaneIndex, targetLaneIndex);
            if (!shiftCheck.allowed) {
                return false; // Shift is blocked by passive rule
            }
        }

        switch (actionRequired.type) {
            case 'select_lane_for_shift': {
                // Target lane must belong to the card's owner and not be the original lane.
                if (targetOwner !== actionRequired.cardOwner || targetLaneIndex === actionRequired.originalLaneIndex) {
                    return false;
                }

                // NEW: Check validLanes for Courage-3 (opponent_highest_value_lane)
                const validLanes = (actionRequired as any).validLanes;
                if (validLanes && !validLanes.includes(targetLaneIndex)) {
                    return false;
                }

                // CRITICAL VALIDATION for Gravity-1 AND Custom Protocols: "Shift 1 card either to or from this line"
                // Check BOTH original Gravity-1 AND generic destinationRestriction for custom protocols
                const sourceCard = [...gameState.player.lanes.flat(), ...gameState.opponent.lanes.flat()]
                    .find(c => c.id === actionRequired.sourceCardId);

                // Check for custom protocol destinationRestriction first (generic approach)
                const destinationRestriction = (actionRequired as any).destinationRestriction;
                if (destinationRestriction && destinationRestriction.type === 'to_or_from_this_lane') {
                    // Find source card's lane to resolve 'current'
                    let resolvedSourceLane = destinationRestriction.laneIndex;
                    if (destinationRestriction.laneIndex === 'current' && sourceCard) {
                        for (const owner of ['player', 'opponent'] as Player[]) {
                            for (let i = 0; i < gameState[owner].lanes.length; i++) {
                                if (gameState[owner].lanes[i].some(c => c.id === actionRequired.sourceCardId)) {
                                    resolvedSourceLane = i;
                                    break;
                                }
                            }
                            if (typeof resolvedSourceLane === 'number') break;
                        }
                    }

                    // RULE: Either originalLaneIndex OR targetLaneIndex must be the resolved lane
                    if (typeof resolvedSourceLane === 'number') {
                        const isFromSpecifiedLane = actionRequired.originalLaneIndex === resolvedSourceLane;
                        const isToSpecifiedLane = targetLaneIndex === resolvedSourceLane;

                        // At least ONE must be true
                        if (!isFromSpecifiedLane && !isToSpecifiedLane) {
                            return false; // ILLEGAL: Neither source nor target is the specified lane
                        }
                    }
                }
                // Fallback: Original Gravity-1 hardcoded check (for backwards compatibility)
                else if (sourceCard && sourceCard.protocol === 'Gravity' && sourceCard.value === 1) {
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
                // CRITICAL: Find which player owns the card (Spirit-3 on player side, Darkness-1 on opponent side)
                const cardId = actionRequired.cardId;
                let cardOwner: Player | null = null;
                let originalLaneIndex = -1;

                // Check player's lanes
                for(let i = 0; i < player.lanes.length; i++) {
                    if (player.lanes[i].some(c => c.id === cardId)) {
                        cardOwner = 'player';
                        originalLaneIndex = i;
                        break;
                    }
                }

                // Check opponent's lanes if not found on player side
                if (cardOwner === null) {
                    for(let i = 0; i < opponent.lanes.length; i++) {
                        if (opponent.lanes[i].some(c => c.id === cardId)) {
                            cardOwner = 'opponent';
                            originalLaneIndex = i;
                            break;
                        }
                    }
                }

                // Card must be on the same side as the target lane
                if (targetOwner !== cardOwner) return false;

                // Cannot shift to same lane
                return targetLaneIndex !== originalLaneIndex;
            }
            case 'select_lane_for_life_3_play':
                return targetOwner === 'player' && targetLaneIndex !== actionRequired.disallowedLaneIndex;
            case 'select_lane_to_shift_revealed_card_for_light_2':
                 return targetOwner === 'player'; // TODO: Check card owner
            case 'select_lane_to_shift_revealed_board_card_custom': {
                // Check which player owns the revealed card
                const revealedCardId = actionRequired.revealedCardId;
                const cardInfo = [...gameState.player.lanes.flat(), ...gameState.opponent.lanes.flat()]
                    .find(c => c.id === revealedCardId);
                if (!cardInfo) return false;

                // Find card owner
                let cardOwner: Player | null = null;
                let originalLaneIndex = -1;
                for (const owner of ['player', 'opponent'] as Player[]) {
                    for (let i = 0; i < gameState[owner].lanes.length; i++) {
                        if (gameState[owner].lanes[i].some(c => c.id === revealedCardId)) {
                            cardOwner = owner;
                            originalLaneIndex = i;
                            break;
                        }
                    }
                    if (cardOwner) break;
                }

                // Can only shift to same owner's lanes, and not to same lane
                return targetOwner === cardOwner && targetLaneIndex !== originalLaneIndex;
            }
            case 'select_lane_for_shift_all': {
                // GENERIC: Shift all cards from sourceLaneIndex to ANY other lane
                const sourceLane = (actionRequired as any).sourceLaneIndex;
                return targetLaneIndex !== sourceLane;
            }
            case 'select_lane_to_shift_cards_for_light_3':
                 return targetLaneIndex !== actionRequired.sourceLaneIndex;
            default:
                return false;
        }
    }

    const getProtocolClass = (baseClass: string, isCompiled: boolean, laneIndex: number) => {
        let classes = [baseClass];
        if (isCompiled) classes.push('compiled');
        if (currentAnimation?.type === 'delete' && currentAnimation.laneIndex === laneIndex) {
            classes.push('is-compiling');
        }
        return classes.join(' ');
    }


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
                {(() => {
                    // DEFENSIVE: Deduplicate hand cards to prevent React key errors
                    const seenIds = new Set<string>();
                    return opponent.hand
                        .filter(card => {
                            if (seenIds.has(card.id)) {
                                console.warn('[GameBoard] Duplicate card ID in opponent hand:', card.id);
                                return false;
                            }
                            seenIds.add(card.id);
                            return true;
                        })
                        .map((card, index) => {
                            // Hide the card if it's being animated (kept in DOM for position detection)
                            const isBeingAnimated = animatingCardIds?.has(card.id);
                            return (
                                <CardComponent
                                    key={`opp-hand-${card.id}-${index}`}
                                    card={card}
                                    isFaceUp={card.isRevealed || false}
                                    additionalClassName={`in-hand ${isBeingAnimated ? 'animating-hidden' : ''}`}
                                    onPointerEnter={() => onOpponentHandCardPointerEnter(card)}
                                />
                            );
                        });
                })()}
            </div>

            {/* Opponent's Side */}
            <div className={`player-side opponent-side ${turn === 'opponent' ? 'active-turn' : ''}`}>
                {/* Deck/Trash for opponent - inside opponent-side so it aligns with lanes */}
                <DeckTrashArea
                    owner="opponent"
                    deckCount={opponent.deck.length}
                    topTrashCard={opponent.discard.length > 0 ? opponent.discard[opponent.discard.length - 1] : null}
                    trashCount={opponent.discard.length}
                    onDeckClick={() => onDeckClick?.('opponent')}
                    onTrashClick={() => onTrashClick?.('opponent')}
                    onTrashCardHover={(card) => onTrashCardHover?.(card, 'opponent')}
                    onTrashCardLeave={onTrashCardLeave}
                />
                <div className="lanes">
                    {opponent.lanes.map((laneCards, i) => {
                        const { isPlayable: oppIsPlayable, isMatching: oppIsMatching } = getOpponentLanePlayability(i);
                        return <Lane
                            key={`opp-lane-${i}`}
                            cards={laneCards}
                            isPlayable={oppIsPlayable}
                            isMatching={oppIsMatching}
                            isCompilable={false}
                            isShiftTarget={getLaneShiftTargetability(i, 'opponent')}
                            isEffectTarget={getLaneEffectTargetability(i)}
                            onLanePointerDown={() => onLanePointerDown(i, 'opponent')}
                            onCardPointerDown={(card) => onCardPointerDown(card, 'opponent', i)}
                            onCardPointerEnter={(card) => onCardPointerEnter(card, 'opponent')}
                            onCardPointerLeave={() => onCardPointerLeave()}
                            owner="opponent"
                            isCardTargetable={(card) => isCardTargetable(card, gameState)}
                            laneIndex={i}
                            sourceCardId={sourceCardId}
                            gameState={gameState}
                            animatingCardIds={animatingCardIds}
                            animatingCardInfo={animatingCardInfo}
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
                <div className={`protocol-bar opponent-bar ${turn === 'opponent' ? 'active-turn' : ''}`}>
                    {opponent.protocols.map((p, i) =>
                        <div key={`opp-proto-${p}-${i}`} className={getProtocolClass('protocol-display', opponent.compiled[i], i)}>
                            <span className="protocol-name">{p}</span>
                            <span className="protocol-value">{opponent.laneValues[i]}</span>
                        </div>
                    )}
                </div>
                <div className={`protocol-bar player-bar ${turn === 'player' ? 'active-turn' : ''}`}>
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
                {/* Deck/Trash for player - inside player-side so it aligns with lanes */}
                <DeckTrashArea
                    owner="player"
                    deckCount={player.deck.length}
                    topTrashCard={player.discard.length > 0 ? player.discard[player.discard.length - 1] : null}
                    trashCount={player.discard.length}
                    onDeckClick={() => onDeckClick?.('player')}
                    onTrashClick={() => onTrashClick?.('player')}
                    onTrashCardHover={(card) => onTrashCardHover?.(card, 'player')}
                    onTrashCardLeave={onTrashCardLeave}
                />
                <div className="lanes">
                    {player.lanes.map((laneCards, i) => {
                        const { isPlayable, isMatching, isCompilable } = getLanePlayability(i);
                        return <Lane
                            key={`player-lane-${i}`}
                            cards={laneCards}
                            isPlayable={isPlayable}
                            isMatching={isMatching}
                            isCompilable={isCompilable}
                            isShiftTarget={getLaneShiftTargetability(i, 'player')}
                            isEffectTarget={getLaneEffectTargetability(i)}
                            onLanePointerDown={() => onLanePointerDown(i, 'player')}
                            onPlayFaceDown={() => onPlayFaceDown(i)}
                            onCardPointerDown={(card) => onCardPointerDown(card, 'player', i)}
                            onCardPointerEnter={(card) => onCardPointerEnter(card, 'player')}
                            onCardPointerLeave={() => onCardPointerLeave()}
                            owner="player"
                            isCardTargetable={(card) => isCardTargetable(card, gameState)}
                            laneIndex={i}
                            sourceCardId={sourceCardId}
                            gameState={gameState}
                            animatingCardIds={animatingCardIds}
                            animatingCardInfo={animatingCardInfo}
                        />
                    })}
                </div>
            </div>
        </div>
    );
};