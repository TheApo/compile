/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { GameState } from '../types';
import { CardComponent } from './Card';

interface RevealedDeckModalProps {
    gameState: GameState;
    onSelectCard: (cardId: string) => void;
}

/**
 * Modal for selecting a card from a revealed deck (Clarity-2/3)
 * Uses same layout pattern as DebugModal for consistency
 */
export function RevealedDeckModal({ gameState, onSelectCard }: RevealedDeckModalProps) {
    const [previewCard, setPreviewCard] = useState<any>(null);
    const hasInitialized = useRef(false);

    const action = gameState.actionRequired as any;

    // Create card objects with IDs for display (before early return so we can use them in useEffect)
    const revealedCards = action?.revealedCards;
    const selectableCardIds = action?.selectableCardIds;
    const deck = revealedCards || (action?.actor ? gameState[action.actor]?.deck : []) || [];

    // Memoize deckCards to prevent infinite re-renders
    const deckCards = useMemo(() => deck.map((card: any, index: number) => ({
        ...card,
        id: card.id || `deck-${index}`,
        isFaceUp: true, // Show all cards face-up
    })), [deck]);

    // Auto-select first valid card on mount
    useEffect(() => {
        if (action?.type === 'select_card_from_revealed_deck' && selectableCardIds?.length > 0 && !hasInitialized.current) {
            const firstSelectableCard = deckCards.find((card: any) => selectableCardIds.includes(card.id));
            if (firstSelectableCard) {
                setPreviewCard(firstSelectableCard);
                hasInitialized.current = true;
            }
        }
    }, [action?.type, selectableCardIds, deckCards]);

    // Reset initialization when modal closes
    useEffect(() => {
        if (!action || action.type !== 'select_card_from_revealed_deck') {
            hasInitialized.current = false;
            setPreviewCard(null);
        }
    }, [action]);

    if (!action || action.type !== 'select_card_from_revealed_deck') {
        return null;
    }

    const { valueFilter } = action;

    const isSelectable = (cardId: string) => {
        return selectableCardIds?.includes(cardId);
    };

    const handleCardHover = (card: any) => {
        if (isSelectable(card.id)) {
            setPreviewCard(card);
        }
    };

    const handleCardClick = (card: any) => {
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

                <div className="revealed-deck-content-wrapper">
                    {/* Left preview area - same as DebugModal */}
                    <div className="revealed-deck-preview-area">
                        {previewCard && (
                            <div className="revealed-deck-preview-card">
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
                            </div>
                        )}
                    </div>

                    {/* Card grid - same pattern as DebugModal */}
                    <div className="revealed-deck-grids-area">
                        <div className="revealed-deck-card-grid">
                            {deckCards.length > 0 ? (
                                deckCards.map((card: any) => {
                                    const selectable = isSelectable(card.id);
                                    const isPreview = previewCard?.id === card.id;
                                    return (
                                        <div
                                            key={card.id}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleCardClick(card);
                                            }}
                                            onMouseEnter={() => handleCardHover(card)}
                                            style={{ cursor: selectable ? 'pointer' : 'default' }}
                                        >
                                            <CardComponent
                                                card={card}
                                                isFaceUp={true}
                                                additionalClassName={`in-hand ${selectable ? (isPreview ? 'highlight-selectable' : '') : 'dimmed'}`}
                                            />
                                        </div>
                                    );
                                })
                            ) : (
                                <p className="no-cards">No cards in deck.</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
