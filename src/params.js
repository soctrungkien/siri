/*!
 * SiriSphere — web port. Step 4/9: per-frame shader inputs (port of SiriSphereParams.java).
 * A single instance is reused and mutated by the StateController each frame.
 */
(function (root) {
    'use strict';

    function Params() {
        // ---- ribbon pass
        this.time = 0;
        this.speed = 0.4; this.waviness = 5; this.amplitude = 0.2; this.audio = 0;
        this.resolved = 0;              // 0 blob/idle .. 1 wave bands
        this.spread = 0.2; this.aberration = 1; this.intensity = 0.38;
        this.taper = 1.6; this.worldWidth = 0.45; this.coreThickness = 0.02; this.bandSharpness = 0.20;
        this.glowIntensity = 0.3; this.glowSoftness = 1; this.glowThickness = 2;
        this.breathing = 1; this.a2React = 1;
        this.ribbonScale = 1;
        // ---- glass pass
        this.orbMode = 1; this.shapePower = 4; this.morph = 0;
        this.materialAlpha = 1; this.collapse = 0; this.highlight = 0.55;
        // ---- island -> sphere transition (see state-controller.js)
        this.transition = false; this.opening = false;
        this.expansion = 0;             // 0 = island pill, 1 = full sphere (linear progress)
        // ---- shared
        this.alpha = 1;                 // show / hide fade
        this.visibility = 1;            // eased 0..1, also scales the orb
        this.palette = new Float32Array(12);
    }

    root.SiriSphere.Params = Params;
})(window);
