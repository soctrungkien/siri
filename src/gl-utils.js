/*!
 * SiriSphere — web port. Step 6/9: tiny WebGL2 helpers (the equivalent of the
 * compile/link/texture boilerplate inside SiriSphereRenderer.java).
 */
(function (root) {
    'use strict';

    var SSE = root.SiriSphere;

    /** Thrown when the GL setup cannot run; hosts should show their fallback UI. */
    function GpuError(message) {
        this.name = 'GpuError';
        this.message = message;
        this.stack = (new Error(message)).stack;
    }
    GpuError.prototype = Object.create(Error.prototype);
    GpuError.prototype.constructor = GpuError;

    function compile(gl, type, source, label) {
        var shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            var log = gl.getShaderInfoLog(shader) || '(no log)';
            gl.deleteShader(shader);
            throw new GpuError(label + ' shader: ' + log);
        }
        return shader;
    }

    /** Compiles + links a program and returns it. `layout(location = 0)` is the shared quad attribute. */
    function program(gl, vertexSource, fragmentSource, label) {
        var vs = compile(gl, gl.VERTEX_SHADER, vertexSource, label + ' vertex');
        var fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource, label + ' fragment');
        var prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.bindAttribLocation(prog, 0, 'aPosition');
        gl.linkProgram(prog);
        var ok = gl.getProgramParameter(prog, gl.LINK_STATUS);
        var log = ok ? null : (gl.getProgramInfoLog(prog) || '(no log)');
        gl.detachShader(prog, vs); gl.deleteShader(vs);
        gl.detachShader(prog, fs); gl.deleteShader(fs);
        if (!ok) { gl.deleteProgram(prog); throw new GpuError(label + ' link: ' + log); }
        return prog;
    }

    function triangleStripQuad(gl) {
        var vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        return vbo;
    }

    function drawQuad(gl, vbo) {
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disableVertexAttribArray(0);
    }

    /** A 2D texture with CLAMP_TO_EDGE wrapping and the given filter. */
    function texture(gl, filter) {
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    }

    /**
     * gl.getUniformLocation with a WebGLProgram -> (name -> location) cache
     * (mirrors SiriSphereRenderer.loc()). Locations optimised out resolve to null,
     * which gl.uniform* silently ignores.
     * @return {function(WebGLProgram, string): (WebGLUniformLocation|null)}
     */
    function uniformLocator(gl) {
        var byProgram = new WeakMap();
        return function (prog, name) {
            var cache = byProgram.get(prog);
            if (!cache) { cache = Object.create(null); byProgram.set(prog, cache); }
            var loc = cache[name];
            if (loc === undefined) {
                loc = gl.getUniformLocation(prog, name);
                cache[name] = loc;
            }
            return loc;
        };
    }

    /** True when a float/half-float render target can be created (the Android LDR fallback). */
    function supportsFloatTarget(gl) {
        return !!(gl.getExtension('EXT_color_buffer_float') ||
                  gl.getExtension('EXT_color_buffer_half_float'));
    }

    SSE.GpuError = GpuError;
    SSE.gl = {
        compile: compile,
        program: program,
        triangleStripQuad: triangleStripQuad,
        drawQuad: drawQuad,
        texture: texture,
        uniformLocator: uniformLocator,
        supportsFloatTarget: supportsFloatTarget
    };
})(window);
