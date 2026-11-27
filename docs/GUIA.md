# Guía de LUMEN PRO

LUMEN PRO maneja las luces de un evento desde la laptop o desde el celular. La idea es preparar todo la noche anterior y, en el evento, solo tocar **Siguiente** cuando cambia el momento: la entrada, el vals, las fotos, la hora loca.

Esta guía es para alguien que nunca lo usó. Se puede seguir sin luces, con el simulador, y conectar las luces al final.

## 1. Instalar

1. Descarga el instalador de la página de LUMEN PRO en GitHub, en **Releases**: el archivo que termina en **setup.exe**.
2. Ábrelo. Si Windows muestra **"Windows protegió tu PC"**, toca **Más información** y después **Ejecutar de todas formas**. Pasa porque el programa no está firmado; no es un virus.
3. Abre LUMEN PRO desde el menú Inicio.

Cuando hay una versión nueva y la laptop tiene internet, aparece un aviso con las novedades (al abrir y, con el programa abierto, en menos de media hora). **Instalar ahora** la descarga e instala sola: las luces se apagan un momento y LUMEN PRO se vuelve a abrir con tu show. Si tocas **Ahora no**, queda arriba el botón **Versión nueva** para hacerlo después. No actualices en pleno evento.

## 2. Agregar tus luces

Ve a **Fixtures** y toca **+ Elegir de la biblioteca**.

1. Escribe la marca o el modelo de la etiqueta de la luz, por ejemplo **LPC007** o **Chauvet**.
2. Elige el equipo de la lista.
3. En **Modo**, elige el que tiene configurado la luz en su menú (por ejemplo **7 Channel**). Si no coincide, las funciones caen en otro canal y la luz hace cosas raras.
4. Escribe **cuántas** tienes y toca **Agregar**. Quedan en direcciones seguidas.

**Si tu luz no está en la lista**, toca **+ Equipo sin manual**: escribe un nombre y cuántos canales usa (lo dice su menú: 7CH, 16CH…). Después, con la luz conectada, LUMEN PRO te ayuda a descubrir qué hace cada canal.

**La dirección.** Cada luz tiene una dirección DMX en su menú (A001, d001…). Tiene que ser la misma que muestra LUMEN PRO al lado de cada luz, en **DMX**. Si no lo es, cambia una de las dos.

**Dos luces en la misma dirección.** Si pusiste dos PAR iguales en la misma dirección (por ejemplo los dos en 001), agrégalas igual como dos luces y escribe la misma dirección en las dos. Al lado aparece **va junto con…**: hacen siempre lo mismo, porque el cable les manda lo mismo, y el simulador las muestra así.

**SIN VERIFICAR** quiere decir que ese perfil todavía no se probó con la luz real. Cuando la conectes y cada canal haga lo que dice, abre el equipo en **Fixtures** y marca **Ya la probé con la luz real**.

## 3. Ubicarlas en el escenario

En **Escenario** se ve un simulador con las luces encendidas.

- Arrastra cada luz a donde va a estar en el evento.
- Elige una luz a la derecha para cambiar su altura, su giro, o si la cabeza va colgada.
- Arrastra el fondo para mirar desde otro lado. La rueda del mouse acerca.
- **Restablecer posiciones** devuelve todas las luces a su lugar inicial.

## 4. Armar la quinceañera

Ve a **Momentos** y toca **Usar plantilla de quinceañera**. Aparecen los momentos de una fiesta típica, ya armados con tus luces: Recepción, Entrada, Vals, Fotos, Brindis, Hora loca, Hora loca con estrobo, Hora loca con música y Cierre.

Pruébalos en **Escenario**: abajo hay un botón por momento, los colores y los efectos.

**Vista previa.** En **Escenario**, toca **Vista previa**: lo que pruebes (momentos, colores, efectos) se ve solo en la pantalla y las luces no cambian. Si te gusta, **Mandar a las luces**; si no, **Salir**.

Para cambiar uno:

- **El color:** en **Momentos**, elige el momento y toca un color en **Color**, para cada grupo (PAR, Cabezas). Si el momento tiene efectos de color, como la ola de colores de la hora loca, esos mandan mientras corren: el aviso te deja quitarlos de ese momento.
- **La posición:** ve a **Dashboard**, elige la luz en la fila de nombres de **Fixture Control** (puedes tocar varias, o de un toque **Todas**, un grupo o un modelo: lo que cambies les llega a todas), ponla como quieres y en **Scenes** toca ⟳ en la escena de ese momento.
- **El orden o la duración:** en **Momentos**. Si un momento tiene duración, pasa solo al siguiente cuando se cumple.
- **Lo que se mueve:** en **Effects**. Hay de dos tipos: uno sube y baja un canal (por ejemplo los colores de los PAR) y el otro hace que las cabezas dibujen una figura (círculo, ocho, línea o abanico) alrededor de donde apuntan.
- **Más efectos:** en **Effects → + Efectos listos** hay arcoíris, respirar, ola, persecución, destellos, golpe al ritmo, golpe de graves y figuras para las cabezas. Elige el grupo y el efecto: se ve en un escenario chico antes de agregarlo, sin tocar las luces. Después ponlo en un momento marcándolo en **Momentos → Effects**.

