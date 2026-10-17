/*!
 * SiriSphere — web port (extra): real microphone levels for the LISTENING state.
 *
 * SiriSphereView#setAudioFromRmsDb exists for Android's SpeechRecognizer; on the web the
 * equivalent is getUserMedia + AnalyserNode. The level never comes from a random generator -
 * exactly like the Android policy, the sphere only reacts to a real signal.
 *
 * <pre>
 *   mic = new SiriSphere.MicAudio({ onLevel: v => sphere.setAudioAmplitude(v) });
 *   button.onclick = () => mic.toggle();          // must be a user gesture (browser policy)
 * </pre>
 */
(function (root) {
    'use strict';

    var SSE = root.SiriSphere;

    var DEFAULTS = {
        minDb: -55,     // RMS dB mapped to 0
        maxDb: -15,     // RMS dB mapped to 1
        gain: 1,        // extra multiplier
        autoGain: true  // normalise against a slowly decaying peak (robust across devices)
    };

    function MicAudio(options) {
        options = options || {};
        this.onLevel = options.onLevel || function () { };
        this.onError = options.onError || function (e) { SSE.warn('microphone: ' + (e && e.message ? e.message : e)); };
        this.onStopped = options.onStopped || function () { };
        this.minDb = options.minDb === undefined ? DEFAULTS.minDb : options.minDb;
        this.maxDb = options.maxDb === undefined ? DEFAULTS.maxDb : options.maxDb;
        this.gain = options.gain === undefined ? DEFAULTS.gain : options.gain;
        this.autoGain = options.autoGain === undefined ? DEFAULTS.autoGain : !!options.autoGain;
        this.running = false;
        this.buffer = null;
        this._peak = 1e-4;
        this._rafId = 0;
        this._boundTick = this._tick.bind(this);
    }

    MicAudio.isSupported = function () {
        return !!(root.navigator && root.navigator.mediaDevices && root.navigator.mediaDevices.getUserMedia &&
                  (root.AudioContext || root.webkitAudioContext));
    };

    /** @return {Promise<boolean>} resolves to true once the mic is live (call it from a user gesture). */
    MicAudio.prototype.start = function () {
        var self = this;
        if (this.running) return Promise.resolve(true);
        if (!MicAudio.isSupported()) return Promise.reject(new Error('getUserMedia is not available'));
        return root.navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }
        }).then(function (stream) {
            var Ctx = root.AudioContext || root.webkitAudioContext;
            self.context = new Ctx();
            self.stream = stream;
            self.source = self.context.createMediaStreamSource(stream);
            self.analyser = self.context.createAnalyser();
            self.analyser.fftSize = 1024;                      // ~21 ms of samples at 48 kHz
            self.buffer = new Float32Array(self.analyser.fftSize);
            self.source.connect(self.analyser);
            self.running = true;
            self._peak = 1e-4;
            self._rafId = root.requestAnimationFrame(self._boundTick);
            return true;
        }).catch(function (e) {
            self.onError(e);
            throw e;
        });
    };

    MicAudio.prototype.stop = function () {
        if (!this.running) return;
        this.running = false;
        if (this._rafId) { root.cancelAnimationFrame(this._rafId); this._rafId = 0; }
        try { if (this.source) this.source.disconnect(); } catch (e) { }
        try { if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { }
        try { if (this.context && this.context.close) this.context.close(); } catch (e) { }
        this.source = this.stream = this.analyser = this.context = null;
        this.onLevel(0);
        this.onStopped();
    };

    MicAudio.prototype.toggle = function () {
        return this.running ? (this.stop(), Promise.resolve(false)) : this.start();
    };

    MicAudio.prototype.setGain = function (v) { this.gain = Math.max(0, +v || 0); };

    /** One analysis step: RMS -> dB -> 0..1 (or peak-normalised when autoGain is on). */
    MicAudio.prototype._tick = function () {
        if (!this.running || !this.analyser) return;
        this.analyser.getFloatTimeDomainData(this.buffer);
        var sum = 0;
        for (var i = 0; i < this.buffer.length; i++) sum += this.buffer[i] * this.buffer[i];
        var rms = Math.sqrt(sum / this.buffer.length);
        var level;
        if (this.autoGain) {
            this._peak = Math.max(this._peak * 0.995, rms * 1.5, 1e-4);     // ~2 s decay at 60 Hz
            level = rms / this._peak;
        } else {
            var db = 20 * Math.log10(Math.max(rms, 1e-6));
            level = (db - this.minDb) / Math.max(1e-3, this.maxDb - this.minDb);
        }
        this.onLevel(SSE.clamp(level * this.gain, 0, 1));
        this._rafId = root.requestAnimationFrame(this._boundTick);
    };

    MicAudio.prototype.dispose = function () {
        this.stop();
        this.onLevel = this.onError = this.onStopped = function () { };
    };

    SSE.MicAudio = MicAudio;
})(window);
