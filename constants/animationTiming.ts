/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnimationType } from '../types/animation';

// =============================================================================
// ANIMATION DURATIONS
// =============================================================================

/**
 * Default animation durations in milliseconds.
 * These values are used by the animation system to:
 * 1. Set CSS animation/transition durations
 * 2. Set fallback timeouts for animation completion detection
 */
export const ANIMATION_DURATIONS: Record<AnimationType, number> = {
    play: 1000,     // Card moves from hand/deck to lane
    delete: 1000,   // Card moves to trash (with fade/shrink)
    flip: 500,      // Card rotates to reveal other side
    shift: 1000,    // Card moves between lanes
    return: 1000,   // Card returns from board to hand
    discard: 800,   // Card moves from hand to trash
    draw: 1200,     // Single card draw (or total for multi-card)
    compile: 1200,  // Protocol glow + multiple card deletions
    give: 800,      // Card moves to opponent's hand
    reveal: 800,    // Card flips up briefly, then back
    swap: 600,      // Protocol bars swap positions
    refresh: 1200,  // Hand refill (multiple draws)
} as const;

// =============================================================================
// STAGGER DELAYS
// =============================================================================

/**
 * Delay between cards in multi-card animations.
 * Creates a "cascade" effect that's easier to follow visually.
 */
export const STAGGER_DELAY = 75; // ms between cards

/**
 * Delay between cards during compile animation.
 * Slightly longer than normal stagger for dramatic effect.
 */
export const COMPILE_STAGGER_DELAY = 100; // ms between cards

/**
 * Total duration for all draw animations combined.
 * All cards should finish drawing within this time regardless of count.
 * Change this value to adjust multi-card draw speed.
 */
export const TOTAL_DRAW_ANIMATION_DURATION = 1200; // ms

/**
 * Calculates duration per card for draw animation.
 * Goal: All cards finish in TOTAL_DRAW_ANIMATION_DURATION ms.
 *
 * @param cardCount - Number of cards being drawn
 * @returns Duration per card in milliseconds
 */
export function calculateDrawDuration(cardCount: number): number {
    if (cardCount <= 0) return 0;
    if (cardCount === 1) return TOTAL_DRAW_ANIMATION_DURATION;
    return Math.floor(TOTAL_DRAW_ANIMATION_DURATION / cardCount);
}

/**
 * Calculates stagger delay for a specific card in draw animation.
 * Each card starts at a different time to create cascade effect.
 *
 * @param cardIndex - Index of the card (0-based)
 * @param cardCount - Total number of cards being drawn
 * @returns Start delay in milliseconds
 */
export function calculateDrawStagger(cardIndex: number, cardCount: number): number {
    if (cardCount <= 1) return 0;
    return Math.floor(cardIndex * (TOTAL_DRAW_ANIMATION_DURATION / cardCount));
}

// =============================================================================
// TIMING HELPERS
// =============================================================================

/**
 * Calculates total duration for a multi-card animation.
 *
 * @param cardCount - Number of cards being animated
 * @param singleDuration - Duration of a single card animation
 * @param staggerDelay - Delay between cards (default: STAGGER_DELAY)
 * @returns Total duration in milliseconds
 */
export function calculateMultiCardDuration(
    cardCount: number,
    singleDuration: number,
    staggerDelay: number = STAGGER_DELAY
): number {
    if (cardCount <= 0) return 0;
    if (cardCount === 1) return singleDuration;

    // Total = (n-1) * stagger + single duration
    // First card starts at 0, last card starts at (n-1)*stagger, finishes at (n-1)*stagger + duration
    return (cardCount - 1) * staggerDelay + singleDuration;
}

/**
 * Gets the start delay for a specific card in a multi-card animation.
 *
 * @param cardIndex - Index of the card (0-based)
 * @param staggerDelay - Delay between cards (default: STAGGER_DELAY)
 * @returns Start delay in milliseconds
 */
export function getCardStartDelay(
    cardIndex: number,
    staggerDelay: number = STAGGER_DELAY
): number {
    return cardIndex * staggerDelay;
}

// =============================================================================
// CSS VARIABLE HELPERS
// =============================================================================

/**
 * Gets animation duration as a CSS value string.
 *
 * @param type - The animation type
 * @returns Duration as CSS string (e.g., "400ms")
 */
export function getAnimationDurationCSS(type: AnimationType): string {
    return `${ANIMATION_DURATIONS[type]}ms`;
}

/**
 * Gets stagger delay as a CSS value string.
 *
 * @param index - Card index for stagger calculation
 * @returns Delay as CSS string (e.g., "75ms")
 */
export function getStaggerDelayCSS(index: number): string {
    return `${getCardStartDelay(index)}ms`;
}

// =============================================================================
// ANIMATION TIMING CONSTANTS FOR CSS
// =============================================================================

/**
 * CSS easing functions for different animation types.
 */
export const ANIMATION_EASINGS = {
    play: 'ease-out',
    delete: 'ease-in',
    flip: 'ease-in-out',
    shift: 'ease-in-out',
    return: 'ease-out',
    discard: 'ease-in',
    draw: 'ease-out',
    compile: 'ease-in-out',
    give: 'ease-in-out',
    reveal: 'ease-in-out',
    swap: 'ease-in-out',
    refresh: 'ease-out',
} as const;

/**
 * Buffer time added to animation duration for fallback timeouts.
 * Ensures onAnimationEnd event has time to fire before fallback triggers.
 */
export const ANIMATION_TIMEOUT_BUFFER = 50; // ms

/**
 * Gets the fallback timeout duration for animation completion detection.
 *
 * @param type - The animation type
 * @returns Timeout duration in milliseconds
 */
export function getAnimationTimeout(type: AnimationType): number {
    return ANIMATION_DURATIONS[type] + ANIMATION_TIMEOUT_BUFFER;
}
