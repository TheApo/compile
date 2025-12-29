/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { GameState, PlayedCard } from '../types';
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
}

export const Lane: React.FC<LaneProps> = ({ cards, isPlayable, isCompilable, isShiftTarget, isEffectTarget, isMatching, onLanePointerDown, onPlayFaceDown, onCardPointerDown, onCardPointerEnter, onCardPointerLeave, owner, animationState, isCardTargetable, laneIndex, sourceCardId, gameState, animatingCardId }) => {

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
                    // NEW: Hide card if it's being animated (flying away)
                    const isBeingAnimated = animatingCardId === card.id;
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