import { Panel as ResizablePanel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ScenesPanel } from "@/components/scenes/ScenesPanel";
import { FixtureControl } from "@/components/fixtures/FixtureControl";
import { StageVisualizer } from "@/components/visualizer/StageVisualizer";

export function DashboardView() {
  return (
    <PanelGroup direction="horizontal" className="min-w-0 flex-1 gap-2 p-2">
      <ResizablePanel defaultSize={58} minSize={35}>
        <PanelGroup direction="vertical" className="h-full gap-2">
          <ResizablePanel defaultSize={65} minSize={30}>
            <StageVisualizer />
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
