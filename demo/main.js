/*!
 * SiriSphere web demo — UI wiring only. Everything the sphere does lives in src/.
 */
(function () {
    'use strict';

    var SSE = window.SiriSphere;
    var $ = function (id) { return document.getElementById(id); };

    // Any uncaught error ends up in the log panel — this page is also its own diagnostics view.
    window.addEventListener('error', function (event) {
        var message = 'uncaught ' + (event.message || event.error || 'error') +
            (event.lineno ? '  (line ' + event.lineno + ')' : '');
        var el = document.getElementById('log');
        if (el) el.textContent = '✗  ' + message + '\n' + el.textContent;
        else document.title = message;
    });

    // ---------------------------------------------------------------- log + readouts
    var logLines = [];
    function log(line) {
        var stamp = new Date().toLocaleTimeString([], { hour12: false });
        logLines.push(stamp + '  ' + line);
        if (logLines.length > 60) logLines.splice(0, logLines.length - 60);
        $('log').textContent = logLines.join('\n');
        $('log').scrollTop = $('log').scrollHeight;
    }

    var badge = $('badge');
    function setBadge(text) { badge.textContent = text; }

    // ---------------------------------------------------------------- sphere
    var sphere = null;
    var renderer = null;

    try {
        if (!SSE.Renderer.isSupported()) throw new SSE.GpuError('WebGL2 is not available');
        sphere = new SSE.Sphere('#sphere-canvas', {
            orbSize: 0.90,
            palette: 'rainbow',
            state: 'idle',
            renderScale: 0.75,
            islandTransition: false,
            onHidden: function () {
                log('onHidden — fade-out finished, rendering stopped');
                setBadge('hidden');
                setToggleLabel();
                setUiState('idle');
            },
            onGpuUnavailable: function (reason) {
                log('onGpuUnavailable — ' + reason);
                setBadge('gpu error');
                $('fallback').hidden = false;
            }
        });
        renderer = sphere.renderer;
    } catch (e) {
        $('fallback').hidden = false;
        log('init failed — ' + (e && e.message ? e.message : e));
    }

    var island = $('island');
    var canvas = $('sphere-canvas');

    // ---------------------------------------------------------------- helper: island pill geometry
    function syncIslandPill() {
        if (!sphere) return;
        var pill = island.getBoundingClientRect();
        var box = canvas.getBoundingClientRect();
        sphere.setIslandPill(
            pill.width, pill.height,
            pill.left + pill.width / 2 - box.left,
            pill.top + pill.height / 2 - box.top
        );
    }

    // ---------------------------------------------------------------- demo backdrop scene (Canvas2D)
    function createScene(w, h) {
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d');

        function blob(x, y, r, color, alpha) {
            var g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, 'rgba(' + color + ',' + alpha + ')');
            g.addColorStop(1, 'rgba(' + color + ',0)');
            ctx.fillStyle = g;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }

        return {
            canvas: cv,
            /** Paints a fake "app behind the island": cards, a status row, moving lights. */
            paint: function (t) {
                var base = ctx.createLinearGradient(0, 0, w, h);
                base.addColorStop(0, '#141428');
                base.addColorStop(0.5, '#0b0b13');
                base.addColorStop(1, '#1a0f22');
                ctx.fillStyle = base;
                ctx.fillRect(0, 0, w, h);

                blob(w * (0.30 + 0.10 * Math.sin(t * 0.31)), h * (0.62 + 0.12 * Math.cos(t * 0.23)), w * 0.55, '25,140,255', 0.55);
                blob(w * (0.72 + 0.09 * Math.cos(t * 0.21)), h * (0.34 + 0.10 * Math.sin(t * 0.37)), w * 0.45, '106,220,192', 0.45);
                blob(w * (0.52 + 0.14 * Math.sin(t * 0.17 + 1.3)), h * (0.86 + 0.08 * Math.cos(t * 0.29)), w * 0.40, '169,77,255', 0.50);

                // "UI cards" behind the orb: structure makes the lens/refraction readable
                ctx.save();
                ctx.globalAlpha = 0.9;
                for (var i = 0; i < 3; i++) {
                    var cw = w * (0.46 + 0.05 * (i % 2)), ch = h * 0.14;
                    var cx = w * 0.06, cy = h * (0.10 + i * 0.19);
                    ctx.fillStyle = 'rgba(10,10,16,0.72)';
                    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    if (ctx.roundRect) ctx.roundRect(cx, cy, cw, ch, 14); else ctx.rect(cx, cy, cw, ch);
                    ctx.fill(); ctx.stroke();
                    ctx.fillStyle = 'rgba(255,255,255,0.30)';
                    ctx.fillRect(cx + 16, cy + ch * 0.34, cw * (0.34 + 0.10 * Math.sin(t * 0.6 + i)), 6);
                }
                ctx.restore();

                ctx.fillStyle = 'rgba(255,255,255,0.05)';
                for (var x = 0; x < w; x += 32) ctx.fillRect(x, 0, 1, h);
            }
        };
    }

    var scene = createScene(640, 400);
    var stillScene = createScene(640, 400);
    var scenePainting = false;

    function useBackdrop(mode) {
        if (!sphere) return;
        if (mode === 'none') {
            sphere.setBackdrop(null);
        } else if (mode === 'live') {
            sphere.setBackdrop(scene.canvas, true);
            scenePainting = true;
            log('backdrop: live canvas (64 KB texture re-uploaded each frame)');
        } else if (mode === 'still') {
            stillScene.paint(0);
            sphere.setBackdrop(stillScene.canvas, false);
            scenePainting = false;
            log('backdrop: still canvas (uploaded once)');
        } else if (mode === 'image') {
            sphere.setBackdrop('assets/demo-backdrop.svg', false);
            scenePainting = false;
            log('backdrop: assets/demo-backdrop.svg (loaded asynchronously)');
        }
        sphere.setBackdropDim(mode === 'none' ? 1 : 0.9);
    }

    // The 2D scene is only animated while it is actually used.
    (function paintLoop(ts) {
        if (scenePainting && sphere && sphere.isVisible()) scene.paint(ts / 1000);
        requestAnimationFrame(paintLoop);
    })(0);

    // ---------------------------------------------------------------- state buttons
    var stateButtons = Array.prototype.slice.call(document.querySelectorAll('#states button'));

    function setUiState(state) {
        var name = String(state).toLowerCase();
        stateButtons.forEach(function (b) { b.classList.toggle('on', b.dataset.state === name); });
        $('readState').textContent = name.toUpperCase();
        setBadge(name);
    }

    stateButtons.forEach(function (button) {
        button.addEventListener('click', function () {
            if (!sphere) return;
            var state = button.dataset.state;
            if (!sphere.isVisible()) sphere.show();
            sphere.setState(state);
            island.classList.add('open');
            setUiState(state);
            log('setState("' + state + '")');
        });
    });

    // ---------------------------------------------------------------- show / hide / scripted turn
    function setToggleLabel() {
        $('toggle').textContent = (sphere && sphere.isVisible()) ? 'Hide sphere' : 'Show sphere';
        island.classList.toggle('open', !!sphere && sphere.isVisible());
    }

    $('toggle').addEventListener('click', function () {
        if (!sphere) return;
        if (sphere.isVisible()) {
            sphere.hide();
            log('hide() — ' + (sphere.controller.transition ? 'island shrinks back (0.42 s)' : 'fade out (0.42 s)'));
        } else {
            sphere.show();
            log('show() — ' + (sphere.controller.transition ? 'island grows into the orb (0.6 s)' : 'fade in (0.42 s)'));
        }
        setToggleLabel();
    });

    var turnRunning = false;
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function scriptedTurn() {
        if (!sphere || turnRunning) return;
        turnRunning = true;
        gestures && gestures.setEnabled(false);
        log('scripted turn: show → listening → processing → speaking → hide');
        sphere.show();
        island.classList.add('open');

        sphere.setState('listening'); setUiState('listening');
        sleep(2600).then(function () {
            sphere.setState('processing'); setUiState('processing');
            return sleep(2000);
        }).then(function () {
            sphere.setState('speaking'); setUiState('speaking');
            return sleep(2800);
        }).then(function () {
            sphere.hide();
            turnRunning = false;
            gestures && gestures.setEnabled(true);
        })['catch'](function (e) {
            turnRunning = false;
            gestures && gestures.setEnabled(true);
            log('scripted turn failed — ' + (e && e.message ? e.message : e));
        });
    }
    $('playScript').addEventListener('click', scriptedTurn);

    // ---------------------------------------------------------------- audio
    var audioSlider = $('audio');
    audioSlider.addEventListener('input', function () {
        if (!sphere) return;
        sphere.setAudioAmplitude(audioSlider.value / 100);
        $('audioOut').textContent = audioSlider.value + '%';
    });

    var mic = null;
    var micButton = $('mic');
    micButton.addEventListener('click', function () {
        if (!sphere) return;
        if (mic && mic.running) {
            mic.stop();
            return;
        }
        if (!SSE.MicAudio.isSupported()) {
            log('microphone: getUserMedia is not available in this browser');
            return;
        }
        mic = mic || new SSE.MicAudio({
            onLevel: function (level) {
                sphere.setAudioAmplitude(level);
                audioSlider.value = Math.round(level * 100);
                $('audioOut').textContent = Math.round(level * 100) + '%';
            },
            onError: function (e) { log('microphone error — ' + (e && e.message ? e.message : e)); },
            onStopped: function () {
                micButton.textContent = 'Enable microphone';
                micButton.classList.remove('on');
                audioSlider.disabled = false;
                log('microphone off');
            }
        });
        mic.start().then(function () {
            micButton.textContent = 'Microphone on (real levels)';
            micButton.classList.add('on');
            audioSlider.disabled = true;
            log('microphone on — levels drive the LISTENING/SPEAKING waves');
        })['catch'](function () { /* errors are reported by onError */ });
    });

    // ---------------------------------------------------------------- look sliders
    function bindRange(id, outId, format, apply) {
        var input = $(id), out = $(outId);
        function update() {
            var value = +input.value;
            apply(value);
            out.textContent = format(value);
        }
        input.addEventListener('input', update);
        update();
    }

    if (sphere) {
        bindRange('orbMode', 'orbModeOut', function (v) { return v + '%'; }, function (v) { sphere.setOrbMode(v / 100); });
        bindRange('orbSize', 'orbSizeOut', function (v) { return v + '%'; }, function (v) { sphere.setOrbSize(v / 100); });
        bindRange('intensity', 'intensityOut', function (v) { return (v / 100).toFixed(2); }, function (v) { sphere.setIntensity(v / 100); });
        bindRange('speed', 'speedOut', function (v) { return (v / 100).toFixed(1) + '×'; }, function (v) { sphere.setSpeed(v / 100); });
        bindRange('waviness', 'wavinessOut', function (v) { return (v / 100).toFixed(1) + '×'; }, function (v) { sphere.setWaviness(v / 100); });
        bindRange('amplitude', 'amplitudeOut', function (v) { return (v / 100).toFixed(1) + '×'; }, function (v) { sphere.setAmplitude(v / 100); });
        bindRange('renderScale', 'renderScaleOut', function (v) { return v + '%'; }, function (v) { sphere.setRenderScale(v / 100); });
        bindRange('pixelRatio', 'pixelRatioOut', function (v) { return '≤' + v; }, function (v) { sphere.setPixelRatio(v); });

        $('palette').addEventListener('change', function () {
            sphere.setPalette(this.value);
            log('setPalette("' + this.value + '")');
        });

        $('maxFps').addEventListener('change', function () { sphere.setMaxFps(+this.value); });

        $('islandTransition').addEventListener('change', function () {
            sphere.setIslandTransition(this.checked);
            syncIslandPill();
            log('setIslandTransition(' + this.checked + ')');
        });

        $('backdrop').addEventListener('change', function () { useBackdrop(this.value); });

        $('debugGl').addEventListener('change', function () {
            sphere.setDebugGlErrors(this.checked);
            SSE.logLevel = this.checked ? 2 : 1;
        });
    }

    // ---------------------------------------------------------------- gestures on the island
    var gestures = null;
    if (sphere) {
        gestures = new SSE.TriggerGestures(island, function (trigger) {
            log('gesture ' + trigger + (sphere.isVisible() ? ' → hide()' : ' → scriptedTurn()'));
            if (sphere.isVisible()) sphere.hide();
            else scriptedTurn();
        });
        $('gestures').addEventListener('change', function () {
            gestures.setEnabled(this.checked);
        });
        gestures.setEnabled($('gestures').checked);
        gestures.attach();
    }

    // ---------------------------------------------------------------- layout + readouts
    function relayout() {
        if (!sphere) return;
        sphere.remeasure();
        syncIslandPill();
    }
    window.addEventListener('resize', relayout);
    if (window.ResizeObserver) {
        var ro = new ResizeObserver(relayout);
        ro.observe($('stage'));
        ro.observe(island);
    }

    setInterval(function () {
        if (!sphere) return;
        $('readFps').textContent = sphere.fps ? sphere.fps.toFixed(0) : '—';
        $('readAudio').textContent = sphere.renderer.params.audio.toFixed(2);
        $('readGl').textContent = sphere.renderer.ldr ? 'RGBA8 + LDR' : 'RGBA16F';
    }, 250);

    $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('version').textContent = SSE.VERSION;
    $('shaderHash').textContent = SSE.Shaders.hash;

    // ---------------------------------------------------------------- URL parameters
    // ?state=speaking&palette=warm&transition=1&size=0.8&backdrop=none&capsule=0.5&audio=0.6
    function setSliderFromUrl(id, rawValue) {
        var input = $(id);
        input.value = String(rawValue);
        input.dispatchEvent(new Event('input'));      // the range bindings apply it and refresh the label
    }

    function applyUrlParams() {
        if (!sphere || !window.URLSearchParams) return;
        var q = new URLSearchParams(window.location.search);
        var applied = [];

        if (q.has('transition')) {
            var on = q.get('transition') !== '0';
            $('islandTransition').checked = on;
            sphere.setIslandTransition(on);
            applied.push('transition=' + on);
        }
        if (q.has('palette')) { $('palette').value = q.get('palette'); sphere.setPalette(q.get('palette')); applied.push('palette=' + q.get('palette')); }
        if (q.has('backdrop')) { $('backdrop').value = q.get('backdrop'); useBackdrop(q.get('backdrop')); applied.push('backdrop=' + q.get('backdrop')); }
        if (q.has('size')) { setSliderFromUrl('orbSize', q.get('size') * 100); applied.push('size=' + q.get('size')); }
        if (q.has('capsule')) { setSliderFromUrl('orbMode', q.get('capsule') * 100); applied.push('capsule=' + q.get('capsule')); }
        if (q.has('intensity')) { setSliderFromUrl('intensity', q.get('intensity') * 100); applied.push('intensity=' + q.get('intensity')); }
        if (q.has('audio')) { setSliderFromUrl('audio', q.get('audio') * 100); applied.push('audio=' + q.get('audio')); }
        if (q.has('fps')) { $('maxFps').value = q.get('fps'); sphere.setMaxFps(+q.get('fps')); applied.push('fps=' + q.get('fps')); }
        if (q.has('state')) {
            var state = SSE.State.parse(q.get('state'));
            if (state) { sphere.setState(state); setUiState(state); applied.push('state=' + state); }
        }
        if (applied.length) log('url params: ' + applied.join(' '));
    }

    // ---------------------------------------------------------------- boot
    if (sphere) {
        useBackdrop($('backdrop').value);
        syncIslandPill();
        sphere.remeasure();
        sphere.show();
        sphere.setState('idle');
        island.classList.add('open');
        log('SiriSphere web ' + SSE.VERSION + ' — shaders ' + SSE.Shaders.hash);
        log('renderer: ' + (sphere.renderer.ldr ? 'RGBA16F unavailable → RGBA8 + LDR compression' : 'RGBA16F intermediate target'));
        log('island pill handed to the shader: ' + JSON.stringify({
            w: Math.round(island.getBoundingClientRect().width),
            h: Math.round(island.getBoundingClientRect().height)
        }));
        applyUrlParams();
        syncIslandPill();
        log('ready — double-tap the island, or press "Play scripted turn"');
    }
})();
