import { closeDialog, getDialog, subscribeDialog } from "@/lib/dialogs";

type Answer = string | true | null;
let answers: Answer[] = [];

subscribeDialog(() => {
  const dialog = getDialog();
  if (!dialog || answers.length === 0) return;
  const answer = answers.shift()!;
  closeDialog();
  if (dialog.kind === "text") {
    if (typeof answer === "string") dialog.onAccept(answer);
  } else if (answer === true) {
    dialog.options[0].onSelect();
  }
});

/** Contesta los próximos diálogos sin pasar por la pantalla, en orden: un texto
 *  para los que preguntan algo, `true` para confirmar y `null` para cancelar.
 *  (Los diálogos en sí se prueban en dialogs.test.tsx.) */
export function willAnswer(...next: Answer[]): void {
  answers.push(...next);
}

export function resetDialogs(): void {
  answers = [];
  closeDialog();
}
