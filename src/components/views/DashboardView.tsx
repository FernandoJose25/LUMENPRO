import { useState } from "react";
import { Panel as ResizablePanel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Panel as UiPanel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { FixtureControl } from "@/components/fixtures/FixtureControl";
import { cn } from "@/lib/utils";

const SCENES = ["Entrada", "Novios", "Baile", "Fiesta", "Clímax"];

export function DashboardView() {
  const [activeScene, setActiveScene] = useState("Entrada");

  return (
    <PanelGroup direction="horizontal" className="min-w-0 flex-1 gap-2 p-2">
      <ResizablePanel defaultSize={58} minSize={35}>
        <PanelGroup direction="vertical" className="h-full gap-2">
          <ResizablePanel defaultSize={65} minSize={30}>
            <UiPanel title="VISUALIZER 2D / 3D" className="h-full">
              <div className="flex h-full items-center justify-center rounded-control border border-dashed border-border text-center text-xs text-text-secondary">
                Pendiente — motor de render (Fase 6, ver AUDIT.md)
              </div>
            </UiPanel>
          </ResizablePanel>
          <PanelResizeHandle className="h-1 rounded-full bg-transparent transition-colors hover:bg-accent/40 data-[resize-handle-active]:bg-accent" />
          <ResizablePanel defaultSize={35} minSize={20}>
            <UiPanel title="ESCENAS / CHASES" className="h-full">
              <div className="flex flex-wrap gap-2">
                {SCENES.map((scene) => (
                  <Button
                    key={scene}
                    size="lg"
                    variant="secondary"
                    selected={scene === activeScene}
                    onClick={() => setActiveScene(scene)}
                    className={cn(scene === activeScene && "bg-accent/15 text-accent")}
                  >
                    {scene}
                  </Button>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-text-secondary">
                Pendiente — lógica real de escenas/chases (Fase 4, ver AUDIT.md). Estos botones
                todavía no guardan estado de canales.
              </p>
            </UiPanel>
          </ResizablePanel>
        </PanelGroup>
      </ResizablePanel>

      <PanelResizeHandle className="w-1 rounded-full bg-transparent transition-colors hover:bg-accent/40 data-[resize-handle-active]:bg-accent" />

      <ResizablePanel defaultSize={42} minSize={28}>
        <FixtureControl />
      </ResizablePanel>
    </PanelGroup>
  );
}
