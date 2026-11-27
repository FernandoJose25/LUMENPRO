import { useEffect, useRef } from "react";
import { BAND_NAMES, getAudioFeed, type Band } from "@/lib/audioInput";

export const BAND_COLORS: Record<Band, string> = { bass: "#ff3b5c", mid: "#ffb020", treble: "#3ba7ff" };
const BAND_LABELS: Record<Band, string> = { bass: "Graves", mid: "Medios", treble: "Agudos" };
/** Qué tan alta llega cada banda: los graves abajo y más anchos, los agudos finos encima. */
const BAND_REACH: Record<Band, number> = { bass: 0.95, mid: 0.7, treble: 0.45 };
const STEP_PX = 3;

/** Lo que suena, dibujado como corre: graves en rojo, medios en ámbar y
 *  agudos en azul, de derecha a izquierda. Sirve igual para una canción
 *  guardada que para un enlace (lo que oye Audio Reactive). Se dibuja sin
 *  pasar por React: se mueve 60 veces por segundo. */
export function SoundTrack() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const beat = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const history: Record<Band, number>[] = [];
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const width = element.clientWidth;
      const height = element.clientHeight;
      const ratio = devicePixelRatio || 1;
      if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
        element.width = Math.round(width * ratio);
        element.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const feed = getAudioFeed();
      history.push(feed ? { ...feed.levels } : { bass: 0, mid: 0, treble: 0 });
      while (history.length > Math.ceil(width / STEP_PX) + 1) history.shift();

      const middle = height / 2;
      for (const band of BAND_NAMES) {
        ctx.fillStyle = BAND_COLORS[band];
        ctx.globalAlpha = band === "bass" ? 0.85 : 0.9;
        history.forEach((levels, i) => {
          const half = Math.max(0.5, levels[band] * middle * BAND_REACH[band]);
          const x = width - (history.length - i) * STEP_PX;
          ctx.fillRect(x, middle - half, STEP_PX - 1, half * 2);
        });
      }
      ctx.globalAlpha = 1;
      if (!feed) {
        ctx.fillStyle = "rgba(255,255,255,.45)";
        ctx.font = "12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Pon una canción o un enlace para verla aquí", width / 2, middle - 10);
      }

      const beats = feed?.beats() ?? null;
      if (beat.current) beat.current.style.opacity = String(beats === null ? 0.15 : Math.max(0.15, 1 - (beats % 1) * 2));
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvas}
        className="h-28 w-full rounded-control bg-bg"
        role="img"
        aria-label="Pista: graves, medios y agudos de lo que suena"
      />
      <div className="flex items-center gap-4 text-[11px] text-text-secondary">
        {BAND_NAMES.map((band) => (
          <span key={band} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: BAND_COLORS[band] }} aria-hidden />
            {BAND_LABELS[band]}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-1.5">
          <span ref={beat} className="h-2.5 w-2.5 rounded-full bg-accent opacity-15" aria-hidden />
          Golpe
        </span>
      </div>
    </div>
  );
}
