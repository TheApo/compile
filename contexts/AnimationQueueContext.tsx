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

    // CRITICAL: Synchronous refs for animation state - set IMMEDIATELY when animation enqueued
    // This prevents race conditions where gameState renders before isAnimating updates
    const isAnimatingRef = useRef(false);
    const pendingAnimationRef = useRef<AnimationQueueItem | null>(null);

    // Derived state (for React re-renders)
    const isAnimating = currentAnimation !== null || queue.length > 0;

    // NOTE: We intentionally do NOT clear isAnimatingRef in the render body!
    // Clearing it here causes race conditions where the ref is set to false
    // during animation transitions (between animation A completing and B starting).
    // The ref is cleared in clearQueue() and skipAllAnimations() only.

    /**
     * Start processing the next animation in the queue.
     * Called when an animation completes or when new animations are added to an empty queue.
     */
    const processNextAnimation = useCallback(() => {
        if (isProcessingRef.current) {
            return;
        }

        setQueue(currentQueue => {
            if (currentQueue.length === 0) {
                // Queue is empty - truly done animating
                currentAnimationRef.current = null;
                pendingAnimationRef.current = null;
                isAnimatingRef.current = false;  // NOW we can safely set to false
                setCurrentAnimation(null);
                return currentQueue;
            }

            isProcessingRef.current = true;
            const [next, ...rest] = currentQueue;
            currentAnimationRef.current = next;
            pendingAnimationRef.current = null;  // Clear pending, it's now current
            setCurrentAnimation(next);
            isProcessingRef.current = false;

            return rest;
        });
    }, []);

    /**
     * Enqueue a single animation.
     * Uses queueMicrotask to avoid "Cannot update component while rendering" React error.
     */
    const enqueueAnimation = useCallback((item: Omit<AnimationQueueItem, 'id'>) => {
        const newItem: AnimationQueueItem = {
            ...item,
            id: uuidv4(),
        };

        // CRITICAL: Set refs SYNCHRONOUSLY before async state update
        // This ensures animation state is available immediately for visualGameState
        isAnimatingRef.current = true;
        if (!pendingAnimationRef.current && !currentAnimationRef.current) {
            pendingAnimationRef.current = newItem;
        }

        // Defer state update to avoid "Cannot update component while rendering" error
        queueMicrotask(() => {
            setQueue(currentQueue => {
                const isCurrentlyAnimating = currentAnimationRef.current !== null;

                if (!isCurrentlyAnimating && currentQueue.length === 0) {
                    currentAnimationRef.current = newItem;
                    pendingAnimationRef.current = null; // Clear pending, it's now current
                    setCurrentAnimation(newItem);
                    return currentQueue;
                }

                return [...currentQueue, newItem];
            });
        });
    }, []);

    /**
     * Enqueue multiple animations at once.
     * More efficient than calling enqueueAnimation multiple times.
     * Uses queueMicrotask to avoid "Cannot update component while rendering" React error.
     */
    const enqueueAnimations = useCallback((items: Omit<AnimationQueueItem, 'id'>[]) => {
        if (items.length === 0) return;

        // CRITICAL: Set ref SYNCHRONOUSLY before async state update
        isAnimatingRef.current = true;

        const newItems: AnimationQueueItem[] = items.map(item => ({
            ...item,
            id: uuidv4(),
        }));

        // Set pending animation ref for the first item
        if (!pendingAnimationRef.current && !currentAnimationRef.current && newItems.length > 0) {
            pendingAnimationRef.current = newItems[0];
        }

        // Defer state update to avoid "Cannot update component while rendering" error
        queueMicrotask(() => {
            setQueue(currentQueue => {
                // Use ref to get current animation state (avoids stale closure)
                const isCurrentlyAnimating = currentAnimationRef.current !== null;

                // If nothing is currently animating, start the first animation immediately
                // This ensures currentAnimation is set SYNCHRONOUSLY to avoid flickering
                if (!isCurrentlyAnimating && currentQueue.length === 0) {
                    const [first, ...rest] = newItems;
                    // Update ref immediately so subsequent calls know we're animating
                    currentAnimationRef.current = first;
                    pendingAnimationRef.current = null;  // Clear pending, it's now current
                    setCurrentAnimation(first);
                    return rest; // Remaining items go to queue
                }

                // Otherwise, add all to queue
                return [...currentQueue, ...newItems];
            });
        });
    }, []);

    /**
     * Called by the animation renderer when the current animation completes.
     */
    const onAnimationComplete = useCallback(() => {
        if (currentAnimationRef.current?.pauseAfter) {
            // Pausing - but still "animating" until resumed
            currentAnimationRef.current = null;
            pendingAnimationRef.current = null;
            // NOTE: Don't set isAnimatingRef to false - we're paused, not done
            setCurrentAnimation(null);
            return;
        }

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
        pendingAnimationRef.current = null;
        isAnimatingRef.current = false;
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
        isAnimatingRef.current = false;
    }, []);

    /**
     * Synchronous check for animation state.
     * Use this when you need to check animation state without waiting for React render.
     * This prevents race conditions where gameState renders before isAnimating updates.
     */
    const getIsAnimatingSync = useCallback(() => {
        return isAnimatingRef.current;
    }, []);

    /**
     * Get the pending or current animation synchronously.
     * Used by visualGameState to get snapshot before async state update completes.
     */
    const getAnimationSync = useCallback(() => {
        return pendingAnimationRef.current || currentAnimationRef.current;
    }, []);

    // Context value
    const value: AnimationQueueContextValue = {
        queue,
        isAnimating,
        currentAnimation,
        enqueueAnimation,
        enqueueAnimations,
        onAnimationComplete,
        getIsAnimatingSync,
        getAnimationSync,
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
