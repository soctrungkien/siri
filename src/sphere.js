/*!
 * SiriSphere — web port. Step 9/9: the public widget (port of SiriSphereView.java).
 *
 * <pre>
 *   const sphere = new SiriSphere.Sphere('#stage', { orbSize: 1 });
 *   sphere.setPalette('rainbow');
 *   sphere.show();
 *   sphere.setState('listening');          // 1:1 from your real assistant state
 *   sphere.setAudioAmplitude(level);       // 0..1 real signal (mic / TTS)
 *   ...
 *   sphere.dispose();                      // on host teardown
 * </pre>
 *
 * Power: frames come from a requestAnimationFrame pump that only runs while the canvas is
 * attached, on screen, the tab is visible, the host has not paused it and the sphere is not
 * fully hidden - the same policy as the Android view, which draws nothing and wakes nothing
 * when hidden or backgrounded.
 */
(function (root) {
    'use strict';

    var SSE = root.SiriSphere;

    // ---------------------------------------------------------------- helpers
    function resolveCanvas(target, options) {
        var doc = root.document;
        if (!doc) throw new SSE.GpuError('SiriSphere needs a browser document');
        if (typeof target === 'string') target = doc.querySelector(target);
        if (!target) throw new Error('SiriSphere: canvas target not found');

        if (target.tagName === 'CANVAS') {
            return { canvas: target, ownsCanvas: false };
        }
        if (!target.appendChild) throw new Error('SiriSphere: target must be a <canvas> or an element');
        var canvas = doc.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'display:block;position:absolute;left:0;top:0;width:100%;height:100%;';
        if (root.getComputedStyle && getComputedStyle(target).position === 'static') {
            target.style.position = 'relative';                 // make the absolute canvas fit the box
        }
        target.appendChild(canvas);
        return { canvas: canvas, ownsCanvas: true };
    }

    /** True when the canvas' CSS box is independent of its width/height attributes (so we may resize it). */
    function isCssSized(canvas) {
        var style = root.getComputedStyle ? getComputedStyle(canvas) : null;
        if (!style) return false;
        var cssW = parseFloat(style.width), cssH = parseFloat(style.height);
        if (!(cssW > 0) || !(cssH > 0)) return false;
        var attrW = canvas.width || canvas.clientWidth, attrH = canvas.height || canvas.clientHeight;
        if (Math.abs(cssW - attrW) > 0.5 || Math.abs(cssH - attrH) > 0.5) return true;   // CSS overrides the attributes
        // Same value: probe whether changing the attributes would change the layout.
        var rect = canvas.getBoundingClientRect();
        var oldW = canvas.width, oldH = canvas.height;
        canvas.width = oldW + 64; canvas.height = oldH + 64;
        var moved = Math.abs(canvas.getBoundingClientRect().width - rect.width) > 0.5 ||
                    Math.abs(canvas.getBoundingClientRect().height - rect.height) > 0.5;
        canvas.width = oldW; canvas.height = oldH;
        return !moved;
    }

    // ---------------------------------------------------------------- widget
    /**
     * @param {string|Element|HTMLCanvasElement} target element to fill, or an existing <canvas>
     * @param {Object=} options see the README; all of them are optional
     */
    function Sphere(target, options) {
        options = options || {};
        var resolved = resolveCanvas(target, options);
        this.canvas = resolved.canvas;
        this._ownsCanvas = resolved.ownsCanvas;

        this.controller = new SSE.StateController();
        this.renderer = new SSE.Renderer(this.canvas, this.controller, this);

        this._callback = {
            onHidden: options.onHidden || null,
            onGpuUnavailable: options.onGpuUnavailable || null
        };
        this._disposed = false;
        this._hostPaused = false;
        this._shown = true;
        this._pumping = false;
        this._visible = !root.document || !root.document.hidden;
        this._onscreen = true;
        this._rafId = 0;
        this._t0 = -1;
        this._lastFrameMs = -1e9;
        this._minFrameMs = 1000 / 60;
        this._frames = 0;
        this._fpsWindowMs = 0;
        this.fps = 0;
        this._devicePixels = options.devicePixels === true || !isCssSized(this.canvas);

        // ---- apply the options through the public API (single code path) ----
        this.renderer.init();
        if (options.palette !== undefined) this.setPalette(options.palette);
        if (options.orbSize !== undefined) this.setOrbSize(options.orbSize);
        if (options.orbOffset !== undefined) this.setOrbOffset(options.orbOffset[0], options.orbOffset[1]);
        if (options.renderScale !== undefined) this.setRenderScale(options.renderScale);
        if (options.pixelRatio !== undefined) this.setPixelRatio(options.pixelRatio);
        if (options.maxFps !== undefined) this.setMaxFps(options.maxFps);
        if (options.debugGlErrors !== undefined) this.setDebugGlErrors(options.debugGlErrors);
        if (options.audio !== undefined) this.setAudioAmplitude(options.audio);
        if (options.state !== undefined) this.setState(options.state);
        if (options.backdrop) {
            this.setBackdrop(options.backdrop, options.backdropDynamic === true);
            this.setBackdropDim(options.backdropDim === undefined ? 1 : options.backdropDim);
        }
        if (options.islandPill) this.setIslandPill(options.islandPill[0], options.islandPill[1], options.islandPill[2], options.islandPill[3]);
        if (options.islandTransition !== undefined) this.setIslandTransition(options.islandTransition);

        // ---- layout / lifecycle observers ----
        var self = this;
        this._onWindowResize = function () { self.remeasure(); };
        this._onVisibilityChange = function () {
            self._visible = !root.document.hidden;
            self._updatePump();
        };
        if (root.addEventListener) {
            root.addEventListener('resize', this._onWindowResize, false);
            root.addEventListener('orientationchange', this._onWindowResize, false);
        }
        if (root.document && root.document.addEventListener) {
            root.document.addEventListener('visibilitychange', this._onVisibilityChange, false);
        }
        if (root.ResizeObserver) {
            this._resizeObserver = new ResizeObserver(function () { self.remeasure(); });
            this._resizeObserver.observe(this._ownsCanvas ? this.canvas.parentNode : this.canvas);
        }
        if (root.IntersectionObserver && options.pauseOffscreen !== false) {
            this._intersectionObserver = new IntersectionObserver(function (entries) {
                self._onscreen = !!(entries[0] && entries[0].isIntersecting);
                self._updatePump();
            }, { threshold: 0 });
            this._intersectionObserver.observe(this.canvas);
        }

        this.remeasure();
        this._updatePump();
    }

    // ================================================================== public API
    /** @param {{onHidden?:Function, onGpuUnavailable?:Function}} cb */
    Sphere.prototype.setCallback = function (cb) {
        this._callback = cb || {};
    };

    /** Drive this from the REAL assistant state: 'idle' | 'listening' | 'processing' | 'speaking' | 'error'. */
    Sphere.prototype.setState = function (state) {
        this.controller.setState(state);
        this._requestFrame();
    };
    Sphere.prototype.getState = function () { return this.controller.getState(); };

    /** Real audio level 0..1 (mic while LISTENING, playback while SPEAKING). */
    Sphere.prototype.setAudioAmplitude = function (level) {
        this.controller.setAudioAmplitude(level);
    };

    /** Convenience for SpeechRecognition#onresult/onaudiostart hosts that only have rms dB (-2..10). */
    Sphere.prototype.setAudioFromRmsDb = function (rmsDb) {
        this.controller.setAudioFromRmsDb(rmsDb);
    };

    /** @param {string|Object} palette name ('rainbow', 'warm', 'cool', 'aurora', 'magenta', 'ice') or an object from SiriSphere.Palette.of(). */
    Sphere.prototype.setPalette = function (palette) {
        this.controller.setPalette(typeof palette === 'string' ? SSE.Palette.byName(palette) : palette);
    };
    Sphere.prototype.setPaletteRgb = function (c0, c1, c2, c3) {
        this.controller.setPalette(SSE.Palette.of(c0, c1, c2, c3));
    };

    /** Multiplier on the state's wave speed (1 = default). */
    Sphere.prototype.setSpeed = function (multiplier) { this.controller.setSpeed(multiplier); };
    /** Multiplier on the state's wave frequency (1 = default). */
    Sphere.prototype.setWaviness = function (multiplier) { this.controller.setWaviness(multiplier); };
    /** Multiplier on the state's wave height (1 = default). */
    Sphere.prototype.setAmplitude = function (multiplier) { this.controller.setAmplitude(multiplier); };
    /** 1 = round sphere, 0 = capsule (island-like). Animated. */
    Sphere.prototype.setOrbMode = function (mode) { this.controller.setOrbMode(mode); };
    /** Light gain; 0.38 is the default. */
    Sphere.prototype.setIntensity = function (v) { this.controller.setIntensity(v); };

    /** Sphere diameter as a fraction of min(width, height). Default 0.90. */
    Sphere.prototype.setOrbSize = function (fraction) { this.renderer.setOrbFraction(fraction); };
    /** Shift the sphere inside the canvas, in CSS px (+x right, +y down). */
    Sphere.prototype.setOrbOffset = function (dxCss, dyCss) { this.renderer.setOffsetPx(dxCss, dyCss); };
    /** Ribbon texture resolution factor 0.25..1 (lower = cheaper). Default 0.75. */
    Sphere.prototype.setRenderScale = function (scale) { this.renderer.setRenderScale(scale); };
    /** Canvas device pixels per CSS pixel, capped at this value. Default 2. */
    Sphere.prototype.setPixelRatio = function (ratio) { this.renderer.setPixelRatio(ratio); this.remeasure(); };
    /** Frame-rate cap (e.g. 30 / 60 / 90). 0 = uncapped. Default 60. */
    Sphere.prototype.setMaxFps = function (fps) {
        this._minFrameMs = fps > 0 ? 1000 / SSE.clamp(fps, 1, 240) : 0;
    };
    Sphere.prototype.setDebugGlErrors = function (enabled) { this.renderer.setDebugGlErrors(enabled); };

    /**
     * Optional liquid refraction. `source` is anything drawable: <img>, <canvas>, <video>,
     * ImageBitmap, OffscreenCanvas, or a URL string (loaded for you).
     * The source is painted canvas-sized inside the canvas ("cover" fit) and then sampled by
     * glass.frag, which is the web equivalent of SiriSphereView#setBackdropBitmap.
     * @param {CanvasImageSource|string|null} source
     * @param {boolean=} dynamic true = re-upload every frame (live canvas / video)
     */
    Sphere.prototype.setBackdrop = function (source, dynamic) {
        var self = this;
        if (typeof source === 'string') {
            var img = new root.Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () {
                if (!self._disposed && self._backdropUrl === source) {
                    self.renderer.setBackdropSource(img);
                    self.renderer.setBackdropDynamic(false);
                    self._requestFrame();
                }
            };
            img.onerror = function () { SSE.warn('backdrop image failed to load: ' + source); };
            this._backdropUrl = source;
            img.src = source;
            return;
        }
        this._backdropUrl = null;
        this.renderer.setBackdropSource(source || null);
        this.renderer.setBackdropDynamic(!!dynamic);
        this.renderer.setRealLiquid(!!source);
        this._requestFrame();
    };
    /** Re-upload the current backdrop source on the next frame (for hand-painted canvases). */
    Sphere.prototype.invalidateBackdrop = function () {
        if (this.renderer.backdrop) this.renderer.backdrop.invalidate();
    };
    /** 1 = unchanged, 0.5 = darker; a darker backdrop makes the glass rim read better. */
    Sphere.prototype.setBackdropDim = function (v) { if (this.renderer.backdrop) this.renderer.backdrop.setDim(v); };
    /** Refraction strength (dp-like scale, ~1). Defaults to devicePixelRatio * 0.4. */
    Sphere.prototype.setBackdropDensity = function (v) { this.renderer.setBackdropDensity(v); };
    /** Refraction on/off without dropping the backdrop source. */
    Sphere.prototype.setRealLiquid = function (v) { this.renderer.setRealLiquid(v); };

    /**
     * Enables the Dynamic-Island hand-off: show() grows a black island pill into the glass sphere
     * (0.6 s, slight overshoot) and hide() shrinks it back (0.42 s). The canvas must be large enough
     * to contain the full sphere; place it over the island and call setIslandPill().
     */
    Sphere.prototype.setIslandTransition = function (enabled) { this.controller.setTransition(enabled); };
    /** Island pill rectangle in CSS px relative to the canvas: size and centre (any value &lt; 0 = default). */
    Sphere.prototype.setIslandPill = function (widthCss, heightCss, centerXCss, centerYCss) {
        this.renderer.setIslandPill(widthCss, heightCss, centerXCss, centerYCss);
    };

    /** Fade/scale in (420 ms) - or island transition when enabled - and start rendering. */
    Sphere.prototype.show = function () {
        if (this._disposed) return;
        this._shown = true;
        this.controller.setVisibleTarget(true);
        this._updatePump();
    };

    /** Fade/scale out (420 ms); rendering stops automatically afterwards. */
    Sphere.prototype.hide = function () {
        if (this._disposed) return;
        this.controller.setVisibleTarget(false);
        this._requestFrame();
    };

    Sphere.prototype.isVisible = function () { return this.controller.isVisibleTarget() && !this._disposed; };

    /** Host pausing (page navigation, modal, background work): stops the frame pump. */
    Sphere.prototype.pause = function () { this._hostPaused = true; this._updatePump(); };
    Sphere.prototype.resume = function () { this._hostPaused = false; this._updatePump(); };
    Sphere.prototype.onPause = Sphere.prototype.pause;      // Android naming
    Sphere.prototype.onResume = Sphere.prototype.resume;

    /** Re-reads the canvas box (CSS size + devicePixelRatio) and re-creates the GL targets if needed. */
    Sphere.prototype.remeasure = function () {
        if (this._disposed) return;
        var c = this.canvas;
        if (this._devicePixels) {
            this.renderer.resize(c.width || 1, c.height || 1, 1);
            return;
        }
        var w = c.clientWidth, h = c.clientHeight;
        if (!(w > 0) || !(h > 0)) {
            var box = c.getBoundingClientRect();
            w = box.width; h = box.height;
        }
        if (w > 0 && h > 0) this.renderer.resize(w, h);
    };

    /** Releases the GL resources and stops the pump. The canvas element itself stays in the DOM. */
    Sphere.prototype.dispose = function () {
        if (this._disposed) return;
        this._disposed = true;
        this._stopPump();
        this._callback = {};
        var self = this;
        if (root.removeEventListener) {
            root.removeEventListener('resize', this._onWindowResize, false);
            root.removeEventListener('orientationchange', this._onWindowResize, false);
        }
        if (root.document && root.document.removeEventListener) {
            root.document.removeEventListener('visibilitychange', this._onVisibilityChange, false);
        }
        if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
        if (this._intersectionObserver) { this._intersectionObserver.disconnect(); this._intersectionObserver = null; }
        if (this._ownsCanvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
        // Free the context on the next frame so a running draw cannot use half-deleted objects.
        if (root.requestAnimationFrame) {
            root.requestAnimationFrame(function () { self.renderer.release(); });
        } else {
            this.renderer.release();
        }
    };

    // ================================================================== frame pump
    Sphere.prototype._updatePump = function () {
        var run = !this._disposed && !this._hostPaused && this._visible && this._onscreen && this._shown;
        if (run && !this._pumping) this._startPump();
        else if (!run && this._pumping) this._stopPump();
    };

    Sphere.prototype._startPump = function () {
        if (this._pumping) return;
        if (!root.requestAnimationFrame) return;
        this._pumping = true;
        this._t0 = -1;
        this._lastFrameMs = -1e9;
        this._boundFrame = this._boundFrame || this._frame.bind(this);
        this._rafId = root.requestAnimationFrame(this._boundFrame);
    };

    Sphere.prototype._stopPump = function () {
        if (!this._pumping) return;
        this._pumping = false;
        if (root.cancelAnimationFrame && this._rafId) root.cancelAnimationFrame(this._rafId);
        this._rafId = 0;
    };

    /** Wake the pump for one fade-out step even while `_shown` is already false. */
    Sphere.prototype._requestFrame = function () {
        if (this._pumping) return;
        if (!this._disposed && !this._hostPaused && this._visible && this._onscreen && !this.controller.isVisibleTarget()) {
            this._startPump();                       // closing animation needs frames until onHideCompleted
        } else {
            this._updatePump();
        }
    };

    Sphere.prototype._frame = function (tsMs) {
        if (!this._pumping) return;
        this._frames++;
        if (this._t0 < 0) { this._t0 = tsMs; }
        var due = this._minFrameMs <= 0 || (tsMs - this._lastFrameMs) >= (this._minFrameMs - 1);
        if (due) {
            this._lastFrameMs = tsMs;
            this.remeasure();
            this.renderer.render((tsMs - this._t0) / 1000);
        }
        if (this._fpsWindowMs === 0) this._fpsWindowMs = tsMs;      // start the window at the first frame
        if (tsMs - this._fpsWindowMs >= 1000) {
            this.fps = this._frames * 1000 / (tsMs - this._fpsWindowMs);
            this._frames = 0;
            this._fpsWindowMs = tsMs;
        }
        this._rafId = root.requestAnimationFrame(this._boundFrame);
    };

    // ================================================================== renderer callbacks (main thread)
    Sphere.prototype.onHideCompleted = function () {
        if (this._disposed || this.controller.isVisibleTarget()) return;   // show() was called again meanwhile
        this._shown = false;
        this._stopPump();
        var cb = this._callback || {};
        if (cb.onHidden) cb.onHidden();
    };

    Sphere.prototype.onGpuError = function (message) {
        SSE.error('GPU unavailable: ' + message);
        this._stopPump();
        var cb = this._callback || {};
        if (cb.onGpuUnavailable) cb.onGpuUnavailable(message);
    };

    Sphere.SHADER_SOURCE_DIR = 'siri-sphere/src/main/assets/siri_sphere/';
    SSE.Sphere = Sphere;
})(window);
