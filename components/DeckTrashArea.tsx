/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DeckTrashArea Component
 *
 * Displays the deck and trash piles on the left side of the game board.
 * Cards are rotated 90° (lying on their side) to save horizontal space.
 * Clicking on deck or trash opens the debug modal for that player.
 */

import React from 'react';
import { PlayedCard, Player } from '../types';
import { CardComponent } from './Card';

interface DeckTrashAreaProps {
    owner: Player;
    deckCount: number;
    topTrashCard: PlayedCard | null;
    trashCount: number;
    onDeckClick: () => void;
    onTrashClick: () => void;
    onTrashCardHover?: (card: PlayedCard) => void;
    onTrashCardLeave?: () => void;
}

export const DeckTrashArea: React.FC<DeckTrashAreaProps> = ({
    owner,
    deckCount,
    topTrashCard,
    trashCount,
    onDeckClick,
    onTrashClick,
    onTrashCardHover,
    onTrashCardLeave,
}) => {
    const isOpponent = owner === 'opponent';

    // Create a dummy card for the deck display (face-down)
    const deckDisplayCard: PlayedCard = {
        id: `deck-display-${owner}`,
        protocol: 'Deck',
        value: deckCount,
        isFaceUp: false,
        bottomRule: '',
        middleRule: '',
    };

    return (
        <div className={`deck-trash-area ${owner}`}>
            {/* For opponent: Deck on top, Trash below */}
            {/* For player: Trash on top, Deck below */}
            {isOpponent ? (
                <>
                    <div
                        className={`deck-pile ${owner}`}
                        onClick={onDeckClick}
                        title={`${owner === 'player' ? 'Your' : "Opponent's"} Deck (${deckCount} cards) - Click for details`}
                    >
                        <div className="pile-label">Deck</div>
                        <div className="pile-card-wrapper">
                            {deckCount > 0 ? (
                                <CardComponent
                                    card={deckDisplayCard}
                                    isFaceUp={false}
                                    faceDownValue={deckCount}
                                />
                            ) : (
                                <div className="empty-pile">Empty</div>
                            )}
                        </div>
                        <div className="pile-count">{deckCount}</div>
                    </div>
                    <div
                        className={`trash-pile ${owner}`}
                        onClick={onTrashClick}
                        onPointerEnter={() => topTrashCard && onTrashCardHover?.(topTrashCard)}
                        onPointerLeave={() => onTrashCardLeave?.()}
                        title={`${owner === 'player' ? 'Your' : "Opponent's"} Trash (${trashCount} cards) - Click for details`}
                    >
                        <div className="pile-label">Trash</div>
                        <div className="pile-card-wrapper">
                            {topTrashCard ? (
                                <CardComponent
                                    card={topTrashCard}
                                    isFaceUp={true}
                                />
                            ) : (
                                <div className="empty-pile">Empty</div>
                            )}
                        </div>
                        <div className="pile-count">{trashCount}</div>
                    </div>
                </>
            ) : (
                <>
                    <div
                        className={`trash-pile ${owner}`}
                        onClick={onTrashClick}
                        onPointerEnter={() => topTrashCard && onTrashCardHover?.(topTrashCard)}
                        onPointerLeave={() => onTrashCardLeave?.()}
                        title={`${owner === 'player' ? 'Your' : "Opponent's"} Trash (${trashCount} cards) - Click for details`}
                    >
                        <div className="pile-label">Trash</div>
                        <div className="pile-card-wrapper">
                            {topTrashCard ? (
                                <CardComponent
                                    card={topTrashCard}
                                    isFaceUp={true}
                                />
                            ) : (
                                <div className="empty-pile">Empty</div>
                            )}
                        </div>
                        <div className="pile-count">{trashCount}</div>
                    </div>
                    <div
                        className={`deck-pile ${owner}`}
                        onClick={onDeckClick}
                        title={`${owner === 'player' ? 'Your' : "Opponent's"} Deck (${deckCount} cards) - Click for details`}
                    >
                        <div className="pile-label">Deck</div>
                        <div className="pile-card-wrapper">
                            {deckCount > 0 ? (
                                <CardComponent
                                    card={deckDisplayCard}
                                    isFaceUp={false}
                                    faceDownValue={deckCount}
                                />
                            ) : (
                                <div className="empty-pile">Empty</div>
                            )}
                        </div>
                        <div className="pile-count">{deckCount}</div>
                    </div>
                </>
            )}
        </div>
    );
};
