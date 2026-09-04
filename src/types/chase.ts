/**
 * Fase 4 — Chases: una secuencia ordenada de Scenes (types/scene.ts) ya
 * guardadas, cada una con su propio tiempo de espera (`holdMs`) y de
 * transición (`fadeMs`) hacia ella. Un chase NO duplica los valores de
 * canal — cada `ChaseStep.sceneId` referencia una Scene real, así que
 * editar esa Scene después actualiza automáticamente a todos los chases
 * que la usan (igual que en una consola real donde un chase de escenas
 * "vive" de las escenas de la memoria, no de una copia congelada).
 */
export interface ChaseStep {
  id: string;
  sceneId: string;
  /** Milisegundos de crossfade hacia los valores de esta escena, desde lo
   *  que estuviera en vivo al terminar el step anterior. 0 = corte duro. */
  fadeMs: number;
  /** Milisegundos que el chase se queda en esta escena (ya con el fade
   *  terminado) antes de pasar al siguiente step. */
  holdMs: number;
}

export interface Chase {
  id: string;
  name: string;
  steps: ChaseStep[];
  /** Al llegar al último step, ¿vuelve al primero (true) o se detiene? */
  loop: boolean;
  createdAt: number;
  updatedAt: number;
}
