import { useState } from "react";
import { Sidebar, SECTIONS } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { FixtureStoreProvider, useFixtureStore } from "@/lib/fixtureStore";
import { DashboardView } from "@/components/views/DashboardView";
import { FixturesView } from "@/components/views/FixturesView";
import { GroupsView } from "@/components/groups/GroupsView";
import { ScenesView } from "@/components/scenes/ScenesView";
import { ChasesView } from "@/components/chases/ChasesView";
import { EffectsView } from "@/components/effects/EffectsView";
import { AudioView } from "@/components/audio/AudioView";
import { LiveView } from "@/components/live/LiveView";
import { DmxOutputView } from "@/components/dmx/DmxOutputView";
import { MomentsView } from "@/components/moments/MomentsView";
import { RemoteView } from "@/components/remote/RemoteView";
import { StageView } from "@/components/stage/StageView";
import { SettingsView } from "@/components/views/SettingsView";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { DialogHost } from "@/components/ui/DialogHost";
import { useAudioInput } from "@/lib/audioInput";
import { useDmxOutput } from "@/lib/dmxOutput";
import { useRemoteControl } from "@/lib/remoteControl";
import { useStagePublisher } from "@/lib/stageMirror";
import { PlaceholderView } from "@/components/views/PlaceholderView";

// A qué fase del plan (sección 33 del brief) corresponde cada sección del
// Sidebar que todavía no está implementada.
const PENDING_PHASE: Record<string, string> = {
  Universes: "el motor DMX (fuera del alcance frontend de las Fases 1-6)",
};

export default function App() {
  return (
    <FixtureStoreProvider>
      <AppShell />
    </FixtureStoreProvider>
  );
}

/** Todo lo que necesita leer del fixtureStore va aquí y no en App(), que es
 *  quien renderiza el Provider: en su cuerpo el contexto todavía no existe. */
function AppShell() {
  const [section, setSection] = useState("Dashboard");
  const { engine, blackoutActive, blackout, releaseBlackout, saveShow } = useFixtureStore();
  const dmx = useDmxOutput();
  const audio = useAudioInput(engine.wasListening);
  const remote = useRemoteControl();
  useStagePublisher();

  return (
    <div className="flex h-screen flex-col bg-bg">
      <Topbar
        dmx={dmx.status}
        universe={1}
        bpm={audio.bpm}
        onSave={saveShow}
        blackoutActive={blackoutActive}
        onBlackout={blackout}
        onReleaseBlackout={releaseBlackout}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar active={section} onSelect={setSection} />

        {section === "Dashboard" ? <DashboardView /> : null}
        {section === "Live" ? <LiveView /> : null}
        {section === "Momentos" ? <MomentsView /> : null}
        {section === "Escenario" ? <StageView /> : null}
        {section === "Fixtures" ? <FixturesView /> : null}
        {section === "Groups" ? <GroupsView /> : null}
        {section === "Scenes" ? <ScenesView /> : null}
        {section === "Chases" ? <ChasesView /> : null}
        {section === "Effects" ? <EffectsView /> : null}
        {section === "Audio Reactive" ? <AudioView audio={audio} /> : null}
        {section === "DMX Output" ? <DmxOutputView dmx={dmx} /> : null}
        {section === "Celular" ? <RemoteView remote={remote} /> : null}
        {section === "Settings" ? <SettingsView /> : null}
        {PENDING_PHASE[section] ? (
          <PlaceholderView section={section} phase={PENDING_PHASE[section]} />
        ) : null}
      </div>

      <CommandPalette sections={SECTIONS} activeSection={section} onSelectSection={setSection} />
      <DialogHost />
    </div>
  );
}
