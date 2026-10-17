/*!
 * SiriSphere — web port. Step 3/9: palettes (port of SiriPalette.java).
 *
 * Four colours as linear 0..1 RGB, flattened into a 12-float array exactly like the
 * Android version, so the same uniform upload code works unchanged.
 */
(function (root) {
    'use strict';

    var SSE = root.SiriSphere;

    function of(c0, c1, c2, c3) {
        var values = [c0, c1, c2, c3];
        var palette = { c: new Float32Array(12), name: null };
        for (var i = 0; i < 4; i++) {
            var rgb = SSE.rgbFromHex(values[i]);
            palette.c[i * 3] = rgb[0];
            palette.c[i * 3 + 1] = rgb[1];
            palette.c[i * 3 + 2] = rgb[2];
        }
        return palette;
    }

    var Palette = {
        RAINBOW: of(0x198cff, 0x6adcc0, 0xff6c53, 0xa94dff),
        WARM: of(0xffc62b, 0xff7630, 0xff3957, 0xffbd42),
        COOL: of(0x16d5f2, 0x4869f9, 0xa641ff, 0x38d2ff),
        AURORA: of(0x28f0b2, 0x46afff, 0xb557ff, 0x28f0b2),
        MAGENTA: of(0xff48cb, 0x9a75ff, 0x36d9fd, 0x45e3a2),
        ICE: of(0xd9ff00, 0x8eff00, 0x01ff59, 0x00ffa8),
        /** Used internally by the ERROR state. */
        ERROR_RED: of(0xff3b30, 0xff6a4d, 0xff2d55, 0xff9500),
        /** @param {number} c0..c3 four colours as 0xRRGGBB (alpha ignored). */
        of: of,
        /** @param {Array} colors [[r,g,b],[r,g,b],[r,g,b],[r,g,b]] with floats 0..1. */
        fromArray: function (colors) {
            var palette = { c: new Float32Array(12), name: null };
            for (var i = 0; i < 4; i++) {
                var rgb = colors[i] || [1, 1, 1];
                palette.c[i * 3] = SSE.clamp(+rgb[0] || 0, 0, 1);
                palette.c[i * 3 + 1] = SSE.clamp(+rgb[1] || 0, 0, 1);
                palette.c[i * 3 + 2] = SSE.clamp(+rgb[2] || 0, 0, 1);
            }
            return palette;
        },
        /** @return {object} preset by name (see {@link Palette.NAMES}); RAINBOW when unknown. */
        byName: function (name) {
            if (typeof name !== 'string') return Palette.RAINBOW;
            var up = name.trim().toUpperCase();
            return (Object.prototype.hasOwnProperty.call(Palette, up) && Palette[up] && Palette[up].c)
                ? Palette[up] : Palette.RAINBOW;
        }
    };

    Palette.NAMES = ['rainbow', 'warm', 'cool', 'aurora', 'magenta', 'ice'];

    SSE.Palette = Palette;
})(window);
