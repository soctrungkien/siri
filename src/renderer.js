/*!
 * SiriSphere — web port. Step 8/9: the two-pass WebGL2 renderer
 * (port of SiriSphereRenderer.java).
 *
 *   pass 1  ribbon.frag -> off-screen texture (RGBA16F when the GPU allows it, else RGBA8 + LDR compression)
 *   pass 2  glass.frag  -> the canvas (premultiplied alpha), samples pass 1 and, optionally,
 *                          the backdrop painted by SiriSphere.Backdrop for liquid refraction
 *
 * The GLSL is byte-identical to siri-sphere/src/main/assets/siri_sphere/* (see web/tools/sync-shaders.mjs),
 * and all rect maths / uniform values mirror the Java code 1:1.
 *
 * One deliberate deviation: Android relies on the window system to composite the translucent
 * GLSurfaceView, so it can render with blending disabled. A web canvas has to composite itself,
 * therefore pass 2 uses classic premultiplied "source over" (ONE, ONE_MINUS_SRC_ALPHA). Over a
 * transparent (0,0,0,0) canvas that is mathematically identical to blending disabled.
 */
(function (root) {
    'use strict';

    var SSE = root.SiriSphere;

    // Canvas pixel colours per CSS pixel: 2 keeps the ribbon crisp on retina screens without doubling
    // the fill rate on 3x phones. `setPixelRatio()` / `setRenderScale()` change the cost.
    var DEFAULT_MAX_PIXEL_RATIO = 2;

    function Renderer(canvas, controller, listener) {
        this.canvas = canvas;
        this.controller = controller;
        this.listener = listener || null;
        this.params = new SSE.Params();

        // ---- config (mirrors the Java volatile fields) ----
        this.orbFraction = 0.90;        // orb diameter / min(view w,h)
        this.offsetXCss = 0;            // +x right, +y down, CSS px
        this.offsetYCss = 0;
        this.renderScale = 0.75;        // ribbon texture resolution factor
        this.pillW = -1; this.pillH = -1; this.pillCx = -1; this.pillCy = -1;  // CSS px, <0 = default
        this.realLiquid = false;
        this.debugGlErrors = false;
        this.maxPixelRatio = DEFAULT_MAX_PIXEL_RATIO;
        this.backdropDensity = Math.max(0.5, (root.devicePixelRatio || 1) * 0.4);

        // ---- GL state ----
        this.gl = null;
        this.progRibbon = null; this.progGlass = null; this.quad = null;
        this.fbo = null; this.fboTex = null; this.fboW = 0; this.fboH = 0;
        this.emptyTex = null;
        this.uniformFor = null;
        this.ldr = false;
        this.broken = false;
        this.released = false;
        this.canvasW = 1; this.canvasH = 1; this.dpr = 1;
        this.maxTexturePx = 4096;
        this.t0 = -1;
        this.lastError = null;
    }

    // ============================================================ configuration
    Renderer.prototype.setOrbFraction = function (f) { this.orbFraction = SSE.clamp(+f, 0.1, 1.5); };
    Renderer.prototype.setOffsetPx = function (dxCss, dyCss) { this.offsetXCss = +dxCss || 0; this.offsetYCss = +dyCss || 0; };
    Renderer.prototype.setRenderScale = function (s) { this.renderScale = SSE.clamp(+s, 0.25, 1); };
    Renderer.prototype.setPixelRatio = function (r) { this.maxPixelRatio = SSE.clamp(+r || 1, 0.5, 4); this.resize(this.cssW || 1, this.cssH || 1); };
    Renderer.prototype.setDebugGlErrors = function (v) { this.debugGlErrors = !!v; };

    /** Island pill rectangle in CSS pixels relative to the canvas (top-left origin). Negatives = defaults. */
    Renderer.prototype.setIslandPill = function (w, h, cx, cy) {
        this.pillW = +w; this.pillH = +h; this.pillCx = +cx; this.pillCy = +cy;
    };

    Renderer.prototype.setBackdropDensity = function (v) { this.backdropDensity = Math.max(0.05, +v || 0.4); };
    Renderer.prototype.setRealLiquid = function (v) { this.realLiquid = !!v; };

    /** @param {CanvasImageSource|null} source backdrop source; null turns refraction off. */
    Renderer.prototype.setBackdropSource = function (source) {
        this.backdrop.setSource(source);
        if (!source) this.realLiquid = false;
    };
    Renderer.prototype.setBackdropDynamic = function (v) { this.backdrop.setDynamic(v); };

    // ============================================================ setup
    Renderer.prototype.init = function () {
        var gl = this.gl = this.canvas.getContext('webgl2', {
            alpha: true,
            premultipliedAlpha: true,        // the shader writes premultiplied colour, like GLSurfaceView
            depth: false,
            stencil: false,
            antialias: false,
            preserveDrawingBuffer: false,
            powerPreference: 'high-performance'
        });
        if (!gl) throw new SSE.GpuError('WebGL2 is not available in this browser');

        this.maxTexturePx = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096, 4096);
        this.uniformFor = SSE.gl.uniformLocator(gl);

        try {
            this.ldr = !SSE.gl.supportsFloatTarget(gl);
            this.progRibbon = SSE.gl.program(gl, SSE.Shaders.sphereVert, SSE.Shaders.ribbonFrag, 'ribbon');
            this.progGlass = SSE.gl.program(gl, SSE.Shaders.sphereVert, SSE.Shaders.glassFrag, 'glass');
            this.quad = SSE.gl.triangleStripQuad(gl);
            this.backdrop = new SSE.Backdrop(gl);
            this.emptyTex = SSE.gl.texture(gl, gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
            this.checkGl('init');
        } catch (e) {
            this.fail(e && e.message ? e.message : String(e));
            return false;
        }

        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.BLEND);
        return true;
    };

    // ============================================================ size
    /**
     * @param {number} cssW CSS width of the canvas box
     * @param {number} cssH CSS height of the canvas box
     * @param {number=} explicitDpr device pixels per CSS pixel (defaults to devicePixelRatio, capped)
     */
    Renderer.prototype.resize = function (cssW, cssH, explicitDpr) {
        this.cssW = Math.max(1, Math.round(cssW));
        this.cssH = Math.max(1, Math.round(cssH));
        var dpr = (explicitDpr != null)
            ? SSE.clamp(explicitDpr, 1, 4)
            : SSE.clamp(root.devicePixelRatio || 1, 1, this.maxPixelRatio);
        this.dpr = dpr;
        var w = Math.max(1, Math.min(this.maxTexturePx, Math.round(this.cssW * dpr)));
        var h = Math.max(1, Math.min(this.maxTexturePx, Math.round(this.cssH * dpr)));
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        this.canvasW = w;
        this.canvasH = h;
        var gl = this.gl;
        if (gl) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, w, h);
        }
    };

    // ============================================================ frame
    /**
     * Draws one frame. The caller (SiriSphere.Sphere) owns the requestAnimationFrame loop.
     * @param {number} timeSec seconds since the first frame
     */
    Renderer.prototype.render = function (timeSec) {
        var gl = this.gl, P = this.params;
        if (!gl) return;

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvasW, this.canvasH);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (this.broken || this.released || !this.progRibbon || !this.progGlass) return;

        this.controller.update(timeSec, P);
        if (this.controller.consumeHideCompleted()) {
            var l = this.listener;
            if (l && l.onHideCompleted) l.onHideCompleted();
        }
        if (P.visibility <= 0) return;             // fully hidden: nothing to draw

        // ---- optional backdrop, painted canvas-sized inside the canvas ----
        var backdropReady = this.backdrop.draw(this.canvasW, this.canvasH);
        if (backdropReady) this.backdrop.blitTo(this.canvasW, this.canvasH);

        // ---- orb rectangle (GL origin = bottom-left, like Android) ----
        var canvasW = this.canvasW, canvasH = this.canvasH, dpr = this.dpr;
        var base = Math.min(canvasW, canvasH) * this.orbFraction;
        var rw, rh, ox, oy;
        var orbMode = P.orbMode, collapse = P.collapse, material = P.materialAlpha;
        var offsetXpx = this.offsetXCss * dpr, offsetYpx = this.offsetYCss * dpr;
        if (P.transition) {
            var x = P.expansion;                                       // 0 = island pill, 1 = sphere
            var ez = P.opening ? SSE.easeOutBack(x) : SSE.smooth(x);    // slight organic overshoot when opening
            var ph = this.pillH > 0 ? this.pillH * dpr : base * 0.18;
            var pw = this.pillW > 0 ? this.pillW * dpr : base * 0.62;
            var ocx = canvasW * 0.5 + offsetXpx, ocy = canvasH * 0.5 + offsetYpx;
            var pcx = this.pillCx >= 0 ? this.pillCx * dpr : ocx;
            var pcy = this.pillCy >= 0 ? this.pillCy * dpr : ocy - base * 0.5 + ph * 0.5;
            var sm = SSE.smooth(x);
            var cx = pcx + (ocx - pcx) * sm, cy = pcy + (ocy - pcy) * sm;
            rw = Math.max(2, pw + (base - pw) * ez);
            rh = Math.max(2, ph + (base - ph) * ez);
            ox = cx - rw * 0.5;
            oy = canvasH - (cy + rh * 0.5);
            orbMode = P.orbMode * SSE.step(0.55, 1, x);                 // pill is a capsule, ends as a circle
            collapse = 1 - SSE.step(0, 0.5, x);                         // starts as solid black = identical to the island
            material = SSE.step(0.30, 0.80, x);                         // ribbon / rim light fade in while growing
        } else {
            var size = Math.max(2, base * (0.82 + 0.18 * P.visibility));
            rw = rh = size;
            ox = canvasW * 0.5 + offsetXpx - size * 0.5;
            oy = canvasH * 0.5 - offsetYpx - size * 0.5;
        }

        var want = Math.max(64, Math.round(base * this.renderScale));
        if (!this.ensureFbo(want, want)) return;

        // ------------------------------------------------------------------ pass 1
        var rp = this.progRibbon;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.viewport(0, 0, this.fboW, this.fboH);
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(rp);
        this.f1(rp, 'uTime', P.time);
        this.f1(rp, 'uSpeed', P.speed);
        this.f1(rp, 'uWaviness', P.waviness);
        this.f1(rp, 'uAmplitude', P.amplitude);
        this.f1(rp, 'uAudio', P.audio);
        this.f1(rp, 'uAlpha', 1);
        this.f1(rp, 'uScale', P.ribbonScale);
        this.f1(rp, 'uResolved', P.resolved);
        this.f1(rp, 'uOrbMode', orbMode);
        this.f1(rp, 'uTaper', P.taper);
        this.f1(rp, 'uSpread', P.spread);
        this.f1(rp, 'uIntensity', P.intensity);
        this.f1(rp, 'uAberration', P.aberration);
        this.f1(rp, 'uCoreThickness', P.coreThickness);
        this.f1(rp, 'uBandSharpness', P.bandSharpness);
        this.f1(rp, 'uGlowIntensity', P.glowIntensity);
        this.f1(rp, 'uGlowSoftness', P.glowSoftness);
        this.f1(rp, 'uGlowThickness', P.glowThickness);
        this.f1(rp, 'uBreathing', P.breathing);
        this.f1(rp, 'uA2React', P.a2React);
        this.f1(rp, 'uWorldWidth', P.worldWidth);
        this.f1(rp, 'uLdr', this.ldr ? 1 : 0);
        this.f2(rp, 'uRectSize', this.fboW, this.fboH);
        this.palette(rp, P);
        SSE.gl.drawQuad(gl, this.quad);

        // ------------------------------------------------------------------ pass 2
        var gp = this.progGlass;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvasW, canvasH);
        gl.enable(gl.BLEND);                                  // see the note at the top of this file
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(gp);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, backdropReady ? this.backdrop.fboTex : this.emptyTex);
        gl.uniform1i(this.loc(gp, 'uScene'), 0);
        gl.uniform1i(this.loc(gp, 'uBackdrop'), 1);
        this.f2(gp, 'uCanvas', canvasW, canvasH);
        this.f2(gp, 'uRectOrigin', ox, oy);
        this.f2(gp, 'uRectSize', rw, rh);
        this.f1(gp, 'uOrbMode', orbMode);
        this.f1(gp, 'uShapePower', P.shapePower);
        this.f1(gp, 'uMorph', P.morph);
        this.f1(gp, 'uAlpha', P.alpha);
        this.f1(gp, 'uMaterialAlpha', material);
        this.f1(gp, 'uCollapse', collapse);
        this.f1(gp, 'uTime', P.time);
        this.f1(gp, 'uHighlight', P.highlight);
        this.f1(gp, 'uRealLiquid', (this.realLiquid && backdropReady) ? 1 : 0);
        this.f1(gp, 'uBackdropDensity', Math.max(0.5, this.backdropDensity));
        this.f1(gp, 'uLdr', this.ldr ? 1 : 0);
        this.palette(gp, P);
        SSE.gl.drawQuad(gl, this.quad);

        gl.disable(gl.BLEND);
        gl.activeTexture(gl.TEXTURE0);
        if (this.debugGlErrors) this.checkGl('frame');
    };

    // ============================================================ internals
    Renderer.prototype.palette = function (prog, P) {
        for (var i = 0; i < 4; i++) {
            this.f3(prog, 'uPalette' + i, P.palette[i * 3], P.palette[i * 3 + 1], P.palette[i * 3 + 2]);
        }
    };

    // Three tiny wrappers around gl.uniform*/getUniformLocation, mirroring
    // SiriSphereRenderer.loc()/f1()/f2().
    Renderer.prototype.loc = function (prog, name) { return this.uniformFor(prog, name); };
    Renderer.prototype.f1 = function (prog, name, v) {
        this.gl.uniform1f(this.uniformFor(prog, name), v);
    };
    Renderer.prototype.f2 = function (prog, name, a, b) {
        this.gl.uniform2f(this.uniformFor(prog, name), a, b);
    };
    Renderer.prototype.f3 = function (prog, name, a, b, c) {
        this.gl.uniform3f(this.uniformFor(prog, name), a, b, c);
    };

    Renderer.prototype.ensureFbo = function (w, h) {
        var gl = this.gl;
        w = Math.max(1, Math.min(this.maxTexturePx, Math.round(w)));
        h = Math.max(1, Math.min(this.maxTexturePx, Math.round(h)));
        if (this.fbo && Math.abs(this.fboW - w) < 8 && Math.abs(this.fboH - h) < 8) return true;
        if (this.fbo) { gl.deleteFramebuffer(this.fbo); this.fbo = null; }
        if (this.fboTex) { gl.deleteTexture(this.fboTex); this.fboTex = null; }

        for (var attempt = 0; attempt < 2; attempt++) {
            this.fboTex = SSE.gl.texture(gl, gl.LINEAR);
            if (!this.ldr) {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
            } else {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            }
            this.fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
            var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            if (status === gl.FRAMEBUFFER_COMPLETE) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                this.fboW = w; this.fboH = h;
                return true;
            }
            SSE.warn('FBO incomplete (0x' + status.toString(16) + ') ldr=' + this.ldr + ', retrying with RGBA8');
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteFramebuffer(this.fbo); this.fbo = null;
            gl.deleteTexture(this.fboTex); this.fboTex = null;
            if (this.ldr) break;
            this.ldr = true;                                   // fall back to an 8-bit target
        }
        this.fail('cannot create a complete framebuffer');
        return false;
    };

    Renderer.prototype.checkGl = function (where) {
        var gl = this.gl;
        var e = gl.getError();
        if (e !== gl.NO_ERROR) {
            var msg = 'GL error 0x' + e.toString(16) + ' at ' + where;
            this.lastError = msg;
            SSE.warn(msg);
        }
    };

    Renderer.prototype.fail = function (message) {
        this.broken = true;
        SSE.error(message);
        var l = this.listener;
        if (l && l.onGpuError) l.onGpuError(message);
    };

    Renderer.prototype.release = function () {
        if (this.released) return;
        this.released = true;
        var gl = this.gl;
        if (!gl) return;
        if (this.backdrop) { this.backdrop.dispose(); this.backdrop = null; }
        if (this.progRibbon) gl.deleteProgram(this.progRibbon);
        if (this.progGlass) gl.deleteProgram(this.progGlass);
        if (this.quad) gl.deleteBuffer(this.quad);
        if (this.fbo) gl.deleteFramebuffer(this.fbo);
        if (this.fboTex) gl.deleteTexture(this.fboTex);
        if (this.emptyTex) gl.deleteTexture(this.emptyTex);
        this.progRibbon = this.progGlass = this.quad = this.fbo = this.fboTex = this.emptyTex = null;
        this.fboW = this.fboH = 0;
    };

    /** Cheap WebGL2 probe on a throwaway canvas (never touches the caller's canvas attributes). */
    Renderer.isSupported = function () {
        try {
            return !!(root.document && root.document.createElement('canvas').getContext('webgl2'));
        } catch (e) {
            return false;
        }
    };

    SSE.Renderer = Renderer;
})(window);
