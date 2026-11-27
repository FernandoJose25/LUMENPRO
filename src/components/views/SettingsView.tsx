import { useEffect, useRef, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { askConfirm } from "@/lib/dialogs";
import { VERSION } from "@/lib/updates";
import { useFixtureStore } from "@/lib/fixtureStore";
import { exportShowFile, listBackups, readBackup } from "@/lib/showFile";
import { seedDefinitions, seedInstances } from "@/data/fixtureLibrary";

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

  const handleImport = (file: File) =>
    askConfirm(`¿Reemplazar el show actual por "${file.name}"? Exporta antes si quieres conservarlo.`, "Reemplazar", () =>
      void importFile(file),
    );

  const importFile = async (file: File) => {
    try {
      importShow(await file.text());
      setMessage({ text: `Show importado: ${file.name}`, isError: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), isError: true });
    }
  };

  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-2">
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
              if (file) handleImport(file);
            }}
          />
        </div>
        <Button
          variant="ghost"
          className="mt-3 text-state-danger"
          onClick={() =>
            askConfirm(
              "¿Empezar de cero? Se borra todo el show (luces, grupos, escenas, efectos, momentos y botones) y queda como recién instalado. Si quieres conservarlo, primero usa Exportar show.",
              "Borrar todo",
              () => {
                importShow(JSON.stringify({ definitions: seedDefinitions, instances: seedInstances }));
                setMessage({ text: "Show nuevo, como recién instalado.", isError: false });
              },
            )
          }
        >
          Restablecer todo (empezar de cero)
        </Button>
        {message ? (
          <p
            role="status"
            className={`mt-3 break-all text-xs ${message.isError ? "text-state-danger" : "text-state-ok"}`}
          >
            {message.text}
          </p>
        ) : null}
        <Backups
          onRestore={(day, json) => {
            try {
              importShow(json);
              setMessage({ text: `Show recuperado: como estaba el ${formatDay(day)}.`, isError: false });
            } catch (e) {
              setMessage({ text: e instanceof Error ? e.message : String(e), isError: true });
            }
          }}
        />
      </Panel>
      <Credits />
    </div>
  );
}

/** "jueves 27 de noviembre" */
function formatDay(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  const weekday = date.toLocaleDateString("es-PE", { weekday: "long" });
  return `${weekday} ${date.toLocaleDateString("es-PE", { day: "numeric", month: "long" })}`;
}

/** Cada día, antes del primer guardado, el show como estaba queda guardado
 *  (src-tauri/src/show.rs): dos semanas hacia atrás. */
function Backups({ onRestore }: { onRestore: (day: string, json: string) => void }) {
  const [days, setDays] = useState<string[]>([]);
  useEffect(() => {
    listBackups().then(setDays, () => setDays([]));
  }, []);
  if (days.length === 0) return null;
  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="mb-2 text-xs font-medium tracking-wide text-text-secondary">RESPALDOS AUTOMÁTICOS</div>
      <p className="mb-2 text-xs text-text-secondary">Cómo estaba el show al empezar cada día. Recuperar uno reemplaza el actual.</p>
      <ul className="flex flex-col gap-1.5">
        {days.map((day) => (
          <li key={day} className="flex items-center justify-between gap-2 rounded-control border border-border bg-panel2 px-2.5 py-1.5 text-sm">
            <span className="text-text-primary first-letter:uppercase">{formatDay(day)}</span>
            <Button
              size="sm"
              onClick={() =>
                askConfirm(`¿Volver al show como estaba el ${formatDay(day)}? Se reemplaza el actual.`, "Recuperar", () =>
                  void readBackup(day).then((json) => onRestore(day, json)),
                )
              }
            >
              Recuperar
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** La licencia de QLC+ pide conservar su texto y los créditos. */
function Credits() {
  const [text, setText] = useState<string | null>(null);

  const show = async () => {
    const files = ["library/NOTICE.txt", "library/LICENSE.txt"];
    const parts = files.map(async (file) => (await fetch(import.meta.env.BASE_URL + file)).text());
    setText((await Promise.all(parts)).join("\n\n"));
  };

  return (
    <Panel title="ACERCA DE" className="mt-2 max-w-xl">
      <p className="mb-3 text-xs text-text-secondary">
        LUMEN PRO {VERSION}. Las versiones nuevas se descargan de GitHub; lo que armaste no se pierde al actualizar.
      </p>
      <p className="mb-3 text-xs text-text-secondary">
        Los perfiles y las imágenes de gobos son de QLC+ (qlcplus.org), de Heikki Junnila, Massimo Callegari y sus
        colaboradores, bajo licencia Apache 2.0.
      </p>
      {text === null ? (
        <Button onClick={() => show().catch((e) => setText(`No se pudo leer la licencia: ${e}`))}>Ver licencia</Button>
      ) : (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-control border border-border bg-panel2 p-3 text-[11px] text-text-secondary">
          {text}
        </pre>
      )}
    </Panel>
  );
}
