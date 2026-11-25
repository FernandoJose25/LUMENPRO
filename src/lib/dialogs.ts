/**
 * Cuadros de diálogo dentro del programa. Los de Windows (window.prompt y
 * window.confirm) congelan la interfaz entera mientras están abiertos.
 * Los dibuja components/ui/DialogHost.tsx.
 */
export interface DialogOption {
  label: string;
  variant?: "primary" | "secondary" | "danger";
  onSelect: () => void;
}

export type Dialog =
  | { kind: "text"; title: string; value: string; onAccept: (text: string) => void }
  | { kind: "choice"; title: string; text?: string; options: DialogOption[] };

let current: Dialog | null = null;
const listeners = new Set<() => void>();

function show(dialog: Dialog | null): void {
  current = dialog;
  listeners.forEach((listener) => listener());
}

export const getDialog = () => current;

export function subscribeDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const closeDialog = () => show(null);

/** Pide un texto. `onAccept` recibe lo escrito sin espacios a los lados. */
export function askText(title: string, value: string, onAccept: (text: string) => void): void {
  show({ kind: "text", title, value, onAccept });
}

/** Confirma algo que borra o reemplaza. */
export function askConfirm(title: string, accept: string, onAccept: () => void): void {
  show({ kind: "choice", title, options: [{ label: accept, variant: "danger", onSelect: onAccept }] });
}

export function askChoice(dialog: { title: string; text?: string; options: DialogOption[] }): void {
  show({ kind: "choice", ...dialog });
}
