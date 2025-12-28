/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useMemo, useLayoutEffect } from 'react';
import { AnimationQueueItem, CardPosition } from '../types/animation';
import { ANIMATION_DURATIONS, ANIMATION_EASINGS } from '../constants/animationTiming';
import { CardComponent } from './Card';
import { Player } from '../types';

// Animation timing constants
const HIGHLIGHT_DURATION = 500; // ms - only for opponent animations
const FLY_DURATION = 1000; // ms - 1 second flight time
const DOM_DETECTION_DELAY = 100; // ms - wait for React to render snapshot fully

interface AnimatedCardProps {
    animation: AnimationQueueItem;
    startDelay?: number;  // For staggered multi-card animations
    onComplete?: () => void;
}

/**
 * AnimatedCard - Renders a card with CSS animation.
 *
 * Animation phases:
 * - PLAYER: Just fly (no highlight needed - player knows what they selected)
 * - OPPONENT: Highlight 500ms (red glow) → then fly 1 second
 */
export const AnimatedCard: React.FC<AnimatedCardProps> = ({
    animation,
    startDelay = 0,
    onComplete,
}) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const [animationPhase, setAnimationPhase] = useState<'waiting' | 'idle' | 'highlight' | 'flying' | 'complete'>('waiting');
    const [domPositions, setDomPositions] = useState<{ start: DOMRect | null; end: DOMRect | null }>({ start: null, end: null });
    const onCompleteCalledRef = useRef(false);

    const animatingCard = animation.animatingCard;
    if (!animatingCard) return null;

    const { card, fromPosition, toPosition, flipDirection } = animatingCard;

    // Determine if this is an opponent animation (needs highlight and rotation)
    const isOpponentAnimation = fromPosition.owner === 'opponent';
    const hasHighlightPhase = isOpponentAnimation && animation.type === 'play';

    // Opponent's side is rotated 180° in CSS, so we need to rotate the animated card too
    const needsRotation = isOpponentAnimation;

    // Animation configuration
    const flyDuration = FLY_DURATION;
    const easing = 'ease-in-out';

    // Try to get real DOM positions on mount - BEFORE starting animation
    useLayoutEffect(() => {
        // Wait for DOM to fully render before detecting positions
        const timer = setTimeout(() => {
            const startRect = getDOMPosition(fromPosition);
            const endRect = getDOMPosition(toPosition);

            // Debug: Check if positions are valid and different
            if (startRect && endRect) {
                const dx = Math.abs(startRect.left - endRect.left);
                const dy = Math.abs(startRect.top - endRect.top);
                console.log('[AnimatedCard] Position delta:', { dx, dy, startRect, endRect });
                if (dx < 5 && dy < 5) {
                    console.warn('[AnimatedCard] WARNING: Start and end positions are nearly identical! Animation will appear instant.');
                }
            } else {
                console.warn('[AnimatedCard] Missing position(s):', { hasStart: !!startRect, hasEnd: !!endRect });
            }

            console.log('[AnimatedCard] DOM positions:', { startRect, endRect, fromPosition, toPosition });
            setDomPositions({ start: startRect, end: endRect });

            // NOW we can move from 'waiting' to 'idle' state
            setAnimationPhase('idle');
        }, DOM_DETECTION_DELAY);
        return () => clearTimeout(timer);
    }, [fromPosition, toPosition]);

    // Start animation AFTER DOM positions are detected (not during 'waiting' phase)
    useEffect(() => {
        // Only start animation after we've moved past 'waiting' phase
        if (animationPhase !== 'idle') return;

        // CRITICAL: Wait for the browser to render the element at the start position
        // before starting the transition. Without this, the transition appears instant
        // because the browser hasn't painted the start state yet.
        const startTimer = setTimeout(() => {
            // Use requestAnimationFrame to ensure the start position is painted
            // before we begin transitioning to the end position
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    // Double RAF ensures the browser has actually painted the start position
                    if (hasHighlightPhase) {
                        setAnimationPhase('highlight');
                    } else {
                        setAnimationPhase('flying');
                    }
                });
            });
        }, startDelay);

        return () => clearTimeout(startTimer);
    }, [animationPhase, startDelay, hasHighlightPhase]);

    // Progress through animation phases
    useEffect(() => {
        if (animationPhase === 'highlight') {
            const timer = setTimeout(() => {
                setAnimationPhase('flying');
            }, HIGHLIGHT_DURATION);
            return () => clearTimeout(timer);
        }

        if (animationPhase === 'flying') {
            const timer = setTimeout(() => {
                setAnimationPhase('complete');
                if (!onCompleteCalledRef.current) {
                    onCompleteCalledRef.current = true;
                    onComplete?.();
                }
            }, flyDuration);
            return () => clearTimeout(timer);
        }
    }, [animationPhase, flyDuration, onComplete]);

    // Calculate CSS positions based on CardPosition (with DOM fallback)
    const startStyle = useMemo((): React.CSSProperties => {
        if (domPositions.start) {
            return {
                left: domPositions.start.left,
                top: domPositions.start.top,
                width: domPositions.start.width,
                height: domPositions.start.height,
            };
        }
        // Fallback - but this shouldn't happen
        console.warn('[AnimatedCard] No start DOM position found, using fallback');
        return getPositionStyle(fromPosition);
    }, [fromPosition, domPositions.start]);

    const endStyle = useMemo((): React.CSSProperties => {
        if (domPositions.end) {
            return {
                left: domPositions.end.left,
                top: domPositions.end.top,
                width: domPositions.end.width,
                height: domPositions.end.height,
            };
        }
        // Fallback - but this shouldn't happen
        console.warn('[AnimatedCard] No end DOM position found, using fallback');
        return getPositionStyle(toPosition);
    }, [toPosition, domPositions.end]);

    // Determine which style to apply based on animation phase
    const currentStyle = useMemo((): React.CSSProperties => {
        const baseStyle: React.CSSProperties = {
            position: 'fixed',
            zIndex: 2000,
            pointerEvents: 'none',
            // CRITICAL: Clip overflow and contain the card
            overflow: 'hidden',
            // CRITICAL: Rotate 180° for opponent animations (their side is rotated in CSS)
            transform: needsRotation ? 'rotate(180deg)' : 'none',
        };

        if (animationPhase === 'waiting') {
            // Not ready yet - don't show anything
            return {
                ...baseStyle,
                opacity: 0,
                visibility: 'hidden',
            };
        }

        if (animationPhase === 'idle' || animationPhase === 'highlight') {
            // At start position
            return {
                ...baseStyle,
                ...startStyle,
                transition: 'none',
            };
        } else if (animationPhase === 'flying') {
            // Animating to end position
            return {
                ...baseStyle,
                ...endStyle,
                transition: `left ${flyDuration}ms ${easing}, top ${flyDuration}ms ${easing}, width ${flyDuration}ms ${easing}, height ${flyDuration}ms ${easing}`,
            };
        } else {
            // Complete - at end position
            return {
                ...baseStyle,
                ...endStyle,
                transition: 'none',
                opacity: 0, // Hide when complete
            };
        }
    }, [animationPhase, startStyle, endStyle, flyDuration, easing, needsRotation]);

    // Highlight glow style is now handled by CSS class .is-highlighting
    // No inline styles needed - the class is added in animationClass

    // Additional animation class based on type
    const animationClass = useMemo(() => {
        const classes = ['animated-card', `animation-${animation.type}`];

        if (animationPhase === 'waiting') {
            classes.push('is-waiting');
        }
        if (animationPhase === 'idle') {
            classes.push('is-idle');
        }
        if (animationPhase === 'highlight') {
            classes.push('is-highlighting');
        }
        if (animationPhase === 'flying') {
            classes.push('is-flying');
        }
        if (animationPhase === 'complete') {
            classes.push('is-complete');
        }

        return classes.join(' ');
    }, [animation.type, animationPhase]);

    // Determine if card should show face-up or face-down
    const showFaceUp = useMemo(() => {
        if (flipDirection === 'toFaceUp') {
            return animationPhase === 'flying' || animationPhase === 'complete';
        }
        if (flipDirection === 'toFaceDown') {
            return animationPhase === 'idle' || animationPhase === 'highlight';
        }
        // For play animation, use targetIsFaceUp if provided, otherwise fall back to card.isFaceUp
        // targetIsFaceUp tells us how the card will be displayed at its destination
        if (animatingCard.targetIsFaceUp !== undefined) {
            return animatingCard.targetIsFaceUp;
        }
        return card.isFaceUp;
    }, [flipDirection, animationPhase, card.isFaceUp, animatingCard.targetIsFaceUp]);

    // Don't render until we have positions (during 'waiting' phase, we render but hidden)
    // Once we move to 'idle', we should have positions

    return (
        <div
            ref={cardRef}
            className={animationClass}
            style={currentStyle}
        >
            {/* Render card at actual size (no scaling) - CSS handles sizing via 100% */}
            <div className="animated-card-inner">
                <CardComponent
                    card={card}
                    isFaceUp={showFaceUp}
                />
            </div>
        </div>
    );
};

