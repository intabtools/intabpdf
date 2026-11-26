# Third-Party Open-Source Software Notices

InTab PDF itself is licensed under the MIT License (see `LICENSE`).

This distribution incorporates third-party open-source libraries, including the following native Android and cross-platform components:

---

## Android Native Scanner Components

### OpenCV for Android (`org.opencv:opencv:4.12.0`)
- **License**: Apache License, Version 2.0
- **Source**: https://opencv.org / https://github.com/opencv/opencv
- **Bundled third-party components inside `libopencv_java4.so`**:
  - `libjpeg-turbo` — IJG / BSD 3-Clause / zlib licenses
  - `libpng` — libpng License
  - `libtiff` — libtiff (BSD-like) License
  - `OpenJPEG` (`libopenjp2`) — BSD 2-Clause License
  - `libwebp` — BSD 3-Clause License
  - `zlib` — zlib License
  - `KleidiCV` (ARM hardware abstraction) — Apache License, Version 2.0
  - `ITT` (`ittnotify`) — BSD 3-Clause / GPLv2 dual-licensed upstream (used under BSD 3-Clause)
- **LLVM C++ Shared Runtime (`libc++_shared.so`)**: Apache License, Version 2.0 with LLVM Exception

### AndroidX Jetpack & CameraX
- `androidx.camera:camera-core`, `camera-camera2`, `camera-lifecycle`, `camera-view` (`1.5.0`) — Apache License, Version 2.0
- `androidx.compose.*` (`Compose BOM 2025.09.00`) — Apache License, Version 2.0
- `androidx.activity:activity-compose`, `androidx.appcompat:appcompat`, `androidx.exifinterface:exifinterface`, `androidx.core:core-splashscreen` — Apache License, Version 2.0
- Kotlin Standard Library & Compose Compiler (`2.2.10`) — Apache License, Version 2.0

### Capacitor Android Runtime & Official Plugins
- `@capacitor/android`, `@capacitor/app`, `@capacitor/filesystem`, `@capacitor/share` — MIT License

---

## Core PDF & UI Libraries (Web, Electron, Android)
- `pdf-lib` — MIT License
- `pdfjs-dist` (PDF.js) — Apache License, Version 2.0
- `react`, `react-dom`, `react-router-dom` — MIT License
- `lucide-react` — ISC License
- `@pdfsmaller/pdf-encrypt`, `@pdfsmaller/pdf-decrypt` — MIT License

---

Apache License, Version 2.0 text: https://www.apache.org/licenses/LICENSE-2.0
