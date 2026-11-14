# Android TV / Google TV

El mismo paquete Android se declara compatible con teléfono y Android TV:
- android.software.leanback es opcional para que el APK siga apareciendo en teléfonos.
- android.hardware.touchscreen es opcional.
- La Activity declara LEANBACK_LAUNCHER y un banner para el launcher de TV.
- Las flechas del D-pad cambian de canal cuando el reproductor en vivo está abierto.
- En inicio y catálogos, WebView conserva la navegación de foco nativa.
- Enter/OK se deja a WebView para activar el control enfocado.
- La interfaz añade un contorno grande a :focus-visible.

Prueba recomendada en un Android TV real: instalar el APK debug, recorrer el menú con el mando,
abrir TV en vivo, cambiar de canal con arriba/abajo y abrir una ficha de película.
