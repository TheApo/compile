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
    // Selected card (permanent, set by click/touch)
    const [selectedCard, setSelectedCard] = useState<any>(null);
    // Hovered card (temporary, set by hover - ignored on touch devices)
    const [hoveredCard, setHoveredCard] = useState<any>(null);
    const hasInitialized = useRef(false);

    // Preview shows hovered card if any, otherwise selected card
    const previewCard = hoveredCard || selectedCard;

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
                setSelectedCard(firstSelectableCard);
                hasInitialized.current = true;
            }
        }
    }, [action?.type, selectableCardIds, deckCards]);

    // Reset initialization when modal closes
    useEffect(() => {
        if (!action || action.type !== 'select_card_from_revealed_deck') {
            hasInitialized.current = false;
            setSelectedCard(null);
            setHoveredCard(null);
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
            setHoveredCard(card);
        }
    };

    const handleCardLeave = () => {
        setHoveredCard(null);
    };

    const handleCardClick = (card: any) => {
        if (isSelectable(card.id)) {
            setSelectedCard(card);
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
                                    const isSelected = selectedCard?.id === card.id;
                                    const isHovered = hoveredCard?.id === card.id;
                                    const isPreview = isHovered || isSelected;
                                    return (
                                        <div
                                            key={card.id}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleCardClick(card);
                                            }}
                                            onMouseEnter={() => handleCardHover(card)}
                                            onMouseLeave={handleCardLeave}
                                            style={{ cursor: selectable ? 'pointer' : 'default' }}
                                        >
                                            <CardComponent
                                                card={card}
                                                isFaceUp={true}
                                                additionalClassName={`in-hand ${selectable ? (isPreview ? 'highlight-selectable' : '') : 'dimmed'} ${isSelected ? 'selected-card' : ''}`}
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
