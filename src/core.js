/*!
 * SiriSphere — web port (WebGL2). Step 1/9: core namespace + shared maths.
 *
 * The whole web port is plain "classic" scripts (no bundler, no dependencies) so that
 * `web/index.html` works when opened straight from disk (file://) as well as from a
 * static server / GitHub Pages. Every file attaches its class to the global
 * `window.SiriSphere` namespace; `web/tools/build.mjs` simply concatenates them into
 * one file for `web/dist`.
 */
(function (root) {
    'use strict';

    var SiriSphere = root.SiriSphere = root.SiriSphere || {};

    /** Version of the web port (not of the Android module). */
    SiriSphere.VERSION = '1.0.0';

    /** Monotonic nanosecond clock, mirroring System.nanoTime() of the Android port. */
    var origin = (root.performance && root.performance.now) ? root.performance.now() : Date.now();
    SiriSphere.now = function () {
        var ms = (root.performance && root.performance.now) ? root.performance.now() : (Date.now() - origin);
        return ms * 1e6;                                   // ms -> ns
    };

    SiriSphere.clamp = function (v, lo, hi) {
        if (v !== v) return lo;                            // NaN guard (same as the Java code)
        return v < lo ? lo : (v > hi ? hi : v);
    };

    /** 1 - e^(-rate*dt): the exponential approach factor used all over the controller. */
    SiriSphere.k = function (rate, dt) { return 1 - Math.exp(-rate * dt); };

    SiriSphere.approach = function (cur, tgt, rate, dt) { return cur + (tgt - cur) * SiriSphere.k(rate, dt); };

    /** SiriSphereRenderer.step(a, b, x) — smoothstep between two edges. */
    SiriSphere.step = function (a, b, x) {
        var t = SiriSphere.clamp((x - a) / (b - a), 0, 1);
        return t * t * (3 - 2 * t);
    };

    SiriSphere.smooth = function (x) { return SiriSphere.step(0, 1, x); };

    /** SiriSphereRenderer.easeOutBack(x). */
    SiriSphere.easeOutBack = function (x) {
        var c = 1.15, t = x - 1;
        return 1 + (c + 1) * t * t * t + c * t * t;
    };

    /**
     * SiriSphereView.amplitudeFromRmsDb: SpeechRecognizer rmsdB (roughly -2..10 dB) -> 0..1.
     * Kept bit-for-bit identical to the Android implementation so hosts can share level code.
     */
    SiriSphere.amplitudeFromRmsDb = function (rmsDb) {
        return SiriSphere.clamp((rmsDb + 2) / 12, 0, 1);
    };

    /** 0xRRGGBB -> r,g,b floats (same conversion as SiriPalette.of). */
    SiriSphere.rgbFromHex = function (hex) {
        hex = hex >>> 0;
        return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
    };

    // ---- logging (the "Log.w/Log.e" of the port). Hosts can mute the module with
    //      SiriSphere.logLevel = 0; valid values: 0 = silent, 1 = warnings+errors, 2 = verbose.
    SiriSphere.logLevel = 1;
    SiriSphere.warn = function (message) {
        if (SiriSphere.logLevel < 1) return;
        if (root.console && root.console.warn) root.console.warn('[SiriSphere] ' + message);
    };
    SiriSphere.error = function (message) {
        if (SiriSphere.logLevel < 1) return;
        if (root.console && root.console.error) root.console.error('[SiriSphere] ' + message);
    };
})(window);