// =============================================================================
// DOM POSITION HELPERS
// =============================================================================

/**
 * Gets the actual card dimensions from CSS (responsive-aware).
 * Reads computed styles from an existing card or calculates from lane.
 */
function getCardDimensions(): { width: number; height: number; stackOffset: number } {
    // Try to get dimensions from an existing card in a lane
    const existingCard = document.querySelector('.lane-stack .card-component') as HTMLElement;
    if (existingCard) {
        const style = window.getComputedStyle(existingCard);
        const width = parseFloat(style.width) || 100;
        const height = parseFloat(style.height) || 140;
        // Stack offset is the 'top' value divided by the card index
        // We can get it from CSS variable or default to calculated value
        const top = parseFloat(style.top) || 0;
        // Default offset based on screen size
        const screenWidth = window.innerWidth;
        let stackOffset = 64; // default
        if (screenWidth <= 1024) stackOffset = 50; // tablet
        if (screenWidth <= 768) stackOffset = 42; // small tablet
        return { width, height, stackOffset };
    }

    // Fallback: estimate based on screen width
    const screenWidth = window.innerWidth;
    if (screenWidth <= 768) {
        return { width: 70, height: 98, stackOffset: 42 };
    } else if (screenWidth <= 1024) {
        return { width: 85, height: 119, stackOffset: 50 };
    }
    return { width: 100, height: 140, stackOffset: 64 };
}

