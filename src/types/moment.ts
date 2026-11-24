/**
 * Momento del evento (Entrada, Vals, Hora loca…): todo lo que pasa con un
 * solo botón. No duplica nada — referencia una Scene, un Chase y Effects que
 * ya existen, así que editarlos actualiza el momento.
 */
export interface Moment {
  id: string;
  name: string;
  /** Punto de partida de todo el rig: lo que la escena no define vuelve a su
   *  valor por defecto, para que el estrobo de un momento no se cuele en el
   *  siguiente. null = dejar las luces como estén. */
  sceneId: string | null;
  /** Arranca al terminar el fade. */
  chaseId: string | null;
  /** Ídem. Los del momento anterior se detienen al entrar. */
  effectIds: string[];
  fadeMs: number;
  /** Segundos hasta pasar solo al siguiente. null = esperar a "Siguiente". */
  durationSec: number | null;
}
