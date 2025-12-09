/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { GameState } from '../types';
import { CardComponent } from './Card';

interface RevealedDeckModalProps {
    gameState: GameState;
    onSelectCard: (cardId: string) => void;
}

/**
 * Modal for selecting a card from a revealed deck (Clarity-2/3)
 */
export function RevealedDeckModal({ gameState, onSelectCard }: RevealedDeckModalProps) {
    const [previewCard, setPreviewCard] = useState<any>(null);
    const isTouchDevice = useRef(false);

    const action = gameState.actionRequired as any;
    if (!action || action.type !== 'select_card_from_revealed_deck') {
        return null;
    }

    const { revealedCards, selectableCardIds, valueFilter, actor } = action;
    const actorState = gameState[actor];
    const deck = revealedCards || actorState.deck;

    // Create card objects with IDs for display
    const deckCards = deck.map((card: any, index: number) => ({
        ...card,
        id: card.id || `deck-${index}`,
        isFaceUp: true, // Show all cards face-up
    }));

    const isSelectable = (cardId: string) => {
        return selectableCardIds?.includes(cardId);
    };

    // Touch: tap = preview only
    const handleTouchStart = (card: any) => {
        isTouchDevice.current = true;
        if (isSelectable(card.id)) {
            setPreviewCard(card);
        }
    };

    // Mouse: hover = preview, click = also just preview
    const handleMouseEnter = (card: any) => {
        if (!isTouchDevice.current && isSelectable(card.id)) {
            setPreviewCard(card);
        }
    };

    const handleClick = (card: any) => {
        // Click only sets preview, selection happens via button
        if (isSelectable(card.id)) {
            setPreviewCard(card);
        }
    };

    const handleConfirmSelection = () => {
        if (previewCard && isSelectable(previewCard.id)) {
            onSelectCard(previewCard.id);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content revealed-deck-modal" onClick={(e) => e.stopPropagation()}>
                <h2>Your Revealed Deck</h2>
                <p>Select a card with value {valueFilter} to draw:</p>

                <div className="revealed-deck-layout">
                    {/* Preview card on the left */}
                    <div className="revealed-deck-preview">
                        {previewCard ? (
                            <>
                                <CardComponent
                                    card={previewCard}
                                    isFaceUp={true}
                                />
                                <button
                                    className="btn preview-confirm-btn"
                                    onClick={handleConfirmSelection}
                                >
                                    Draw {previewCard.protocol}-{previewCard.value}
                                </button>
                            </>
                        ) : (
                            <div className="preview-placeholder">
                                Hover or tap a card to preview
                            </div>
                        )}
                    </div>

                    {/* Card grid on the right */}
                    <div className="revealed-deck-cards compact">
                        {deckCards.map((card: any) => {
                            const selectable = isSelectable(card.id);
                            const isPreview = previewCard?.id === card.id;
                            return (
                                <div
                                    key={card.id}
                                    className={`revealed-deck-card-wrapper mini ${selectable ? 'selectable' : ''} ${isPreview ? 'previewing' : ''}`}
                                    onTouchStart={() => handleTouchStart(card)}
                                    onMouseEnter={() => handleMouseEnter(card)}
                                    onClick={() => handleClick(card)}
                                >
                                    <CardComponent
                                        card={card}
                                        isFaceUp={true}
                                        additionalClassName={selectable ? (isPreview ? 'highlight-selectable' : '') : 'dimmed'}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>

                {deckCards.length === 0 && (
                    <p className="no-cards-message">No cards in deck.</p>
                )}
            </div>
        </div>
    );
}
