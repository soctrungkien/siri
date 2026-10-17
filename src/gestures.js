/*!
 * SiriSphere — web port (extra): double-tap / long-press trigger
 * (port of SiriTriggerGestures.java).
 *
 * It never consumes events: attach() just observes, and onPointerDown(event) can be called from
 * the host's own handler while the host keeps doing whatever it did before with the same event.
 *
 * <pre>
 *   const gestures = new SiriSphere.TriggerGestures(islandElement, trigger => startSiri(trigger));
 *   gestures.attach();                       // or gestures.onPointerDown(e) inside your handler
 * </pre>
 *
 * Why only the island and not the whole page: a double tap on arbitrary pages cannot be observed
 * without covering the screen with a capturing layer - so the trigger area is the island itself.
 */
(function (root) {
    'use strict';

    var SSE = root.SiriSphere;

    var DEFAULTS = {
        doubleTapMs: 300,     // max delay between the two taps
        longPressMs: 500,     // hold time that fires LONG_PRESS
        slopCss: 32           // max movement in CSS px that still counts as a tap/hold
    };

    function TriggerGestures(element, listener, options) {
        this.element = element;
        this.listener = listener;
        this.options = {
            doubleTapMs: (options && options.doubleTapMs) || DEFAULTS.doubleTapMs,
            longPressMs: (options && options.longPressMs) || DEFAULTS.longPressMs,
            slopCss: (options && options.slopCss) || DEFAULTS.slopCss
        };
        this.enabled = true;
        this._lastTapMs = -1e9;
        this._lastTapX = 0;
        this._lastTapY = 0;
        this._timer = 0;
        this._originX = 0;
        this._originY = 0;
        this._attached = false;
        this._onDown = this.onPointerDown.bind(this);
        this._onUp = this._onPointerUp.bind(this);
        this._onMove = this._onPointerMove.bind(this);
    }
    TriggerGestures.TRIGGER = { DOUBLE_TAP: 'DOUBLE_TAP', LONG_PRESS: 'LONG_PRESS' };

    /** Starts observing pointerdown / pointerup / pointercancel on the element. */
    TriggerGestures.prototype.attach = function () {
        if (this._attached || !this.element || !this.element.addEventListener) return;
        this._attached = true;
        this.element.addEventListener('pointerdown', this._onDown, { passive: true });
        this.element.addEventListener('pointerup', this._onUp, { passive: true });
        this.element.addEventListener('pointercancel', this._onUp, { passive: true });
        this.element.addEventListener('pointerleave', this._onUp, { passive: true });
        this.element.addEventListener('pointermove', this._onMove, { passive: true });
    };

    TriggerGestures.prototype.detach = function () {
        if (!this._attached || !this.element) return;
        this._attached = false;
        this.element.removeEventListener('pointerdown', this._onDown);
        this.element.removeEventListener('pointerup', this._onUp);
        this.element.removeEventListener('pointercancel', this._onUp);
        this.element.removeEventListener('pointerleave', this._onUp);
        this.element.removeEventListener('pointermove', this._onMove);
    };

    /** Pass a pointer/touch/mouse event through the detector; the return value is informational. */
    TriggerGestures.prototype.onPointerDown = function (event) {
        if (!this.enabled || !event) return false;
        this._cancelTimer();
        this._originX = event.clientX;
        this._originY = event.clientY;

        var now = SSE.now() / 1e6;                              // ms
        var isDouble = (now - this._lastTapMs) < this.options.doubleTapMs &&
            Math.abs(event.clientX - this._lastTapX) <= this.options.slopCss &&
            Math.abs(event.clientY - this._lastTapY) <= this.options.slopCss;
        if (isDouble) {
            this._lastTapMs = -1e9;                             // a triple tap does not fire twice
            this._fire(TriggerGestures.TRIGGER.DOUBLE_TAP);
            return true;
        }
        this._lastTapMs = now;
        this._lastTapX = event.clientX;
        this._lastTapY = event.clientY;

        var self = this;
        this._timer = root.setTimeout(function () {
            self._timer = 0;
            self._fire(TriggerGestures.TRIGGER.LONG_PRESS);
        }, this.options.longPressMs);
        return false;
    };

    TriggerGestures.prototype._onPointerMove = function (event) {
        if (!this._timer) return;
        if (Math.abs(event.clientX - this._originX) > this.options.slopCss ||
            Math.abs(event.clientY - this._originY) > this.options.slopCss) {
            this._cancelTimer();                                // it became a drag
        }
    };

    TriggerGestures.prototype._onPointerUp = function () { this._cancelTimer(); };

    TriggerGestures.prototype._cancelTimer = function () {
        if (this._timer) { root.clearTimeout(this._timer); this._timer = 0; }
    };

    TriggerGestures.prototype._fire = function (trigger) {
        if (!this.enabled || !this.listener) return;
        if (root.navigator && root.navigator.vibrate) {
            try { root.navigator.vibrate(10); } catch (e) { /* haptics are optional */ }
        }
        this.listener(trigger);
    };

    /** Disable while Siri is already open so a gesture on the sphere does not re-trigger it. */
    TriggerGestures.prototype.setEnabled = function (enabled) { this.enabled = !!enabled; };

    TriggerGestures.prototype.dispose = function () {
        this._cancelTimer();
        this.detach();
        this.listener = null;
        this.element = null;
    };

    SSE.TriggerGestures = TriggerGestures;
})(window);
