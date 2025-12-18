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
    onConfirmProtocolDraw?: () => void;
}

/**
 * Modal for selecting a card from a revealed deck (Clarity-2/3)
 * Also supports reveal_deck_draw_protocol (Unity-4) where all matching cards are auto-highlighted
 * Uses same layout pattern as DebugModal for consistency
 */
export function RevealedDeckModal({ gameState, onSelectCard, onConfirmProtocolDraw }: RevealedDeckModalProps) {
    // Selected card (permanent, set by click/touch)
    const [selectedCard, setSelectedCard] = useState<any>(null);
    // Hovered card (temporary, set by hover - ignored on touch devices)
    const [hoveredCard, setHoveredCard] = useState<any>(null);
    const hasInitialized = useRef(false);

    // Preview shows hovered card if any, otherwise selected card
    const previewCard = hoveredCard || selectedCard;

    const action = gameState.actionRequired as any;
    const isProtocolDrawMode = action?.type === 'reveal_deck_draw_protocol';

    // Create card objects with IDs for display (before early return so we can use them in useEffect)
    const revealedCards = action?.revealedCards;
    const selectableCardIds = action?.selectableCardIds;
    const autoSelectedIndices = action?.autoSelectedIndices || [];
    const targetProtocol = action?.targetProtocol;
    const deck = revealedCards || (action?.actor ? gameState[action.actor]?.deck : []) || [];

    // Memoize deckCards to prevent infinite re-renders
    const deckCards = useMemo(() => deck.map((card: any, index: number) => ({
        ...card,
        id: card.id || `deck-${index}`,
        deckIndex: index,
        isFaceUp: true, // Show all cards face-up
    })), [deck]);

    // For protocol draw mode, get the matching cards
    const matchingCards = useMemo(() => {
        if (isProtocolDrawMode) {
            return deckCards.filter((_: any, idx: number) => autoSelectedIndices.includes(idx));
        }
        return [];
    }, [isProtocolDrawMode, deckCards, autoSelectedIndices]);

    // Auto-select first valid card on mount (for select_card_from_revealed_deck mode)
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
        if (!action || (action.type !== 'select_card_from_revealed_deck' && action.type !== 'reveal_deck_draw_protocol')) {
            hasInitialized.current = false;
            setSelectedCard(null);
            setHoveredCard(null);
        }
    }, [action]);

    if (!action || (action.type !== 'select_card_from_revealed_deck' && action.type !== 'reveal_deck_draw_protocol')) {
        return null;
    }

    const { valueFilter } = action;

    const isSelectable = (cardId: string) => {
        if (isProtocolDrawMode) return false; // No individual selection in protocol draw mode
        return selectableCardIds?.includes(cardId);
    };

    const isAutoSelected = (deckIndex: number) => {
        return isProtocolDrawMode && autoSelectedIndices.includes(deckIndex);
    };

    const handleCardHover = (card: any) => {
        if (isProtocolDrawMode) {
            // In protocol draw mode, allow hovering any card for preview
            setHoveredCard(card);
        } else if (isSelectable(card.id)) {
            setHoveredCard(card);
        }
    };

    const handleCardLeave = () => {
        setHoveredCard(null);
    };

    const handleCardClick = (card: any) => {
        if (!isProtocolDrawMode && isSelectable(card.id)) {
            setSelectedCard(card);
        }
    };

    const handleConfirmSelection = () => {
        if (isProtocolDrawMode) {
            onConfirmProtocolDraw?.();
        } else if (previewCard && isSelectable(previewCard.id)) {
            onSelectCard(previewCard.id);
        }
    };

    // Determine title and description based on mode
    const title = isProtocolDrawMode ? 'Revealed Deck' : 'Your Revealed Deck';
    const description = isProtocolDrawMode
        ? `All ${targetProtocol} cards will be drawn (${matchingCards.length} found):`
        : `Select a card with value ${valueFilter} to draw:`;

    const confirmButtonText = isProtocolDrawMode
        ? matchingCards.length > 0
            ? `Draw ${matchingCards.length} ${targetProtocol} card${matchingCards.length !== 1 ? 's' : ''}`
            : 'Confirm (no matching cards)'
        : previewCard
            ? `Draw ${previewCard.protocol}-${previewCard.value}`
            : 'Select a card';

    return (
        <div className="modal-overlay">
            <div className="modal-content revealed-deck-modal" onClick={(e) => e.stopPropagation()}>
                <h2>{title}</h2>
                <p>{description}</p>

                <div className="revealed-deck-content-wrapper">
                    {/* Left preview area - same as DebugModal */}
                    <div className="revealed-deck-preview-area">
                        {isProtocolDrawMode ? (
                            // Protocol draw mode: show confirm button without card preview
                            <div className="revealed-deck-preview-card">
                                {previewCard && (
                                    <CardComponent
                                        card={previewCard}
                                        isFaceUp={true}
                                    />
                                )}
                                <button
                                    className="btn preview-confirm-btn"
                                    onClick={handleConfirmSelection}
                                >
                                    {confirmButtonText}
                                </button>
                            </div>
                        ) : (
                            // Selection mode: show selected card and confirm button
                            previewCard && (
                                <div className="revealed-deck-preview-card">
                                    <CardComponent
                                        card={previewCard}
                                        isFaceUp={true}
                                    />
                                    <button
                                        className="btn preview-confirm-btn"
                                        onClick={handleConfirmSelection}
                                    >
                                        {confirmButtonText}
                                    </button>
                                </div>
                            )
                        )}
                    </div>

                    {/* Card grid - same pattern as DebugModal */}
                    <div className="revealed-deck-grids-area">
                        <div className="revealed-deck-card-grid">
                            {deckCards.length > 0 ? (
                                deckCards.map((card: any) => {
                                    const selectable = isSelectable(card.id);
                                    const autoSelected = isAutoSelected(card.deckIndex);
                                    const isSelected = selectedCard?.id === card.id;
                                    const isHovered = hoveredCard?.id === card.id;
                                    const isPreview = isHovered || isSelected;
                                    const highlighted = autoSelected || (selectable && isPreview);
                                    const dimmed = isProtocolDrawMode ? !autoSelected : !selectable;
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
                                                additionalClassName={`in-hand ${highlighted ? 'highlight-selectable' : ''} ${dimmed ? 'dimmed' : ''} ${isSelected || autoSelected ? 'selected-card' : ''}`}
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
