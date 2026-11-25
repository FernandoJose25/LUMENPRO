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
import { useAudioInput } from "@/lib/audioInput";
import { useEffectsEngine } from "@/lib/effectEngine";
import { useDmxOutput } from "@/lib/dmxOutput";
import { useMomentsEngine } from "@/lib/momentsEngine";
import { useRemoteControl } from "@/lib/remoteControl";
import { useStagePublisher } from "@/lib/stageMirror";
import { PlaceholderView } from "@/components/views/PlaceholderView";

// A qué fase del plan (sección 33 del brief) corresponde cada sección del
// Sidebar que todavía no está implementada.
const PENDING_PHASE: Record<string, string> = {
  Universes: "el motor DMX (fuera del alcance frontend de las Fases 1-6)",
};

/** Monta useEffectsEngine dentro del árbol de FixtureStoreProvider — no
 *  puede llamarse en App() directamente porque el contexto todavía no
 *  existe en ese punto (App es quien renderiza el Provider, no un hijo
 *  suyo). Así el motor corre siempre, sin importar qué sección del
 *  Sidebar esté abierta — ver comentario en lib/effectEngine.ts. */
function EffectsEngineMount() {
  useEffectsEngine();
  return null;
}

/** Ídem para los Momentos. Los dos van en componentes propios para que cada
 *  uno se re-renderice solo con lo suyo. */
function MomentsEngineMount() {
  useMomentsEngine();
  return null;
}

export default function App() {
  return (
    <FixtureStoreProvider>
      <EffectsEngineMount />
      <MomentsEngineMount />
      <AppShell />
    </FixtureStoreProvider>
  );
}

/** Todo lo que necesita leer del fixtureStore (Blackout real de la Topbar,
 *  Command Palette) vive aquí en vez de en App() — mismo motivo que
 *  EffectsEngineMount: App() es quien renderiza <FixtureStoreProvider>,
 *  así que su propio cuerpo todavía no puede leer ese contexto. */
function AppShell() {
  const [section, setSection] = useState("Dashboard");
  const { blackoutActive, blackout, releaseBlackout, saveShow } = useFixtureStore();
  const dmx = useDmxOutput();
  const audio = useAudioInput();
  const remote = useRemoteControl(dmx.status.state);
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
    </div>
  );
}
