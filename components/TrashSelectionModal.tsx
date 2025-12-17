/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { GameState, PlayedCard } from '../types';
import { CardComponent } from './Card';

interface TrashSelectionModalProps {
    gameState: GameState;
    onSelectCard: (cardIndex: number) => void;
}

/**
 * Modal for selecting a card from trash/discard pile (Time-0, Time-3)
 * Uses same layout pattern as RevealedDeckModal for consistency
 */
export function TrashSelectionModal({ gameState, onSelectCard }: TrashSelectionModalProps) {
    const [previewCard, setPreviewCard] = useState<any>(null);
    const [previewIndex, setPreviewIndex] = useState<number | null>(null);
    const hasInitialized = useRef(false);

    const action = gameState.actionRequired as any;

    // Get trash cards based on trashOwner (own/opponent/any)
    const actor = action?.actor;
    const trashOwner = action?.trashOwner || 'own';

    let trash: PlayedCard[] = [];
    if (trashOwner === 'own') {
        trash = actor ? gameState[actor]?.discard || [] : [];
    } else if (trashOwner === 'opponent') {
        const opponent = actor === 'player' ? 'opponent' : 'player';
        trash = gameState[opponent]?.discard || [];
    } else if (trashOwner === 'any') {
        // Combine both players' trash
        trash = [
            ...(gameState.player?.discard || []),
            ...(gameState.opponent?.discard || [])
        ];
    }

    // Memoize trashCards to prevent infinite re-renders
    const trashCards = useMemo(() => (trash || []).map((card: PlayedCard, index: number) => ({
        ...card,
        id: card.id || `trash-${index}`,
        isFaceUp: true, // Show all cards face-up
        _trashIndex: index, // Store original index for selection
    })), [trash]);

    // Auto-select first card on mount
    useEffect(() => {
        const isTrashAction = action?.type === 'select_card_from_trash_to_play' ||
                              action?.type === 'select_card_from_trash_to_reveal';

        if (isTrashAction && trashCards.length > 0 && !hasInitialized.current) {
            setPreviewCard(trashCards[0]);
            setPreviewIndex(0);
            hasInitialized.current = true;
        }
    }, [action?.type, trashCards]);

    // Reset initialization when modal closes
    useEffect(() => {
        const isTrashAction = action?.type === 'select_card_from_trash_to_play' ||
                              action?.type === 'select_card_from_trash_to_reveal';

        if (!action || !isTrashAction) {
            hasInitialized.current = false;
            setPreviewCard(null);
            setPreviewIndex(null);
        }
    }, [action]);

    const isTrashAction = action?.type === 'select_card_from_trash_to_play' ||
                          action?.type === 'select_card_from_trash_to_reveal';

    if (!action || !isTrashAction) {
        return null;
    }

    const isPlayAction = action.type === 'select_card_from_trash_to_play';
    const title = isPlayAction ? 'Select Card to Play' : 'Select Card to Reveal';
    const ownerText = trashOwner === 'opponent' ? "opponent's" :
                      trashOwner === 'any' ? "any player's" : 'your';
    const description = isPlayAction
        ? `Select a card from ${ownerText} trash to play:`
        : `Select a card from ${ownerText} trash to reveal:`;

    const handleCardHover = (card: any, index: number) => {
        setPreviewCard(card);
        setPreviewIndex(index);
    };

    const handleCardClick = (card: any, index: number) => {
        setPreviewCard(card);
        setPreviewIndex(index);
    };

    const handleConfirmSelection = () => {
        if (previewCard && previewIndex !== null) {
            onSelectCard(previewIndex);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content revealed-deck-modal" onClick={(e) => e.stopPropagation()}>
                <h2>{title}</h2>
                <p>{description}</p>

                <div className="revealed-deck-content-wrapper">
                    {/* Left preview area - same as RevealedDeckModal */}
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
                                    {isPlayAction ? 'Play' : 'Reveal'} {previewCard.protocol}-{previewCard.value}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Card grid - same pattern as RevealedDeckModal */}
                    <div className="revealed-deck-grids-area">
                        <div className="revealed-deck-card-grid">
                            {trashCards.length > 0 ? (
                                trashCards.map((card: any, index: number) => {
                                    const isPreview = previewIndex === index;
                                    return (
                                        <div
                                            key={card.id}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleCardClick(card, index);
                                            }}
                                            onMouseEnter={() => handleCardHover(card, index)}
                                            style={{ cursor: 'pointer' }}
                                        >
                                            <CardComponent
                                                card={card}
                                                isFaceUp={true}
                                                additionalClassName={`in-hand ${isPreview ? 'highlight-selectable' : ''}`}
                                            />
                                        </div>
                                    );
                                })
                            ) : (
                                <p className="no-cards">No cards in trash.</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
