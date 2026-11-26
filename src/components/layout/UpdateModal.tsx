import { Button } from "@/components/ui/Button";
import { openDownloads, VERSION, type useUpdate } from "@/lib/updates";

/** El aviso de versión nueva, con la instalación de un toque. */
export function UpdateModal({ update, lightsOn }: { update: ReturnType<typeof useUpdate>; lightsOn: boolean }) {
  const { version, notes, open, progress, error } = update;
  if (!version || !open) return null;
  const installing = progress !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Actualización disponible"
        className="w-full max-w-md rounded-panel border border-border bg-panel p-5 shadow-xl"
      >
        <p className="text-base font-semibold text-text-primary">Actualización disponible</p>
        <p className="mt-0.5 text-xs text-text-secondary">
          Versión {version} · tienes la {VERSION}
        </p>

        {notes && !installing ? (
          <div className="mt-3 max-h-48 overflow-y-auto rounded-control border border-border bg-panel2 p-3">
            <p className="mb-1 text-xs font-medium text-text-primary">Novedades</p>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">{notes}</p>
          </div>
        ) : null}

        {installing ? (
          <div className="mt-4 flex flex-col gap-2" role="status">
            <div className="flex justify-between text-xs text-text-secondary">
              <span>{progress < 100 ? "Descargando…" : "Instalando y volviendo a abrir…"}</span>
              <span className="font-mono">{progress} %</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-panel2">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : (
          <p className={`mt-3 text-xs ${lightsOn ? "text-state-warn" : "text-text-secondary"}`}>
            Al instalar, las luces se apagan un momento y LUMEN PRO se vuelve a abrir solo, con tu show. No lo hagas en
            pleno evento.
          </p>
        )}

        {error ? (
          <p role="alert" className="mt-3 text-xs text-state-danger">
            {error}. Puedes intentarlo de nuevo o{" "}
            <button type="button" className="underline" onClick={openDownloads}>
              descargarla desde la página
            </button>
            .
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          {!installing ? (
            <Button variant="ghost" onClick={update.hide}>
              Ahora no
            </Button>
          ) : null}
          <Button variant="primary" disabled={installing} onClick={update.install}>
            {installing ? "Instalando…" : "Instalar ahora"}
          </Button>
        </div>
      </div>
    </div>
  );
}