**Si moviste algo y no recuerdas cómo estaba**, cada sección tiene **Restablecer**: en **Momentos** la plantilla vuelve a como venía (tus momentos propios no se tocan), en **Effects** un efecto vuelve a su velocidad y colores, en **Fixtures** un perfil vuelve a sus canales de fábrica, en **Dashboard** una luz vuelve a sus valores iniciales y en **Settings** se puede empezar de cero. También sirve **Undo** (Ctrl+Z).

**El vals a tiempo con la canción.** En **Línea de tiempo**, toca **Crear la del vals** y **Cargar canción** (MP3, M4A o WAV). Se copia a la carpeta del programa y se ve su forma de onda.

1. La línea blanca marca dónde estás: tócala en la regla de arriba o muévela con las flechas.
2. Con **+ Momento**, **+ Color fijo**, **+ Efecto**, **+ Estrobo** o **+ Apagón** pones una marca donde está la línea. **+ Momento** sigue solo con el momento siguiente.
3. Lo más rápido: dale **Reproducir** y toca los botones al ritmo de la música. Después afina cada marca arrastrándola, o tócala y escribe el segundo exacto. Al estrobo, al apagón, al color y al efecto se les puede poner cuánto **Dura**; vacío, se quedan hasta que otra marca los cambie.
4. **Escuchar desde aquí** arranca dos segundos antes de la marca elegida. Si arrancas desde la mitad, las luces quedan como si la canción hubiera sonado desde el principio.

Con la canción sonando, los momentos no pasan solos al siguiente: la canción manda. Para que la música llegue a la consola del DJ, conecta la laptop con un cable y elige por dónde sale en **Sale por**. Sin canción, las luces corren igual y terminan en la última marca.

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

En el celular está el botón grande **Siguiente**, los momentos, las **Canciones** (las líneas de tiempo: un toque las arranca y detenerlas pide dos, para no cortar el vals sin querer; la música sale de la laptop), el **Color fijo** de cada grupo, los **Efectos** (se prenden y apagan tocándolos), la intensidad, el **TAP** para marcar el ritmo, el estrobo y el **Blackout** (hay que tocarlo dos veces, para no apagar todo sin querer). En **Celular → Botones del celular** puedes agregar los botones que quieras arriba de todo.

## 7. Durante el evento

- Toca **Siguiente** cuando cambia el momento. En la laptop también sirven **AvPág** y **RePág**, o un pasador de diapositivas.
- **Intensidad** baja todas las luces a la vez sin perder nada.
- **Velocidad** (en **Live** y en el celular) apura o frena todos los efectos y chases a la vez: más rápido en la hora loca, lento en el brindis. **1×** la vuelve a la normal. Lo que sigue la música (o el TAP) va con la música.
- **Blackout** apaga todo sin mover las cabezas. Al volver, todo queda como estaba.
- **Color fijo** (en **Live**, **Escenario** y el celular): elige un color para los PAR o las cabezas y se queda hasta que pasas a otro momento. Tapa los colores del momento y de sus efectos (la ola de colores se vuelve de un solo color) pero deja que sigan el dimmer, el estrobo y los movimientos. Si prendes a mano un efecto de color de ese grupo, el efecto le gana. Las cabezas también lo toman, con su rueda de colores (el más parecido al que elijas), y con **Estrobo** destellan en ese color. La rueda de las BEAM 280 está sin confirmar: con la luz conectada, revisa en **Fixtures → Editar perfil** que cada color caiga donde dice. Los momentos no cambian: **Del momento** lo suelta antes y vuelve lo que tenían.
- **Hora loca con música:** en **Audio Reactive** toca **Escuchar** con la música sonando. Arriba aparecen los BPM y las luces siguen el ritmo. Hay que tocarlo cada vez que se abre el programa. Sin sonido, los PAR que laten con los graves se quedan apagados; cualquier sonido los prende, también la voz. Para que los discursos no los prendan, marca **Solo con música**: espera a reconocer el ritmo de una canción.
- **TAP: el ritmo a mano.** Si el micrófono no oye bien o no hay cómo conectar nada, toca **TAP** (arriba a la izquierda, la tecla **T** o en el celular) al ritmo de la canción, un toque por golpe. Con dos toques ya toma el tempo; mientras más toques, más parejo. Desde ahí todo lo que sigue la música (los colores al ritmo, el golpe de graves, el ocho de las cabezas) va con ese ritmo, aunque no se escuche nada. Un toque suelto acomoda el golpe sin cambiar el tempo; para otra canción, espera dos segundos y vuelve a tocar. La **×** lo suelta y vuelve a seguir lo que se escucha. También se puede poner en un botón del celular o del controlador MIDI.
- **Cambiar algo en vivo y que quede:** en **Live**, mueve los colores o los faders de un grupo y toca **Guardar cambios en «…»**: la próxima vez que lances ese momento se verá así. Si no lo guardas, el siguiente momento pone sus propias luces.
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

- [ ] **Settings → Exportar show** y guarda la copia en el celular o en un USB. Además, cada día LUMEN guarda solo cómo estaba el show al empezar (dos semanas hacia atrás): si algo se dañó, en **Settings → Respaldos automáticos** toca **Recuperar**.
- [ ] La laptop enchufada y con la **tapa abierta**.
- [ ] La laptop y el celular en la WiFi propia.
- [ ] Prueba cada momento en **Escenario** o con las luces, sin público.
- [ ] Si vas a usar la música: **Audio Reactive → Escuchar**.
- [ ] Ten a mano una consola de respaldo los primeros eventos.
