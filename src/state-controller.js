/*!
 * SiriSphere — web port. Step 5/9: state machine (port of SiriStateController.java).
 *
 * Turns the public inputs — state, audio level, user tweaks, palette, visibility — into
 * smoothly animated shader parameters, once per frame.
 *
 * Audio policy (unchanged from Android): the sphere NEVER invents audio. `audio` is exactly
 * what the host passed to {@link StateController#setAudioAmplitude}. If the host has not
 * supplied a value for AUDIO_TIMEOUT_S, a small deterministic per-state floor keeps the wave
 * visibly alive (PROCESSING additionally gets a slow sine "thinking" pulse).
 */
(function (root) {
    'use strict';

    var SSE = root.SiriSphere;

    var OPEN_SECONDS = 0.60;          // island pill -> sphere
    var CLOSE_SECONDS = 0.42;         // sphere -> island pill
    var SHOW_HIDE_SECONDS = 0.42;     // matches the 420 ms expand/collapse seen in the source
    var AUDIO_TIMEOUT_S = 0.70;
    var ERROR_HOLD_S = 1.2;

    /** Immutable per-state targets. */
    function Target(resolved, speed, amp, waviness, spread, floor) {
        this.resolved = resolved; this.speed = speed; this.amp = amp;
        this.waviness = waviness; this.spread = spread; this.floor = floor;
    }
    var T_IDLE = new Target(0, 0.40, 0.20, 5, 0.20, 0.00);
    var T_LISTENING = new Target(1, 1.00, 0.24, 5, 0.30, 0.12);
    var T_PROCESSING = new Target(1, 2.00, 0.20, 7, 0.70, 0.20);
    var T_SPEAKING = new Target(1, 1.20, 0.28, 5, 0.40, 0.12);
    var T_ERROR = new Target(0.7, 0.60, 0.30, 9, 0.10, 0.25);

    /**
     * @param {function():number=} clock monotonic nanosecond clock (injectable for tests).
     */
    function StateController(clock) {
        this.clock = clock || SSE.now;

        // ---- written by any code path ----
        this.state = SSE.State.IDLE;
        this.stateChangedNanos = this.clock();
        this.audioIn = 0;
        this.audioStampNanos = 0;
        this.palette = SSE.Palette.RAINBOW;
        this.speedScale = 1; this.wavinessScale = 1; this.amplitudeScale = 1;
        this.orbMode = 1; this.intensity = 0.38;
        this.visibleTarget = true;
        this.transition = false;

        // ---- per-frame state ----
        this.firstFrame = true;
        this.lastTime = 0;
        this.audioSmoothed = 0;
        this.visibilityLinear = 1;    // 0..1 linear progress
        this.expLin = 0;              // island transition progress
        this.firstPalette = true;
        this.hideReported = false;
        this.palCur = new Float32Array(12);
    }

    // ------------------------------------------------------------------ constants (public, mirrors the Java ones)
    StateController.OPEN_SECONDS = OPEN_SECONDS;
    StateController.CLOSE_SECONDS = CLOSE_SECONDS;
    StateController.SHOW_HIDE_SECONDS = SHOW_HIDE_SECONDS;
    StateController.AUDIO_TIMEOUT_S = AUDIO_TIMEOUT_S;
    StateController.ERROR_HOLD_S = ERROR_HOLD_S;

    // ------------------------------------------------------------------ public inputs
    StateController.prototype.setState = function (state) {
        var s = SSE.State.parse(state);
        if (!s) return;
        if (s !== this.state) { this.state = s; this.stateChangedNanos = this.clock(); }
    };

    StateController.prototype.getState = function () { return this.state; };

    StateController.prototype.setAudioAmplitude = function (v) {
        var value = Number(v);
        if (value !== value) value = 0;                    // NaN guard
        this.audioIn = SSE.clamp(value, 0, 1);
        this.audioStampNanos = this.clock();
    };

    StateController.prototype.setAudioFromRmsDb = function (rmsDb) {
        this.setAudioAmplitude(SSE.amplitudeFromRmsDb(rmsDb));
    };

    StateController.prototype.setPalette = function (p) { if (p && p.c) this.palette = p; };
    StateController.prototype.setSpeed = function (v) { this.speedScale = SSE.clamp(+v, 0, 6); };
    StateController.prototype.setWaviness = function (v) { this.wavinessScale = SSE.clamp(+v, 0.1, 4); };
    StateController.prototype.setAmplitude = function (v) { this.amplitudeScale = SSE.clamp(+v, 0, 3); };
    StateController.prototype.setOrbMode = function (v) { this.orbMode = SSE.clamp(+v, 0, 1); };
    StateController.prototype.setIntensity = function (v) { this.intensity = SSE.clamp(+v, 0, 2); };

    /** true: show()/hide() animate the island pill growing into the sphere (and back) instead of a fade. */
    StateController.prototype.setTransition = function (v) { this.transition = !!v; };

    StateController.prototype.setVisibleTarget = function (v) {
        this.visibleTarget = !!v;
        if (this.visibleTarget) this.hideReported = false;
    };

    StateController.prototype.isVisibleTarget = function () { return this.visibleTarget; };

    /** True once the fade-out has fully finished (reported once per hide). */
    StateController.prototype.consumeHideCompleted = function () {
        if (!this.visibleTarget && this.visibilityLinear <= 0 && !this.hideReported) {
            this.hideReported = true;
            return true;
        }
        return false;
    };

    // ------------------------------------------------------------------ per-frame update
    /**
     * @param {number} timeSec seconds since the first frame
     * @param {SiriSphere.Params} out mutated in place
     */
    StateController.prototype.update = function (timeSec, out) {
        var dt = this.firstFrame ? 1 / 60 : SSE.clamp(timeSec - this.lastTime, 0, 0.1);
        this.firstFrame = false;
        this.lastTime = timeSec;

        var st = this.state;
        var now = this.clock();

        // ERROR auto-returns to IDLE.
        if (st === SSE.State.ERROR && (now - this.stateChangedNanos) * 1e-9 > ERROR_HOLD_S) {
            this.setState(SSE.State.IDLE);
            st = this.state;
        }
        var t = targetFor(st);

        // ----- audio: real value only, light attack/release smoothing -----
        var real = this.audioStampNanos !== 0 && (now - this.audioStampNanos) * 1e-9 < AUDIO_TIMEOUT_S;
        var aTarget;
        if (real) {
            aTarget = Math.max(this.audioIn, t.floor * 0.3);
        } else {
            aTarget = t.floor;
            if (st === SSE.State.PROCESSING) aTarget += 0.12 * (0.5 + 0.5 * Math.sin(timeSec * 3.2));
        }
        var rate = aTarget > this.audioSmoothed ? 30 : 6;
        this.audioSmoothed += (aTarget - this.audioSmoothed) * SSE.k(rate, dt);

        // ----- generic exponential approach for the rest -----
        out.time = timeSec;
        out.resolved = SSE.approach(out.resolved, t.resolved, 5, dt);
        out.speed = SSE.approach(out.speed, t.speed * this.speedScale, 3, dt);
        out.amplitude = SSE.approach(out.amplitude, t.amp * this.amplitudeScale, 6, dt);
        out.waviness = SSE.approach(out.waviness, t.waviness * this.wavinessScale, 3, dt);
        out.spread = SSE.approach(out.spread, t.spread, 4, dt);
        out.audio = this.audioSmoothed;
        out.intensity = SSE.approach(out.intensity, this.intensity, 6, dt);
        out.orbMode = SSE.approach(out.orbMode, this.orbMode, 6, dt);

        // ----- palette cross-fade (ERROR forces red) -----
        var target = (st === SSE.State.ERROR ? SSE.Palette.ERROR_RED : this.palette).c;
        if (this.firstPalette) {
            this.palCur.set(target);
            this.firstPalette = false;
        }
        var kp = SSE.k(3, dt);
        for (var i = 0; i < 12; i++) {
            this.palCur[i] += (target[i] - this.palCur[i]) * kp;
            out.palette[i] = this.palCur[i];
        }

        // ----- show / hide -----
        out.transition = this.transition;
        out.opening = this.visibleTarget;
        if (this.transition) {
            var dur = this.visibleTarget ? OPEN_SECONDS : CLOSE_SECONDS;
            this.expLin = this.visibleTarget
                ? Math.min(1, this.expLin + dt / dur)
                : Math.max(0, this.expLin - dt / dur);
            this.visibilityLinear = this.expLin > 0 ? 1 : 0;   // pill is drawn while any progress remains
            out.expansion = this.expLin;
            out.visibility = this.visibilityLinear;
            out.alpha = 1;
        } else {
            var step = dt / SHOW_HIDE_SECONDS;
            this.visibilityLinear = this.visibleTarget
                ? Math.min(1, this.visibilityLinear + step)
                : Math.max(0, this.visibilityLinear - step);
            var e = this.visibilityLinear * this.visibilityLinear * (3 - 2 * this.visibilityLinear);
            out.expansion = 1;
            out.visibility = e;
            out.alpha = e;
        }
    };

    // ------------------------------------------------------------------ helpers
    function targetFor(state) {
        switch (state) {
            case SSE.State.LISTENING: return T_LISTENING;
            case SSE.State.PROCESSING: return T_PROCESSING;
            case SSE.State.SPEAKING: return T_SPEAKING;
            case SSE.State.ERROR: return T_ERROR;
            default: return T_IDLE;
        }
    }

    SSE.StateController = StateController;
})(window);
