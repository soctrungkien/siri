# SiriSphere — bản web (WebGL2)

Bản **port sang web** của module Android `:siri-sphere`: cùng quả cầu Siri, cùng state machine,
**cùng nguyên văn shader GLSL ES 3.00** (WebGL2 dùng đúng GLSL ES 3.00), không phụ thuộc thư viện
nào — chỉ HTML + JS thuần.

```
web/
  index.html               trang demo (dev: nạp từng file trong src/)
  styles.css               giao diện trang demo
  src/
    core.js                namespace, đồng hồ, clamp/step/easeOutBack, amplitudeFromRmsDb
    state.js               SiriState  (IDLE · LISTENING · PROCESSING · SPEAKING · ERROR)
    palette.js             SiriPalette (rainbow/warm/cool/aurora/magenta/ice + ERROR_RED)
    params.js              SiriSphereParams (giá trị mặc định y như bản Java)
    state-controller.js    SiriStateController (state machine + làm mượt + show/hide)
    gl-utils.js            compile/link/quad/texture + bộ nhớ đệm uniform
    backdrop.js            "nền" tuỳ chọn: ảnh/canvas/video → texture để khúc xạ
    renderer.js            2 pass WebGL2 (ribbon → FBO, glass → canvas)
    sphere.js              API công khai (tương đương SiriSphereView)
    gestures.js            double-tap / long-press (tương đương SiriTriggerGestures)
    mic.js                 mic thật qua getUserMedia + AnalyserNode
    shaders.generated.js   AUTO-GENERATED từ assets shader của module Android
  demo/main.js             nối giao diện demo với API
  assets/demo-backdrop.svg ảnh nền mẫu cho chế độ khúc xạ "image"
  tools/
    sync-shaders.mjs       Android assets → src/shaders.generated.js (+ --check cho CI)
    test.mjs               chạy test logic bằng node (không cần GPU)
    tests.js               46 test (port từ tools/jvmtest ControllerTest.java + test web)
    build.mjs              web/ → web/dist/ (gộp 1 file, không cần bundler)
    smoke.mjs              test thật trên Chrome/Edge headless (biên dịch GLSL + đọc pixel)
    smoke.html             trang test (được copy vào dist/smoke.html)
    serve.mjs              server tĩnh để phát triển (không phụ thuộc)
    static-server.mjs      server dùng chung cho serve.mjs và smoke.mjs
```

## Chạy thử

> Lệnh dưới đây chạy từ thư mục gốc của repo này (`node tools/...`).
> Nếu thư mục `web/` nằm trong SiriSphere monorepo (cạnh `siri-sphere/`), thêm tiền tố `web/`: `node web/tools/...`.

```sh
# 1) xem ngay (dev): mở trực tiếp index.html, hoặc nên dùng server để demo mic hoạt động
node tools/serve.mjs                 # http://localhost:8123

# 2) bản đã build (giống hệt bản deploy)
node tools/build.mjs --clean
node tools/serve.mjs --dist          # http://localhost:8123
```

Trang demo có: 5 nút trạng thái, 6 bảng màu, thanh âm lượng + **mic thật**, con trượt
sphere↔capsule, kích thước/độ sáng/tốc độ/độ gợn/biên độ, chế độ chuyển đảo (island),
lựa chọn nền khúc xạ, giới hạn fps, pixel ratio, và nhật ký runtime.
Tham số URL để mở sẵn một cấu hình:

```
?state=speaking&palette=warm&transition=1&backdrop=live&size=0.8&capsule=0.5&audio=0.6&fps=60
```

## Dùng trong code

```js
// <div id="stage"></div>  hoặc  <canvas id="canvas"></canvas>
const sphere = new SiriSphere.Sphere('#stage', { orbSize: 0.9, palette: 'rainbow' });

sphere.show();                       // hiện (420 ms) — hoặc bùng từ đảo nếu bật island
sphere.setState('listening');        // 1:1 với trạng thái Siri THẬT của bạn
sphere.setAudioAmplitude(level);     // 0..1 tín hiệu THẬT (mic lúc nghe, TTS lúc nói)
sphere.hide();                       // ẩn; tự dừng vòng lặp vẽ khi xong
sphere.dispose();                    // khi gỡ trang
```

