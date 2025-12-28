/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
    AnimationQueueItem,
    AnimationQueueContextValue,
} from '../types/animation';

// =============================================================================
// CONTEXT CREATION
// =============================================================================

const AnimationQueueContext = createContext<AnimationQueueContextValue | null>(null);

// =============================================================================
// PROVIDER COMPONENT
// =============================================================================

interface AnimationQueueProviderProps {
    children: React.ReactNode;
}

export const AnimationQueueProvider: React.FC<AnimationQueueProviderProps> = ({ children }) => {
    // Queue state
    const [queue, setQueue] = useState<AnimationQueueItem[]>([]);
    const [currentAnimation, setCurrentAnimation] = useState<AnimationQueueItem | null>(null);

    // Ref to track if we're currently processing (prevents race conditions)
    const isProcessingRef = useRef(false);

    // Ref to track currentAnimation for use in callbacks (avoids stale closure)
    const currentAnimationRef = useRef<AnimationQueueItem | null>(null);
    currentAnimationRef.current = currentAnimation;

    // Derived state
    const isAnimating = currentAnimation !== null || queue.length > 0;

    /**
     * Start processing the next animation in the queue.
     * Called when an animation completes or when new animations are added to an empty queue.
     */
    const processNextAnimation = useCallback(() => {
        if (isProcessingRef.current) {
            console.log('[AnimationQueue] processNextAnimation: already processing, skipping');
            return;
        }

        setQueue(currentQueue => {
            console.log('[AnimationQueue] processNextAnimation: queue length =', currentQueue.length);

            if (currentQueue.length === 0) {
                currentAnimationRef.current = null;
                setCurrentAnimation(null);
                console.log('[AnimationQueue] Queue empty, animation complete');
                return currentQueue;
            }

            isProcessingRef.current = true;
            const [next, ...rest] = currentQueue;
            currentAnimationRef.current = next;
            setCurrentAnimation(next);
            isProcessingRef.current = false;

            console.log('[AnimationQueue] Started next animation:', next.type);
            return rest;
        });
    }, []);

    /**
     * Enqueue a single animation.
     */
    const enqueueAnimation = useCallback((item: Omit<AnimationQueueItem, 'id'>) => {
        const newItem: AnimationQueueItem = {
            ...item,
            id: uuidv4(),
        };

        console.log('[AnimationQueue] enqueueAnimation called:', {
            type: newItem.type,
            hasSnapshot: !!newItem.snapshot,
            animatingCard: newItem.animatingCard ? {
                cardId: newItem.animatingCard.card.id,
                from: newItem.animatingCard.fromPosition,
                to: newItem.animatingCard.toPosition
            } : null
        });

        setQueue(currentQueue => {
            // Use ref to get current animation state (avoids stale closure)
            const isCurrentlyAnimating = currentAnimationRef.current !== null;

            console.log('[AnimationQueue] Inside setQueue:', {
                isCurrentlyAnimating,
                queueLength: currentQueue.length
            });

            // If nothing is currently animating, start this animation immediately
            // This ensures currentAnimation is set SYNCHRONOUSLY to avoid flickering
            if (!isCurrentlyAnimating && currentQueue.length === 0) {
                // Update ref immediately so subsequent calls know we're animating
                currentAnimationRef.current = newItem;
                // Set currentAnimation directly - don't add to queue
                setCurrentAnimation(newItem);
                console.log('[AnimationQueue] Started animation immediately:', newItem.type);
                return currentQueue; // Queue stays empty, animation is now current
            }

            // Otherwise, add to queue for later processing
            console.log('[AnimationQueue] Added to queue (already animating)');
            return [...currentQueue, newItem];
        });
    }, []);

    /**
     * Enqueue multiple animations at once.
     * More efficient than calling enqueueAnimation multiple times.
     */
    const enqueueAnimations = useCallback((items: Omit<AnimationQueueItem, 'id'>[]) => {
        if (items.length === 0) return;

        const newItems: AnimationQueueItem[] = items.map(item => ({
            ...item,
            id: uuidv4(),
        }));

        setQueue(currentQueue => {
            // Use ref to get current animation state (avoids stale closure)
            const isCurrentlyAnimating = currentAnimationRef.current !== null;

            // If nothing is currently animating, start the first animation immediately
            // This ensures currentAnimation is set SYNCHRONOUSLY to avoid flickering
            if (!isCurrentlyAnimating && currentQueue.length === 0) {
                const [first, ...rest] = newItems;
                // Update ref immediately so subsequent calls know we're animating
                currentAnimationRef.current = first;
                setCurrentAnimation(first);
                return rest; // Remaining items go to queue
            }

            // Otherwise, add all to queue
            return [...currentQueue, ...newItems];
        });
    }, []);

    /**
     * Called by the animation renderer when the current animation completes.
     */
    const onAnimationComplete = useCallback(() => {
        console.log('[AnimationQueue] onAnimationComplete called, current:', currentAnimationRef.current?.type);

        // Check if we should pause (for user input scenarios)
        if (currentAnimationRef.current?.pauseAfter) {
            currentAnimationRef.current = null;
            setCurrentAnimation(null);
            console.log('[AnimationQueue] Paused after animation');
            // Queue remains - will resume when user completes their input
            return;
        }

        // Process the next animation
        processNextAnimation();
    }, [processNextAnimation]);

    /**
     * Skip the current animation immediately.
     * Useful for debugging or "skip animation" button.
     */
    const skipCurrentAnimation = useCallback(() => {
        processNextAnimation();
    }, [processNextAnimation]);

    /**
     * Skip all animations and clear the queue.
     * The game state is already final, so this just fast-forwards visuals.
     */
    const skipAllAnimations = useCallback(() => {
        setQueue([]);
        setCurrentAnimation(null);
        currentAnimationRef.current = null;
        isProcessingRef.current = false;
    }, []);

    /**
     * Clear the queue without processing.
     * Used when game state is reset or a new game starts.
     */
    const clearQueue = useCallback(() => {
        setQueue([]);
        setCurrentAnimation(null);
        currentAnimationRef.current = null;
        isProcessingRef.current = false;
    }, []);

    // Context value
    const value: AnimationQueueContextValue = {
        queue,
        isAnimating,
        currentAnimation,
        enqueueAnimation,
        enqueueAnimations,
        onAnimationComplete,
        skipCurrentAnimation,
        skipAllAnimations,
        clearQueue,
    };

    return (
        <AnimationQueueContext.Provider value={value}>
            {children}
        </AnimationQueueContext.Provider>
    );
};

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to access the animation queue context.
 * Throws if used outside of AnimationQueueProvider.
 */
export const useAnimationQueue = (): AnimationQueueContextValue => {
    const context = useContext(AnimationQueueContext);

    if (!context) {
        throw new Error('useAnimationQueue must be used within an AnimationQueueProvider');
    }

    return context;
};

/**
 * Hook to check if animations are currently playing.
 * Useful for components that only need the isAnimating state.
 */
export const useIsAnimating = (): boolean => {
    const context = useContext(AnimationQueueContext);
    return context?.isAnimating ?? false;
};
