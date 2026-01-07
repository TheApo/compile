/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { GameState, PlayedCard } from '../types';
import { CardPosition } from '../types/animation';
import { CardComponent } from './Card';
import { getEffectiveCardValue } from '../logic/game/stateManager';

interface LaneProps {
    cards: PlayedCard[];
    isPlayable: boolean;
    isCompilable: boolean;
    isShiftTarget: boolean;
    isEffectTarget: boolean;
    isMatching?: boolean;
    onLanePointerDown: () => void;
    onPlayFaceDown?: () => void;
    onCardPointerDown: (card: PlayedCard) => void;
    onCardPointerEnter: (card: PlayedCard) => void;
    onCardPointerLeave: (card: PlayedCard) => void;
    owner: 'player' | 'opponent';
    animationState: GameState['animationState'];
    isCardTargetable: (card: PlayedCard) => boolean;
    laneIndex: number;
    sourceCardId: string | null;
    gameState: GameState;
    animatingCardIds?: Set<string>;  // Card IDs being animated (should be hidden)
    animatingCardInfo?: { cardId: string; fromPosition: CardPosition } | null;  // Extended info for shift animation hiding
}

export const Lane: React.FC<LaneProps> = ({ cards, isPlayable, isCompilable, isShiftTarget, isEffectTarget, isMatching, onLanePointerDown, onPlayFaceDown, onCardPointerDown, onCardPointerEnter, onCardPointerLeave, owner, animationState, isCardTargetable, laneIndex, sourceCardId, gameState, animatingCardIds, animatingCardInfo }) => {

    const laneClasses = ['lane'];
    if (isPlayable) laneClasses.push('playable');
    if (isMatching) laneClasses.push('matching-protocol');
    if (isCompilable) laneClasses.push('compilable');
    if (isShiftTarget) laneClasses.push('shift-target');
    if (isEffectTarget) laneClasses.push('effect-target');

    return (
        <div
            className={laneClasses.join(' ')}
            onPointerDown={onLanePointerDown}
        >
            {isPlayable && isMatching && owner === 'player' && onPlayFaceDown && (
                <button
                    className="btn btn-play-facedown"
                    onPointerDown={(e) => {
                        e.stopPropagation();
                        onPlayFaceDown();
                    }}
                >
                    Play Face-Down
                </button>
            )}
            <div className="lane-stack">
                {(() => {
                    // DEFENSIVE: Deduplicate lane cards to prevent React key errors
                    const seenIds = new Set<string>();
                    return cards
                        .filter(card => {
                            if (seenIds.has(card.id)) {
                                console.warn('[Lane] Duplicate card ID in lane:', card.id, owner, laneIndex);
                                return false;
                            }
                            seenIds.add(card.id);
                            return true;
                        })
                        .map((card, index) => {
                            const isRevealed = gameState.actionRequired?.type === 'prompt_shift_or_flip_for_light_2' && gameState.actionRequired.revealedCardId === card.id;
                            // Calculate effective face-down value for this specific card
                            const faceDownValue = getEffectiveCardValue(card, cards, gameState, laneIndex, owner);
                            // Hide card if it's being animated FROM this lane
                            let isBeingAnimated = false;
                            if (animatingCardInfo?.cardId === card.id) {
                                if (animatingCardInfo.fromPosition.type === 'lane') {
                                    isBeingAnimated =
                                        animatingCardInfo.fromPosition.owner === owner &&
                                        animatingCardInfo.fromPosition.laneIndex === laneIndex &&
                                        animatingCardInfo.fromPosition.cardIndex === index;
                                }
                            } else if (animatingCardIds?.has(card.id)) {
                                isBeingAnimated = true;
                            }
                            return (
                                <CardComponent
                                    key={`lane-${owner}-${laneIndex}-${card.id}-${index}`}
                                    card={card}
                                    isFaceUp={card.isFaceUp || isRevealed}
                                    style={{ '--i': index } as React.CSSProperties}
                                    onPointerDown={(e) => {
                                        // Stop the event from bubbling up to the lane's onPointerDown handler.
                                        // This prevents a single click from being interpreted as both a card
                                        // selection and a lane selection, which causes bugs with multi-step actions.
                                        e.stopPropagation();
                                        onCardPointerDown(card);
                                    }}
                                    onPointerEnter={() => onCardPointerEnter(card)}
                                    animationState={animationState}
                                    isTargetable={isCardTargetable(card)}
                                    isSourceOfEffect={card.id === sourceCardId}
                                    faceDownValue={faceDownValue}
                                    additionalClassName={isBeingAnimated ? 'animating-hidden' : undefined}
                                />
                            );
                        });
                })()}
            </div>
        </div>
    );
};