## API (đối chiếu với bản Android)

| Nhóm | Web | Android |
|---|---|---|
| Khởi tạo | `new SiriSphere.Sphere(target, options)` | `new SiriSphereView(ctx)` |
| Vòng đời | `show()` `hide()` `dispose()` `pause()` `resume()` `isVisible()` | `show()` `hide()` `dispose()` `onResume()` `onPause()` `isSphereVisible()` |
| Trạng thái | `setState('idle'\|'listening'\|...)` `getState()` | `setState(SiriState.X)` `getState()` |
| Âm thanh | `setAudioAmplitude(0..1)` `setAudioFromRmsDb(dB)` | y hệt |
| Hình dạng/vị trí | `setOrbMode(0..1)` `setOrbSize(f)` `setOrbOffset(dxCss,dyCss)` | y hệt (px view) |
| Chuyển động | `setSpeed` `setWaviness` `setAmplitude` `setIntensity` | y hệt |
| Màu | `setPalette('rainbow'\|...\|object)` `setPaletteRgb(c0,c1,c2,c3)` | `setPalette(SiriPalette.X)` |
| Chuyển cảnh đảo | `setIslandTransition(true)` `setIslandPill(wCss,hCss,cxCss,cyCss)` | y hệt |
| Nền khúc xạ | `setBackdrop(source\|url, dynamic?)` `setBackdropDim(v)` `setBackdropDensity(v)` `setRealLiquid(v)` | `setBackdropBitmap(bitmap)` |
| Hiệu năng | `setRenderScale(0.25..1)` `setMaxFps(n)` `setPixelRatio(≤x)` `setDebugGlErrors(bool)` | y hệt (không có pixelRatio) |
| Callback | `setCallback({ onHidden, onGpuUnavailable })` | `setCallback(Callback)` |
| Cử chỉ | `new SiriSphere.TriggerGestures(el, fn, opts)` | `SiriTriggerGestures` |
| Mic | `new SiriSphere.MicAudio({ onLevel })` | (host tự lấy từ `SpeechRecognizer`) |

## Khác biệt so với bản Android (có chủ đích)

1. **Hoà trộn.** GLSurfaceView trong suốt được hệ thống composite hộ nên bản Android tắt blend;
   canvas web phải tự composite, nên pass 2 dùng `ONE, ONE_MINUS_SRC_ALPHA` (premultiplied
   source-over). Trên nền trong suốt `(0,0,0,0)` kết quả **giống hệt** tắt blend, nên ảnh ra
   không đổi khi không có nền.
2. **Nền khúc xạ.** Android nhận `Bitmap` chụp màn hình. Web **không đọc được trang phía sau
   canvas**, nên `setBackdrop(source, dynamic)` nhận ảnh/`<canvas>`/`<video>`/`ImageBitmap`;
   nguồn được vẽ kín canvas theo kiểu "cover" rồi `glass.frag` khúc xạ nó. Chế độ `none` để
   trang/DOM phía sau hiện xuyên qua canvas trong suốt (giống GLSurfaceView).
3. **Vòng lặp vẽ.** Bản Android dùng `Choreographer` + `RENDERMODE_WHEN_DIRTY`; web dùng
   `requestAnimationFrame`, tự dừng khi: trang ẩn, canvas ra khỏi màn hình (`IntersectionObserver`),
   host gọi `pause()`, hoặc đã ẩn xong. `setAutoManageVisibility` không tồn tại (canvas không cần
   ẩn bằng DOM — pixel đã trong suốt).
4. **Đơn vị px.** Mọi tham số px của web là **CSS px so với canvas**, gốc trên-trái (`setOrbOffset`,
   `setIslandPill`); bên trong nhân với `devicePixelRatio` (giới hạn bởi `setPixelRatio`, mặc định ≤2).
