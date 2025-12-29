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
    animatingCardId?: string | null;  // NEW: Card ID being animated (should be hidden)
    animatingCardInfo?: { cardId: string; fromPosition: CardPosition } | null;  // Extended info for shift animation hiding
}

export const Lane: React.FC<LaneProps> = ({ cards, isPlayable, isCompilable, isShiftTarget, isEffectTarget, isMatching, onLanePointerDown, onPlayFaceDown, onCardPointerDown, onCardPointerEnter, onCardPointerLeave, owner, animationState, isCardTargetable, laneIndex, sourceCardId, gameState, animatingCardId, animatingCardInfo }) => {

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
                {cards.map((card, index) => {
                    const isRevealed = gameState.actionRequired?.type === 'prompt_shift_or_flip_for_light_2' && gameState.actionRequired.revealedCardId === card.id;
                    // Calculate effective face-down value for this specific card
                    const faceDownValue = getEffectiveCardValue(card, cards, gameState, laneIndex, owner);
                    // NEW: Hide card if it's being animated FROM this lane
                    // For shift/delete animations, we need to check the fromPosition
                    // IMPORTANT: Only hide if the animation is FROM THIS LANE specifically
                    // Don't hide board cards when animation is from hand/deck (discard, draw)
                    let isBeingAnimated = false;
                    if (animatingCardInfo?.cardId === card.id) {
                        // Only hide if animation is FROM this specific lane
                        if (animatingCardInfo.fromPosition.type === 'lane') {
                            isBeingAnimated = animatingCardInfo.fromPosition.laneIndex === laneIndex &&
                                              animatingCardInfo.fromPosition.owner === owner;
                        }
                        // If animation is from hand/deck, don't hide board cards (they're different cards)
                    } else if (animatingCardId === card.id) {
                        // Fallback: If card ID matches, hide it (for face-down cards that match by ID)
                        isBeingAnimated = true;
                    }
                    return (
                        <CardComponent
                            key={card.id}
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
                })}
            </div>
        </div>
    );
};