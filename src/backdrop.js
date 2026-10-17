/*!
 * SiriSphere — web port. Step 7/9: optional backdrop for the "liquid" refraction.
 *
 * Android captures a blurred bitmap of what is behind the sphere (SiriSphereView#setBackdropBitmap).
 * Browsers cannot read the page behind a canvas, so the web port offers the two things a page can
 * actually provide:
 *   - a CanvasImageSource  (image / <canvas> / <video> / ImageBitmap / OffscreenCanvas) that is
 *     painted inside the canvas, canvas-sized, "cover"-fitted, and then sampled by glass.frag;
 *   - nothing at all, in which case the transparent canvas simply lets the page/DOM show through
 *     (that keeps the premultiplied-alpha behaviour of the Android surface).
 *
 * The painter renders into its own FBO; SiriSphere.Renderer blits that FBO onto the canvas before
 * the glass pass so the backdrop is both visible *and* available to the refraction shader.
 */
(function (root) {
    'use strict';

    var SSE = root.SiriSphere;

    var PAINT_FRAG = [
        '#version 300 es',
        'precision highp float;',
        'uniform vec2      uSize;        // destination size in px',
        'uniform vec2      uSourceSize;  // source size in px',
        'uniform float     uDim;         // 1 = unchanged, <1 darkens the backdrop',
        'uniform sampler2D uSource;',
        'out vec4 fragColor;',
        'void main() {',
        '    float s = max(uSize.x / max(uSourceSize.x, 1.0), uSize.y / max(uSourceSize.y, 1.0));',
        '    vec2 fitted = uSourceSize * s;',
        '    vec2 uv = (gl_FragCoord.xy - 0.5 * (uSize - fitted)) / max(fitted, vec2(1.0));',
        '    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {',
        '        fragColor = vec4(0.02, 0.02, 0.03, 1.0);   // letterbox bars',
        '        return;',
        '    }',
        '    fragColor = vec4(texture(uSource, uv).rgb * uDim, 1.0);',
        '}'
    ].join('\n');

    function Backdrop(gl) {
        this.gl = gl;
        this.program = SSE.gl.program(gl, SSE.Shaders.sphereVert, PAINT_FRAG, 'backdrop');
        this.quad = SSE.gl.triangleStripQuad(gl);
        this.loc = SSE.gl.uniformLocator(gl);
        this.sourceTex = SSE.gl.texture(gl, gl.LINEAR);
        this.source = null;
        this.sourceW = 1;
        this.sourceH = 1;
        this.dim = 1;
        this.dynamic = false;          // re-upload every frame (live canvas / video)
        this.dirty = false;
        this.ready = false;
        this.fbo = null;
        this.fboTex = null;
        this.fboW = 0;
        this.fboH = 0;
    }

    /** @param {CanvasImageSource|null} source any drawable source; null disables the backdrop. */
    Backdrop.prototype.setSource = function (source) {
        this.source = source || null;
        this.dirty = !!source;
        this.ready = false;
        if (!source) this.dim = 1;
    };

    /** @param {boolean} v true: re-upload `source` on every frame. */
    Backdrop.prototype.setDynamic = function (v) {
        this.dynamic = !!v;
        if (this.dynamic) this.dirty = true;
    };

    /** @param {number} v 1 = unchanged, 0.5 = darker (helps the orb stand out). */
    Backdrop.prototype.setDim = function (v) { this.dim = SSE.clamp(+v, 0, 2); };

    Backdrop.prototype.invalidate = function () { this.dirty = true; };

    Backdrop.prototype.sourceSize = function () {
        var s = this.source;
        if (!s) return [1, 1];
        return [s.videoWidth || s.naturalWidth || s.width || 1,
                s.videoHeight || s.naturalHeight || s.height || 1];
    };

    /** @return {boolean} true when the backdrop FBO holds a valid image for this frame. */
    Backdrop.prototype.draw = function (w, h) {
        var gl = this.gl;
        if (!this.source) { this.ready = false; return false; }

        if (this.dirty || this.dynamic) {
            var size = this.sourceSize();
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);      // image top-left -> GL bottom-left
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
            try {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.source);
            } catch (e) {
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                this.source = null;
                this.ready = false;
                return false;                                   // e.g. tainted canvas / not loaded yet
            }
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            this.sourceW = Math.max(1, size[0]);
            this.sourceH = Math.max(1, size[1]);
            this.dirty = false;
            this.ready = true;
        }
        if (!this.ready) return false;

        if (!this.fbo || this.fboW !== w || this.fboH !== h) {
            if (this.fboTex) gl.deleteTexture(this.fboTex);
            if (this.fbo) gl.deleteFramebuffer(this.fbo);
            this.fboTex = SSE.gl.texture(gl, gl.NEAREST);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            this.fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                this.dispose();
                throw new SSE.GpuError('backdrop framebuffer is incomplete');
            }
            this.fboW = w; this.fboH = h;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.viewport(0, 0, w, h);
        gl.useProgram(this.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
        var l = this.loc, key = this.program;
        gl.uniform1i(l(key, 'uSource'), 0);
        gl.uniform2f(l(key, 'uSize'), w, h);
        gl.uniform2f(l(key, 'uSourceSize'), this.sourceW, this.sourceH);
        gl.uniform1f(l(key, 'uDim'), this.dim);
        SSE.gl.drawQuad(gl, this.quad);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return true;
    };

    /** Blits the painted backdrop onto the current draw buffer (full canvas). */
    Backdrop.prototype.blitTo = function (w, h) {
        var gl = this.gl;
        if (!this.ready || !this.fbo) return;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        gl.blitFramebuffer(0, 0, this.fboW, this.fboH, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    };

    Backdrop.prototype.dispose = function () {
        var gl = this.gl;
        if (this.fbo) { gl.deleteFramebuffer(this.fbo); this.fbo = null; }
        if (this.fboTex) { gl.deleteTexture(this.fboTex); this.fboTex = null; }
        if (this.sourceTex) { gl.deleteTexture(this.sourceTex); this.sourceTex = null; }
        if (this.program) { gl.deleteProgram(this.program); this.program = null; }
        if (this.quad) { gl.deleteBuffer(this.quad); this.quad = null; }
        this.ready = false;
        this.fboW = this.fboH = 0;
    };

    SSE.Backdrop = Backdrop;
})(window);
