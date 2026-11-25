import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { closeDialog, getDialog, subscribeDialog, type Dialog } from "@/lib/dialogs";

/** Se monta una sola vez, en App. */
export function DialogHost() {
  const dialog = useSyncExternalStore(subscribeDialog, getDialog);
  // Con key: un diálogo que abre otro empieza de cero.
  const count = useRef({ dialog, n: 0 });
  if (count.current.dialog !== dialog) count.current = { dialog, n: count.current.n + 1 };
  return dialog ? <DialogBox key={count.current.n} dialog={dialog} /> : null;
}

function DialogBox({ dialog }: { dialog: Dialog }) {
  const [text, setText] = useState(dialog.kind === "text" ? dialog.value : "");
  const box = useRef<HTMLDivElement>(null);

  // El foco entra al diálogo y al cerrar vuelve a donde estaba.
  useEffect(() => {
    const before = document.activeElement;
    const first = box.current?.querySelector<HTMLElement>("input, button");
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);

  function keepFocusInside(e: React.KeyboardEvent) {
    const items = box.current?.querySelectorAll<HTMLElement>("input, button:not(:disabled)");
    if (!items?.length) return;
    const edge = e.shiftKey ? items[0] : items[items.length - 1];
    if (document.activeElement !== edge) return;
    e.preventDefault();
    (e.shiftKey ? items[items.length - 1] : items[0]).focus();
  }

  // Cerrar antes de ejecutar: la acción puede abrir otro diálogo.
  function run(action: () => void) {
    closeDialog();
    action();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={closeDialog}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title}
        className="w-full max-w-md rounded-panel border border-border bg-panel p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Las teclas de acá no son atajos del show.
          e.stopPropagation();
          if (e.key === "Escape") closeDialog();
          if (e.key === "Tab") keepFocusInside(e);
        }}
      >
        <p className="text-sm font-medium text-text-primary">{dialog.title}</p>
        {dialog.kind === "text" ? (
          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => dialog.onAccept(text.trim()));
            }}
          >
            <input
              value={text}
              aria-label={dialog.title}
              onChange={(e) => setText(e.target.value)}
              className="h-10 rounded-control border border-border bg-panel2 px-3 text-sm text-text-primary outline-none focus-visible:border-accent"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={closeDialog}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary">
                Aceptar
              </Button>
            </div>
          </form>
        ) : (
          <>
            {dialog.text ? <p className="mt-2 text-xs text-text-secondary">{dialog.text}</p> : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button onClick={closeDialog}>Cancelar</Button>
              {dialog.options.map((option) => (
                <Button
                  key={option.label}
                  variant={option.variant ?? "primary"}
                  onClick={() => run(option.onSelect)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
