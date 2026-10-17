/*!
 * SiriSphere — web port. Step 2/9: visual states (port of SiriState.java).
 * Map them 1:1 to the real state of your assistant.
 */
(function (root) {
    'use strict';

    var State = {
        /** Assistant summoned but nothing happening: soft round glow, no waves. */
        IDLE: 'IDLE',
        /** Microphone is open, user may be speaking: waves react to the real mic level. */
        LISTENING: 'LISTENING',
        /** Request sent to the AI backend, waiting for an answer: fast, colour-split swirl. */
        PROCESSING: 'PROCESSING',
        /** Assistant is speaking (TTS): waves react to the real playback level. */
        SPEAKING: 'SPEAKING',
        /** Something failed: red flash, then returns to IDLE automatically. */
        ERROR: 'ERROR'
    };

    State.values = [State.IDLE, State.LISTENING, State.PROCESSING, State.SPEAKING, State.ERROR];

    /** @return {string|null} canonical state name, or null when it is not a known state. */
    State.parse = function (name) {
        if (typeof name !== 'string') return null;
        var up = name.trim().toUpperCase();
        return State.values.indexOf(up) >= 0 ? up : null;
    };

    root.SiriSphere.State = State;
})(window);
