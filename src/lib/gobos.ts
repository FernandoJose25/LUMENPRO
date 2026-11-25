import { goboUrl } from "@/lib/library";

/** Imágenes de gobos para el simulador. */
const SIZE = 128;

const masks = new Map<string, HTMLCanvasElement | null>();
let tint: HTMLCanvasElement | null = null;

function square(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  return canvas;
}

/** El gobo como máscara: blanco por donde pasa la luz, negro donde no. null
 *  mientras carga (o si no se pudo). */
export function goboMask(gobo: string): HTMLCanvasElement | null {
  const known = masks.get(gobo);
  if (known !== undefined) return known;
  masks.set(gobo, null);
  const image = new Image();
  image.onload = () => {
    const canvas = square();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(image, 0, 0, SIZE, SIZE);
    masks.set(gobo, canvas);
  };
  image.src = goboUrl(gobo);
  return null;
}

interface Point {
  x: number;
  y: number;
}

/** En cuántos pedazos por lado se dibuja: cada uno es plano, así que juntos
 *  siguen la perspectiva. */
const CELLS = 6;

/** Lo dibuja deformado: `place` dice en qué píxel cae cada punto del gobo, de
 *  -1 a 1 (null si queda detrás de la cámara). */
export function drawGobo(
  ctx: CanvasRenderingContext2D,
  mask: HTMLCanvasElement,
  color: [number, number, number],
  place: (u: number, v: number) => Point | null,
  alpha: number,
): void {
  tint ??= square();
  const t = tint.getContext("2d");
  if (!t) return;
  t.globalCompositeOperation = "copy";
  t.drawImage(mask, 0, 0);
  t.globalCompositeOperation = "multiply";
  t.fillStyle = `rgb(${color.map(Math.round).join(",")})`;
  t.fillRect(0, 0, SIZE, SIZE);
  // "multiply" también pinta fuera del círculo: se recorta con la máscara.
  t.globalCompositeOperation = "destination-in";
  t.drawImage(mask, 0, 0);

  const at = (n: number) => -1 + (2 * n) / CELLS;
  const source = SIZE / CELLS;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  const base = ctx.getTransform();
  for (let row = 0; row < CELLS; row++) {
    for (let column = 0; column < CELLS; column++) {
      const origin = place(at(column), at(row));
      const right = place(at(column + 1), at(row));
      const down = place(at(column), at(row + 1));
      if (!origin || !right || !down) continue;
      ctx.setTransform(base);
      ctx.transform(
        (right.x - origin.x) / source,
        (right.y - origin.y) / source,
        (down.x - origin.x) / source,
        (down.y - origin.y) / source,
        origin.x,
        origin.y,
      );
      ctx.drawImage(tint, column * source, row * source, source, source, 0, 0, source, source);
    }
  }
  ctx.restore();
}
