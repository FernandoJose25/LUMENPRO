/**
 * Fase 4 — Scenes: una escena es una foto de los valores de canal de
 * uno o más fixtures en un momento dado. `values` está indexado por
 * `FixtureInstance.id` y, dentro de cada instancia, por `FixtureChannel.id`
 * (no por número de canal DMX crudo — así una escena sigue siendo válida
 * si el fixture se reparchea a otra dirección).
 *
 * Recall es un merge, no un blackout: aplicar una escena solo toca los
 * fixtures/canales que esa escena capturó, dejando el resto del rig como
 * estaba — igual que en una consola real donde una escena que solo
 * programaste para los PARs no debería tocar los cabezas móviles.
 */
export interface Scene {
  id: string;
  name: string;
  /** instanceId -> channelId -> valor DMX (0-255) capturado */
  values: Record<string, Record<string, number>>;
  createdAt: number;
  updatedAt: number;
}