/**
 * Tries to find the actual DOM element for a card position and get its bounding rect.
 *
 * The GameScreen now renders snapshot data directly when animation is active.
 * So we simply find elements in the real DOM - no snapshot-specific selectors needed.
 *
 * Structure:
 * - .game-screen .game-main-area .game-board
 *   - .opponent-hand-area
 *   - .opponent-side .lanes .lane .lane-stack
 *   - .player-side .lanes .lane .lane-stack
 * - .game-screen .game-main-area .player-action-area .player-hand-area
 */
function getDOMPosition(position: CardPosition): DOMRect | null {
    try {
        if (position.type === 'hand') {
            // Find the hand area in the game screen
            const handArea = position.owner === 'player'
                ? document.querySelector('.game-main-area .player-hand-area')
                : document.querySelector('.game-board .opponent-hand-area');

            if (handArea) {
                const cards = handArea.querySelectorAll('.card-component');
                console.log(`[getDOMPosition] Found ${cards.length} cards in ${position.owner} hand, looking for index ${position.handIndex}`);
                if (cards[position.handIndex]) {
                    const rect = cards[position.handIndex].getBoundingClientRect();
                    console.log(`[getDOMPosition] Hand card ${position.handIndex} rect:`, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
                    return rect;
                } else {
                    console.warn(`[getDOMPosition] Hand card index ${position.handIndex} not found, max index is ${cards.length - 1}`);
                }
            } else {
                console.warn(`[getDOMPosition] Hand area not found for ${position.owner}`);
            }
        }

        if (position.type === 'lane') {
            // Find the lane in the game board
            const gameBoard = document.querySelector('.game-main-area .game-board');
            if (gameBoard) {
                // Use more specific selector to find the correct side
                const side = position.owner === 'player'
                    ? gameBoard.querySelector('.player-side:not(.opponent-side)')
                    : gameBoard.querySelector('.opponent-side');

                console.log(`[getDOMPosition] Looking for ${position.owner} lane ${position.laneIndex}, side found:`, !!side);

                if (side) {
                    // Get all lanes (each Lane component has a .lane wrapper containing .lane-stack)
                    const laneContainers = side.querySelectorAll('.lane');
                    const lanes = side.querySelectorAll('.lane-stack');
                    console.log(`[getDOMPosition] Found ${lanes.length} lane-stacks, ${laneContainers.length} lane containers`);

                    if (lanes[position.laneIndex]) {
                        const lane = lanes[position.laneIndex] as HTMLElement;
                        const cards = lane.querySelectorAll('.card-component');
                        console.log(`[getDOMPosition] Lane ${position.laneIndex} found with ${cards.length} cards, looking for cardIndex ${position.cardIndex}`);

                        if (cards[position.cardIndex]) {
                            const rect = cards[position.cardIndex].getBoundingClientRect();
                            console.log(`[getDOMPosition] Lane card ${position.cardIndex} rect:`, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
                            return rect;
                        }

                        // Card doesn't exist yet - calculate position based on existing cards or lane
                        const dims = getCardDimensions();
                        const laneRect = lane.getBoundingClientRect();
                        const centerX = laneRect.left + (laneRect.width - dims.width) / 2;

                        // If there are existing cards, use the last one as reference
                        if (cards.length > 0) {
                            const lastCard = cards[cards.length - 1];
                            const lastCardRect = lastCard.getBoundingClientRect();

                            // For opponent lanes (rotated 180°), cards stack UPWARD in viewport
                            // For player lanes, cards stack DOWNWARD in viewport
                            const isOpponent = position.owner === 'opponent';
                            const offsetDirection = isOpponent ? -1 : 1;
                            const newTop = lastCardRect.top + (offsetDirection * dims.stackOffset);

                            const calculatedRect = new DOMRect(centerX, newTop, dims.width, dims.height);
                            console.log(`[getDOMPosition] Calculated from last card:`, {
                                lastCardTop: lastCardRect.top,
                                newTop,
                                isOpponent,
                                offsetDirection
                            });
                            return calculatedRect;
                        }

                        // No existing cards - use lane position
                        // For opponent lanes (rotated), the first card appears at the BOTTOM of the lane rect
                        // For player lanes, the first card appears at the TOP of the lane rect
                        const isOpponent = position.owner === 'opponent';
                        let calculatedTop: number;

                        if (isOpponent) {
                            // Opponent lane is rotated 180° - first card at bottom of viewport rect
                            calculatedTop = laneRect.bottom - dims.height;
                        } else {
                            // Player lane - first card at top
                            calculatedTop = laneRect.top;
                        }

                        const calculatedRect = new DOMRect(centerX, calculatedTop, dims.width, dims.height);
                        console.log(`[getDOMPosition] Calculated lane position (empty lane):`, {
                            laneRect: { left: laneRect.left, top: laneRect.top, bottom: laneRect.bottom },
                            calculated: { left: calculatedRect.left, top: calculatedRect.top },
                            isOpponent
                        });
                        return calculatedRect;
                    } else {
                        console.warn(`[getDOMPosition] Lane index ${position.laneIndex} not found, max index is ${lanes.length - 1}`);
                    }
                } else {
                    console.warn(`[getDOMPosition] Player side not found in game-board`);
                }
            } else {
                console.warn(`[getDOMPosition] Game board not found`);
            }
        }

        if (position.type === 'deck') {
            // Deck area in GameInfoPanel
            const realDeck = document.querySelector('.deck-area');
            if (realDeck) {
                return realDeck.getBoundingClientRect();
            }
        }

        if (position.type === 'trash') {
            // Trash area
            const realTrash = document.querySelector('.trash-area');
            if (realTrash) {
                return realTrash.getBoundingClientRect();
            }
        }
    } catch (e) {
        console.warn('[AnimatedCard] Could not get DOM position:', e);
    }

    console.warn(`[getDOMPosition] Could not find element for position:`, position);
    return null;
}

// =============================================================================
// FALLBACK POSITION CALCULATION
// =============================================================================

/**
 * Converts a CardPosition to CSS positioning styles.
 * Used as fallback when DOM positions aren't available.
 */
function getPositionStyle(position: CardPosition): React.CSSProperties {
    const CARD_WIDTH = 100;
    const CARD_HEIGHT = 140;
    const LANE_GAP = 20;
    const CARD_STACK_OFFSET = 64;
    const BOARD_WIDTH = window.innerWidth;
    const BOARD_HEIGHT = window.innerHeight;

    const getLaneX = (laneIndex: number) => {
        const totalLanesWidth = 3 * CARD_WIDTH + 2 * LANE_GAP;
        const startX = (BOARD_WIDTH - totalLanesWidth) / 2;
        return startX + laneIndex * (CARD_WIDTH + LANE_GAP);
    };

    switch (position.type) {
        case 'lane': {
            const x = getLaneX(position.laneIndex);
            const isOpponent = position.owner === 'opponent';
            const baseY = isOpponent
                ? BOARD_HEIGHT * 0.15
                : BOARD_HEIGHT * 0.45;
            const y = baseY + position.cardIndex * CARD_STACK_OFFSET;

            return { left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT };
        }

        case 'hand': {
            const isOpponent = position.owner === 'opponent';
            const handWidth = 6 * (CARD_WIDTH * 0.7);
            const startX = (BOARD_WIDTH - handWidth) / 2;
            const x = startX + position.handIndex * (CARD_WIDTH * 0.7);
            const y = isOpponent ? 20 : BOARD_HEIGHT - CARD_HEIGHT - 80;

            return { left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT };
        }

        case 'deck': {
            const isOpponent = position.owner === 'opponent';
            return {
                left: BOARD_WIDTH - CARD_WIDTH - 40,
                top: isOpponent ? 20 : BOARD_HEIGHT - CARD_HEIGHT - 80,
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
            };
        }

        case 'trash': {
            const isOpponent = position.owner === 'opponent';
            return {
                left: 40,
                top: isOpponent ? 20 : BOARD_HEIGHT - CARD_HEIGHT - 80,
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
                opacity: 0,
                transform: 'scale(0.8)',
            };
        }

        case 'offscreen': {
            return {
                left: BOARD_WIDTH / 2 - CARD_WIDTH / 2,
                top: -CARD_HEIGHT - 20,
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
                opacity: 0,
            };
        }

        default:
            return {
                left: BOARD_WIDTH / 2 - CARD_WIDTH / 2,
                top: BOARD_HEIGHT / 2 - CARD_HEIGHT / 2,
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
            };
    }
}
