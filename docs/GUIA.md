# Guía de LUMEN PRO

LUMEN PRO maneja las luces de un evento desde la laptop o desde el celular. La idea es preparar todo la noche anterior y, en el evento, solo tocar **Siguiente** cuando cambia el momento: la entrada, el vals, las fotos, la hora loca.

Esta guía es para alguien que nunca lo usó. Se puede seguir sin luces, con el simulador, y conectar las luces al final.

## 1. Instalar

1. Descarga el instalador de la página de LUMEN PRO en GitHub, en **Releases**: el archivo que termina en **setup.exe**.
2. Ábrelo. Si Windows muestra **"Windows protegió tu PC"**, toca **Más información** y después **Ejecutar de todas formas**. Pasa porque el programa no está firmado; no es un virus.
3. Abre LUMEN PRO desde el menú Inicio.

Cuando hay una versión nueva y la laptop tiene internet, arriba aparece **Versión nueva**. Tocándolo se abre la página para descargarla. Lo que ya armaste no se pierde.

## 2. Agregar tus luces

Ve a **Fixtures** y toca **+ Elegir de la biblioteca**.

1. Escribe la marca o el modelo de la etiqueta de la luz, por ejemplo **LPC007** o **Chauvet**.
2. Elige el equipo de la lista.
3. En **Modo**, elige el que tiene configurado la luz en su menú (por ejemplo **7 Channel**). Si no coincide, las funciones caen en otro canal y la luz hace cosas raras.
4. Escribe **cuántas** tienes y toca **Agregar**. Quedan en direcciones seguidas.

**Si tu luz no está en la lista**, toca **+ Equipo sin manual**: escribe un nombre y cuántos canales usa (lo dice su menú: 7CH, 16CH…). Después, con la luz conectada, LUMEN PRO te ayuda a descubrir qué hace cada canal.

**La dirección.** Cada luz tiene una dirección DMX en su menú (A001, d001…). Tiene que ser la misma que muestra LUMEN PRO al lado de cada luz, en **DMX**. Si no lo es, cambia una de las dos.

## 3. Ubicarlas en el escenario

En **Escenario** se ve un simulador con las luces encendidas.

- Arrastra cada luz a donde va a estar en el evento.
- Elige una luz a la derecha para cambiar su altura, su giro, o si la cabeza va colgada.
- Arrastra el fondo para mirar desde otro lado. La rueda del mouse acerca.

## 4. Armar la quinceañera

Ve a **Momentos** y toca **Usar plantilla de quinceañera**. Aparecen los momentos de una fiesta típica, ya armados con tus luces: Recepción, Entrada, Vals, Fotos, Brindis, Hora loca, Hora loca con estrobo, Hora loca con música y Cierre.

Pruébalos en **Escenario**: abajo hay un botón por momento.

Para cambiar uno:

- **El color o la posición:** ve a **Dashboard**, elige una luz, ponla como quieres y en **Scenes** toca ⟳ en la escena de ese momento.
- **El orden o la duración:** en **Momentos**. Si un momento tiene duración, pasa solo al siguiente cuando se cumple.
- **Lo que se mueve:** en **Effects**. Hay de dos tipos: uno sube y baja un canal (por ejemplo los colores de los PAR) y el otro hace que las cabezas dibujen una figura (círculo, ocho, línea o abanico) alrededor de donde apuntan.

**Posiciones con nombre.** En **Escenario**, toca **Apuntar** y después el piso: las cabezas apuntan ahí. Guarda esa posición en **Paletas** como "Pista" o "Mesa principal". Si la corriges después, cambian todas las escenas que la usan.

## 5. Conectar las luces

Ve a **DMX Output**.

1. Enchufa el adaptador USB a DMX y la primera luz.
2. Elige el adaptador: **Cable FTDI** si es el cable barato, **Enttec** si es una cajita Enttec, **Art-Net** o **sACN** si las luces van por red.
3. Toca **Conectar**. Arriba debe decir **DMX Conectado**.
4. Toca **Identificar** al lado de cada luz: se enciende la que corresponde por 3 segundos. Si se enciende otra, la dirección está mal.

Si una cabeza se mueve al revés que en el simulador, en **Escenario** elige esa luz y marca **Invertir pan** o **Invertir tilt**.

**Antes de probar con luces, cierra** QLC+, FreeStyler o cualquier otro programa de luces: dos programas no pueden usar el mismo cable.

## 6. Manejarlo desde el celular

1. Conecta la laptop y el celular a la misma WiFi. No hace falta internet. Lo mejor es un router propio con contraseña o el punto de acceso de tu celular, no la WiFi del local.
2. En **Celular**, toca **Encender**. Si Windows pregunta por el firewall, permite el acceso.
3. Escanea el código QR con el celular.

En el celular está el botón grande **Siguiente**, los momentos, la intensidad, el estrobo y el **Blackout** (hay que tocarlo dos veces, para no apagar todo sin querer). En **Celular → Botones del celular** puedes agregar los botones que quieras arriba de todo.

## 7. Durante el evento

- Toca **Siguiente** cuando cambia el momento. En la laptop también sirven **AvPág** y **RePág**, o un pasador de diapositivas.
- **Intensidad** baja todas las luces a la vez sin perder nada.
- **Blackout** apaga todo sin mover las cabezas. Al volver, todo queda como estaba.
- **Hora loca con música:** en **Audio Reactive** toca **Escuchar** con la música sonando. Arriba aparecen los BPM y las luces siguen el ritmo. Hay que tocarlo cada vez que se abre el programa.
- En **Live** puedes armar **Mis botones**: los que más uses, grandes.
- Si tienes un **controlador MIDI** (botones y faders físicos), en **MIDI** elige qué hará cada control, toca **Aprender** y muévelo.

**Las luces no dependen de la ventana.** Si la ventana se traba o se cierra, las luces siguen con lo que estaban haciendo, el celular y el controlador siguen funcionando, y la ventana se vuelve a abrir sola. Si la cierras tú con las luces encendidas, pregunta si dejarlas o apagar todo.

## 8. Si algo falla

- **Las luces parpadean:** en **DMX Output**, desconecta, baja la velocidad a 25 o 20 FPS y conecta de nuevo. Si el adaptador tiene un chip CH340, LUMEN PRO lo avisa: con ese chip suelen parpadear.
- **"Pausa más larga" pasa de 100 ms:** hubo un corte en la señal. Revisa el cable USB y que la laptop esté enchufada.
- **Una luz no enciende:** revisa su dirección y su modo, y que su dimmer no esté en 0. **Identificar** ayuda.
- **El celular no entra:** que los dos estén en la misma WiFi; prueba la otra dirección que muestra **Celular**; permite LUMEN PRO en el firewall de Windows.
- **El PAR enciende o apaga de golpe:** en **Fixtures → Editar perfil**, en la curva del dimmer elige **Suave al encender**.

## 9. Antes de cada evento

- [ ] **Settings → Exportar show** y guarda la copia en el celular o en un USB.
- [ ] La laptop enchufada y con la **tapa abierta**.
- [ ] La laptop y el celular en la WiFi propia.
- [ ] Prueba cada momento en **Escenario** o con las luces, sin público.
- [ ] Si vas a usar la música: **Audio Reactive → Escuchar**.
- [ ] Ten a mano una consola de respaldo los primeros eventos.
