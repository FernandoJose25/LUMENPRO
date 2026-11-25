import { useStageMirror } from "@/lib/stageMirror";
import { StageCanvas } from "./StageCanvas";

/** Lo único que muestra la segunda ventana (ver lib/stageMirror.ts). */
export function StageWindow() {
  const rig = useStageMirror();
  return (
    <div className="h-screen bg-bg">
      {rig ? (
        <StageCanvas rig={rig} />
      ) : (
        <p className="flex h-full items-center justify-center text-sm text-text-secondary">
          Esperando a la ventana principal de LUMEN PRO…
        </p>
      )}
    </div>
  );
}
