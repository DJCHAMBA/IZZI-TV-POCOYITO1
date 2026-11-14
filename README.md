# izzi TV Pocoyito

Aplicación de entretenimiento con una interfaz compartida para web/PWA, PC y Android (teléfono y Android TV).

> Proyecto independiente de DJCHAMBA. No es una aplicación oficial de izzi ni está afiliada a izzi o a los titulares de los canales.

## Plataformas

- **Web/PWA:** abre `index.html` en hosting HTTPS y se puede instalar desde el navegador.
- **Windows/macOS/Linux:** app de escritorio basada en Electron (`desktop/`).
- **Android móvil y Android TV / Google TV:** proyecto nativo WebView (`android/`). El mismo APK declara los lanzadores `LAUNCHER` y `LEANBACK_LAUNCHER`; el touchscreen es opcional y el banner de TV está incluido.

## Construcción

### Android (teléfono + TV)
Requiere JDK 17, Android SDK 35 y Gradle 8.9:
```bash
cd android
gradle :app:assembleDebug
```
APK de depuración: `android/app/build/outputs/apk/debug/app-debug.apk`.

El workflow **Android APK (Phone + Android TV)** compila el APK automáticamente y lo publica como artifact de GitHub Actions al hacer push o ejecutarlo manualmente.

### PC
```bash
cd desktop
npm install
npm start
npm run dist
```
El workflow **Windows App Installer** genera un instalador NSIS `.exe` como artifact de GitHub Actions.

## Controles de Android TV
El control remoto envía flechas para cambiar de canal y Enter para activar el elemento enfocado. La interfaz agrega contornos de foco grandes para navegación desde el sofá.

## Funciones
- TV en vivo con listas IPTV públicas configuradas en el cliente.
- Zapping por flechas y botones CH+/CH-.
- Barra OSD que se oculta tras cinco segundos.
- Guía EPG cuando el proveedor tiene datos disponibles.
- Favoritos.
- Catálogo de películas y series consultando Internet Archive.
- Marcadores Liga MX (proveedor externo).

## Importante
La disponibilidad y legalidad de cada señal o vídeo dependen del proveedor y de los derechos correspondientes. Configura únicamente fuentes que tengas derecho a reproducir. Los servicios externos pueden cambiar o dejar de responder. La reproducción requiere internet.