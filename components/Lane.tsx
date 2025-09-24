/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { GameState, PlayedCard } from '../types';
import { CardComponent } from './Card';

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
    faceDownValue: number;
    sourceCardId: string | null;
    gameState: GameState;
}

export const Lane: React.FC<LaneProps> = ({ cards, isPlayable, isCompilable, isShiftTarget, isEffectTarget, isMatching, onLanePointerDown, onPlayFaceDown, onCardPointerDown, onCardPointerEnter, onCardPointerLeave, owner, animationState, isCardTargetable, faceDownValue, sourceCardId, gameState }) => {
    
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
                            onPointerLeave={() => onCardPointerLeave(card)}
                            animationState={animationState}
                            isTargetable={isCardTargetable(card)}
                            isSourceOfEffect={card.id === sourceCardId}
                            faceDownValue={faceDownValue}
                        />
                    );
                })}
            </div>
        </div>
    );
};