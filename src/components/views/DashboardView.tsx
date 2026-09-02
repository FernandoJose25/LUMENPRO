import { Panel as ResizablePanel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Panel as UiPanel } from "@/components/ui/Panel";
import { ScenesPanel } from "@/components/scenes/ScenesPanel";
import { FixtureControl } from "@/components/fixtures/FixtureControl";

export function DashboardView() {
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
            <ScenesPanel />
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