5. **`density`** của `uBackdropDensity` lấy `max(0.5, devicePixelRatio * 0.4)` (Android: `density * 0.4`);
   có thể ghi đè bằng `setBackdropDensity()`.

## Build & test

Không cần cài gì (node ≥ 18, không dependency):

```sh
node tools/sync-shaders.mjs            # kiểm tra/sync shader — monorepo: sync từ module Android (+ --check cho CI)
node tools/test.mjs                    # 46 test logic — không cần GPU
node tools/build.mjs --clean           # -> dist/ (index.html + sirisphere.js + styles.css + assets)
node tools/smoke.mjs                   # Chrome/Edge headless: biên dịch GLSL + đọc pixel 2 pass
```

`tools/smoke.mjs` là bài test đáng giá nhất: nó **biên dịch thật 2 chương trình GLSL** và
kiểm tra pixel (FBO sáng, thân cầu đục ở tâm, ánh sáng ribbon nhìn thấy, chuyển đảo mở/thu đúng,
`onHidden` bắn đúng 1 lần, `dispose()` giải phóng GL). Vì shader dùng chung nguyên văn với module
Android, đây cũng là bằng chứng GLSL của module Android **biên dịch được** (kiểm trên ANGLE/D3D11;
chưa kiểm trên driver GLES của máy Android thật).

## GitHub Action

`.github/workflows/web.yml` chạy khi push vào `main`/tag `v*`, hoặc tạo PR, hoặc chạy tay
(Actions → Run workflow):

1. `tools/sync-shaders.mjs --check` — file shader nhúng nguyên vẹn và khớp hash (repo độc lập:
   tự kiểm toàn vẹn; trong monorepo: so với assets của module Android, chống lệch).
2. `tools/test.mjs` — 46 test logic.
3. `tools/build.mjs --clean` — sinh `dist/`.
4. `tools/smoke.mjs --require-browser` — smoke test WebGL thật (có GPU) trên Chrome headless của runner.
5. Upload artifact `sirisphere-web` (tải về được) **và** deploy GitHub Pages.

Kết quả: mỗi push là một trang web mới. Lần đầu cần bật Pages: **Settings → Pages → Source:
GitHub Actions** (workflow cũng tự bật nếu quyền cho phép) → địa chỉ
`https://<user>.github.io/<repo>/`.

Muốn triển khai nơi khác: tải artifact `sirisphere-web`, hoặc copy `web/dist` lên host tĩnh bất kỳ
(Netlify/Vercel/S3/rsync/FTP) — dist **không cần server phức tạp**, thậm chí mở `dist/index.html`
trực tiếp bằng `file://` cũng chạy (chỉ mic là cần https/localhost).

## Kiểm chứng (đã làm trong môi trường tạo gói này)

| Việc | Kết quả |
|---|---|
| `node tools/test.mjs` | **46/46 PASS** (34 test port từ JVM + 12 test web) |
| `node tools/smoke.mjs` | **SMOKE: OK 15/15** trên Chrome headless 1400×900, ANGLE (NVIDIA Quadro P400, D3D11), target RGBA16F |
| Trang demo (`dist/`) | chạy trong Chrome headless: đảo → cầu mờ dần đúng, ribbon sáng, khúc xạ nền nhìn thấy ở nửa dưới, không lỗi console |
| Nhật ký GL | không có `glGetError` khác 0 trong suốt 150 frame + biên dịch shader |

Chưa kiểm: Safari/iOS (cần `EXT_color_buffer_float`; nếu thiếu sẽ tự rơi về RGBA8 + nén LDR),
Firefox, thiết bị Android thật, và mic trên iOS (yêu cầu thao tác người dùng + https).

## Ghi chú bản quyền

Như README gốc: shader là **bản viết lại**, không sao chép nguyên văn từ APK nguồn; hãy tự xác
nhận bạn có quyền dùng/phát hành hiệu ứng này.
