import { useRef, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { useFixtureStore } from "@/lib/fixtureStore";
import { exportShowFile } from "@/lib/showFile";

/** Respaldo del show: exportar una copia e importarla (en esta u otra PC). */
export function SettingsView() {
  const { serializeShow, importShow } = useFixtureStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const handleExport = async () => {
    try {
      setMessage({ text: `Copia guardada en ${await exportShowFile(serializeShow())}`, isError: false });
    } catch (e) {
      setMessage({ text: `No se pudo exportar: ${e}`, isError: true });
    }
  };

  const handleImport = async (file: File) => {
    if (!window.confirm(`¿Reemplazar el show actual por "${file.name}"? Exporta antes si quieres conservarlo.`)) {
      return;
    }
    try {
      importShow(await file.text());
      setMessage({ text: `Show importado: ${file.name}`, isError: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), isError: true });
    }
  };

  return (
    <div className="min-w-0 flex-1 p-2">
      <Panel title="SHOW" className="max-w-xl">
        <p className="mb-3 text-xs text-text-secondary">
          El show se guarda solo. Exporta una copia antes de cada evento: sirve de respaldo y para
          llevarlo a otra laptop.
        </p>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => void handleExport()}>
            Exportar show
          </Button>
          <Button onClick={() => fileInput.current?.click()}>Importar show</Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            aria-label="Archivo de show"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Permite volver a elegir el mismo archivo.
              e.target.value = "";
              if (file) void handleImport(file);
            }}
          />
        </div>
        {message ? (
          <p
            role="status"
            className={`mt-3 break-all text-xs ${message.isError ? "text-state-danger" : "text-state-ok"}`}
          >
            {message.text}
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
