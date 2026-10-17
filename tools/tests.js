/*!
 * SiriSphere — web port tests. Ported 1:1 from tools/jvmtest/com/sirisphere/ControllerTest.java
 * (same scenarios, same thresholds) plus a few web-only checks.
 *
 * Runs in node (web/tools/test.mjs) and expects:
 *   window.SiriSphere            — the ported modules
 *   window.__siriCheck(ok, text) — assertion sink
 */
(function (root) {
    'use strict';

    var SSE = root.SiriSphere;
    var check = root.__siriCheck || function (ok, what) { if (!ok) throw new Error(what); };

    var NOW = { value: 1e9 };                                  // fake monotonic clock (ns)
    function clock() { return NOW.value; }

    /** Advances the fake clock and the fake frame time by `seconds` at 60 fps. */
    function run(controller, params, from, seconds) {
        var t = from;
        var steps = Math.round(seconds * 60);
        for (var i = 0; i < steps; i++) {
            t += 1 / 60;
            NOW.value += 16666667;
            controller.update(t, params);
        }
        return t;
    }

    var State = SSE.State;
    var Palette = SSE.Palette;

    // ---------------------------------------------------------------- state machine
    var c = new SSE.StateController(clock);
    var p = new SSE.Params();
    var t = run(c, p, 0, 1.0);
    check(p.resolved < 0.05, 'IDLE keeps resolved ~0 (' + p.resolved + ')');
    check(Math.abs(p.speed - 0.40) < 0.02, 'IDLE speed ~0.40 (' + p.speed + ')');

    c.setState(State.LISTENING); t = run(c, p, t, 2.0);
    check(p.resolved > 0.95, 'LISTENING -> resolved ~1 (' + p.resolved + ')');
    check(Math.abs(p.speed - 1.0) < 0.02, 'LISTENING speed ~1.0 (' + p.speed + ')');

    c.setState(State.PROCESSING); t = run(c, p, t, 2.0);
    check(p.speed > 1.9 && p.spread > 0.65, 'PROCESSING fast + wide colour split (' + p.speed + ', ' + p.spread + ')');

    // real audio is used as-is (attack is fast), and decays after timeout
    c.setState(State.SPEAKING); c.setAudioAmplitude(0.8); t = run(c, p, t, 0.3);
    check(p.audio > 0.7 && p.audio <= 0.81, 'SPEAKING follows real audio 0.8 (' + p.audio + ')');
    t = run(c, p, t, 2.0);                                     // no more audio updates -> deterministic floor only
    check(p.audio < 0.2, 'audio falls back to floor after timeout (' + p.audio + ')');

    // NaN / out-of-range guard
    c.setAudioAmplitude(NaN); t = run(c, p, t, 0.2);
    check(!isNaN(p.audio), 'NaN audio is sanitised');
    c.setAudioAmplitude(5); t = run(c, p, t, 0.3);
    check(p.audio <= 1.0001, 'audio clamped to <=1 (' + p.audio + ')');

    // user tweaks are multipliers
    c.setState(State.LISTENING); c.setSpeed(2); c.setWaviness(2); t = run(c, p, t, 2.5);
    check(Math.abs(p.speed - 2.0) < 0.05 && Math.abs(p.waviness - 10) < 0.2,
        'setSpeed/setWaviness scale the state (' + p.speed + ', ' + p.waviness + ')');
    c.setSpeed(1); c.setWaviness(1);

    // ERROR is red and auto-returns to IDLE
    c.setState(State.ERROR); t = run(c, p, t, 1.0);
    check(c.getState() === State.ERROR && p.palette[0] > 0.6 && p.palette[2] < 0.5, 'ERROR tints palette red');
    t = run(c, p, t, 1.0);
    check(c.getState() === State.IDLE, 'ERROR auto-returns to IDLE after hold');
    t = run(c, p, t, 2.0);
    check(Math.abs(p.palette[2] - Palette.RAINBOW.c[2]) < 0.05, 'palette fades back to user palette');

    // hide -> fully hidden, reported exactly once; show cancels
    c.setVisibleTarget(false); t = run(c, p, t, 0.2);
    check(p.visibility > 0 && p.visibility < 1, 'mid fade-out is partial (' + p.visibility + ')');
    check(!c.consumeHideCompleted(), 'hide not reported while still fading');
    t = run(c, p, t, 0.4);
    check(p.visibility === 0, 'fully hidden after >=420 ms');
    check(c.consumeHideCompleted(), 'hide completion reported');
    check(!c.consumeHideCompleted(), 'hide completion reported only once');
    c.setVisibleTarget(true); t = run(c, p, t, 0.5);
    check(p.visibility === 1 && !c.consumeHideCompleted(), 'show restores visibility');

    // island transition: closed pill -> grows (0.6 s) -> shrinks (0.42 s) -> reports hidden once
    var c2 = new SSE.StateController(clock);
    var q = new SSE.Params();
    c2.setTransition(true); c2.setVisibleTarget(false);
    var u = run(c2, q, 0, 0.2);
    check(q.transition && q.expansion === 0 && q.visibility === 0, 'transition: starts closed (nothing drawn)');
    c2.consumeHideCompleted();
    c2.setVisibleTarget(true); u = run(c2, q, u, 0.3);
    check(q.opening && Math.abs(q.expansion - 0.5) < 0.05 && q.alpha === 1, 'transition: halfway after 0.3 s (' + q.expansion + ')');
    u = run(c2, q, u, 0.4);
    check(q.expansion === 1, 'transition: fully open after 0.6 s');
    c2.setVisibleTarget(false); u = run(c2, q, u, 0.2);
    check(!q.opening && q.expansion > 0 && q.expansion < 1 && q.visibility === 1, 'transition: closing keeps drawing (' + q.expansion + ')');
    check(!c2.consumeHideCompleted(), 'transition: not reported while shrinking');
    u = run(c2, q, u, 0.3);
    check(q.expansion === 0 && q.visibility === 0 && c2.consumeHideCompleted(), 'transition: reported hidden once back at the pill');

    // ---------------------------------------------------------------- palettes / helpers
    check(Palette.byName('WARM') === Palette.WARM && Palette.byName('zzz') === Palette.RAINBOW, 'palette lookup');
    check(Math.abs(Palette.RAINBOW.c[0] - 0x19 / 255) < 1e-6, 'RAINBOW[0].r from 0x19xxxx');
    check(Palette.byName('ice').c[1] > 0.99, 'palette lookup is case-insensitive');

    // ---------------------------------------------------------------- web-only checks
    check(State.parse('listening') === State.LISTENING && State.parse('nope') === null, 'state parsing (js)');
    check(SSE.amplitudeFromRmsDb(-2) === 0 && SSE.amplitudeFromRmsDb(10) === 1 &&
        Math.abs(SSE.amplitudeFromRmsDb(4) - 0.5) < 1e-6, 'amplitudeFromRmsDb matches the Android mapping');
    check(SSE.clamp(NaN, 0, 1) === 0 && SSE.clamp(7, 0, 1) === 1, 'clamp guards NaN/range');
    check(typeof SSE.Sphere === 'function' && typeof SSE.Renderer === 'function' && typeof SSE.MicAudio === 'function' &&
        typeof SSE.TriggerGestures === 'function' && typeof SSE.Backdrop === 'function', 'all web modules are exported');
    check(SSE.Shaders && SSE.Shaders.ribbonFrag.indexOf('#version 300 es') === 0 &&
        SSE.Shaders.glassFrag.indexOf('uRealLiquid') > 0, 'shaders are embedded (' + (SSE.Shaders && SSE.Shaders.hash) + ')');

    // the build must ship the same shaders the Android module uses
    check(SSE.Shaders.sphereVert.indexOf('aPosition') > 0 &&
        SSE.Shaders.glassFrag.indexOf('uBackdrop') > 0 &&
        SSE.Shaders.glassFrag.indexOf('fwidth') > 0, 'shader bodies are complete');

    // ---------------------------------------------------------------- gestures (no DOM needed)
    var listeners = {};
    var fakeElement = {
        addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener: function (type, fn) {
            listeners[type] = (listeners[type] || []).filter(function (f) { return f !== fn; });
        }
    };
    var triggers = [];
    var g = new SSE.TriggerGestures(fakeElement, function (t) { triggers.push(t); }, { longPressMs: 5000 });
    g.attach();
    check(!!listeners.pointerdown && !!listeners.pointermove && !!listeners.pointerup, 'gestures attach to pointer events');
    g.onPointerDown({ clientX: 10, clientY: 10 });
    check(triggers.length === 0, 'a single tap does not fire immediately');
    listeners.pointerup[0]();                                  // the tap ends
    g.onPointerDown({ clientX: 12, clientY: 11 });
    check(triggers.length === 1 && triggers[0] === 'DOUBLE_TAP', 'double tap fires (' + triggers.join(',') + ')');
    g.onPointerDown({ clientX: 12, clientY: 11 });              // triple tap must not fire twice
    check(triggers.length === 1, 'triple tap does not fire twice');
    g.setEnabled(false);
    g.onPointerDown({ clientX: 400, clientY: 400 });
    g.onPointerDown({ clientX: 400, clientY: 400 });
    check(triggers.length === 1, 'disabled gestures stay silent');
    g.setEnabled(true);
    g.onPointerDown({ clientX: 5, clientY: 5 });
    listeners.pointermove[0]({ clientX: 200, clientY: 200 });    // becomes a drag -> long press cancelled
    listeners.pointerup[0]();
    check(g._timer === 0, 'dragging cancels the pending long press');
    g.dispose();
    check(g.listener === null && listeners.pointerdown.length === 0, 'dispose() detaches and forgets the listener');

    // ---------------------------------------------------------------- microphone plumbing (no device)
    var levels = [];
    var mic = new SSE.MicAudio({ onLevel: function (v) { levels.push(v); } });
    check(mic.running === false, 'mic starts stopped');
    mic.stop();                                                 // must be a no-op
    check(levels.length === 0, 'stopping a stopped mic is a no-op');
    mic._tick();                                                // must neither throw nor report
    check(levels.length === 0, 'the analyser tick is a no-op while stopped');
    mic.setGain(0.5);
    check(mic.gain === 0.5, 'mic gain is settable');
    mic.dispose();
    check(typeof SSE.MicAudio.isSupported() === 'boolean', 'mic support probe returns a boolean');

    root.__siriTestsDone = true;
})(window);
