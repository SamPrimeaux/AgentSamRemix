import React, { useState, useRef, useEffect, useCallback } from 'react';

interface UseSwipeNavigationOptions {
  onBack: () => void;
  onForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  threshold?: number;
}

export interface SwipeNavigationState {
  isSwiping: boolean;
  direction: 'back' | 'forward' | null;
  progress: number; // 0 to 1
  isThresholdReached: boolean;
  deltaX: number;
}

export function useSwipeNavigation({
  onBack,
  onForward,
  canGoBack,
  canGoForward,
  threshold = 65,
}: UseSwipeNavigationOptions) {
  const [swipeState, setSwipeState] = useState<SwipeNavigationState>({
    isSwiping: false,
    direction: null,
    progress: 0,
    isThresholdReached: false,
    deltaX: 0,
  });

  const touchStartRef = useRef<{ x: number; y: number; time: number; valid: boolean } | null>(null);
  const swipeStateRef = useRef<SwipeNavigationState>(swipeState);
  swipeStateRef.current = swipeState;

  const canGoBackRef = useRef(canGoBack);
  canGoBackRef.current = canGoBack;
  const canGoForwardRef = useRef(canGoForward);
  canGoForwardRef.current = canGoForward;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const onForwardRef = useRef(onForward);
  onForwardRef.current = onForward;

  const handleStart = useCallback((clientX: number, clientY: number) => {
    touchStartRef.current = {
      x: clientX,
      y: clientY,
      time: Date.now(),
      valid: true,
    };
  }, []);

  const handleMove = useCallback((clientX: number, clientY: number) => {
    if (!touchStartRef.current || !touchStartRef.current.valid) return;

    const deltaX = clientX - touchStartRef.current.x;
    const deltaY = clientY - touchStartRef.current.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // If vertical scrolling is dominant early on, cancel gesture
    if (absY > 30 && absY > absX * 1.3 && absX < 25) {
      touchStartRef.current.valid = false;
      if (swipeStateRef.current.isSwiping) {
        setSwipeState({
          isSwiping: false,
          direction: null,
          progress: 0,
          isThresholdReached: false,
          deltaX: 0,
        });
      }
      return;
    }

    // Determine direction and whether navigation is possible
    if (absX > 15 && absX > absY * 0.9) {
      const isBackSwipe = deltaX > 0;
      const isForwardSwipe = deltaX < 0;
      const direction = isBackSwipe ? 'back' : 'forward';

      const isAllowed = (isBackSwipe && canGoBackRef.current) || (isForwardSwipe && canGoForwardRef.current);

      if (isAllowed) {
        const progress = Math.min(1, absX / threshold);
        const isThresholdReached = absX >= threshold;

        setSwipeState({
          isSwiping: true,
          direction,
          progress,
          isThresholdReached,
          deltaX,
        });
      } else {
        // If not allowed to go that direction, show subtle drag resistance
        const progress = Math.min(0.3, (absX / threshold) * 0.3);
        setSwipeState({
          isSwiping: true,
          direction,
          progress,
          isThresholdReached: false,
          deltaX: deltaX * 0.3,
        });
      }
    }
  }, [threshold]);

  const handleEnd = useCallback(() => {
    if (touchStartRef.current) {
      const current = swipeStateRef.current;
      if (current.isSwiping && current.isThresholdReached && current.direction) {
        if (current.direction === 'back' && canGoBackRef.current) {
          onBackRef.current();
        } else if (current.direction === 'forward' && canGoForwardRef.current) {
          onForwardRef.current();
        }
      }
    }

    touchStartRef.current = null;
    setSwipeState({
      isSwiping: false,
      direction: null,
      progress: 0,
      isThresholdReached: false,
      deltaX: 0,
    });
  }, []);

  // Listen to postMessages from child iframe Sandbox
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;

      if (e.data.type === 'SWIPE_TOUCH_START') {
        handleStart(e.data.clientX, e.data.clientY);
      } else if (e.data.type === 'SWIPE_TOUCH_MOVE') {
        handleMove(e.data.clientX, e.data.clientY);
      } else if (e.data.type === 'SWIPE_TOUCH_END') {
        handleEnd();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleStart, handleMove, handleEnd]);

  // Touch event handlers for native DOM elements in BrowserShell
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      handleStart(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, [handleStart]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, [handleMove]);

  const onTouchEnd = useCallback(() => {
    handleEnd();
  }, [handleEnd]);

  return {
    swipeState,
    touchHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
    },
  };
}
