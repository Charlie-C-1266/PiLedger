import { useEffect, useRef, useState } from "react";

const LONG_PRESS_MS = 500;
const PRESS_FEEDBACK_MS = 150;
const MOVE_CANCEL_PX = 10;

export interface LongPressHandlers {
  onClick: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
}

/**
 * A deliberate edit gesture shared by the transaction rows and the account
 * tiles so they behave identically.
 *
 * Mouse keeps an immediate click-to-activate. Touch/pen instead require a
 * ~500ms long-press: an accidental tap at the end of a scroll gesture would
 * otherwise open the editor, and on the large account tiles a plain tap also
 * invites double-tap-to-zoom. A press-state (`pressing`) turns true ~150ms
 * into the hold so the press registers visibly before the action fires, and
 * moving more than 10px (i.e. scrolling) cancels it. The synthetic click that
 * follows a tap or long-press is swallowed.
 *
 * Pair with `touch-action: manipulation` and disabled `user-select` /
 * `-webkit-touch-callout` on the pressable element.
 */
export function useLongPress(onActivate?: () => void): {
  pressing: boolean;
  handlers: LongPressHandlers;
} {
  const [pressing, setPressing] = useState(false);
  const feedbackTimer = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const lastPointerType = useRef<string>("mouse");
  const longPressFired = useRef(false);

  const clearTimers = () => {
    if (feedbackTimer.current !== null) {
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setPressing(false);
  };

  useEffect(() => clearTimers, []);

  const onPointerDown = (e: React.PointerEvent) => {
    lastPointerType.current = e.pointerType;
    longPressFired.current = false;
    if (!onActivate || e.pointerType === "mouse") return;
    startPos.current = { x: e.clientX, y: e.clientY };
    feedbackTimer.current = window.setTimeout(() => setPressing(true), PRESS_FEEDBACK_MS);
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      setPressing(false);
      onActivate();
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const start = startPos.current;
    if (!start || longPressTimer.current === null) return;
    if (
      Math.abs(e.clientX - start.x) > MOVE_CANCEL_PX ||
      Math.abs(e.clientY - start.y) > MOVE_CANCEL_PX
    ) {
      clearTimers();
    }
  };

  const onClick = () => {
    if (!onActivate) return;
    // The long-press already fired; swallow the trailing click.
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    // A touch tap also synthesises a click — ignore it (touch acts via hold).
    if (lastPointerType.current !== "mouse") return;
    onActivate();
  };

  return {
    pressing,
    handlers: {
      onClick,
      onPointerDown,
      onPointerMove,
      onPointerUp: clearTimers,
      onPointerCancel: clearTimers,
      onPointerLeave: clearTimers,
    },
  };
}
