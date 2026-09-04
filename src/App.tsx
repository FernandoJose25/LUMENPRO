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
import { LiveView } from "@/components/live/LiveView";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { useEffectsEngine } from "@/lib/effectEngine";
import { PlaceholderView } from "@/components/views/PlaceholderView";

// A qué fase del plan (sección 33 del brief) corresponde cada sección del
// Sidebar que todavía no está implementada.
const PENDING_PHASE: Record<string, string> = {
  Timeline: "Fase 4 — Programming",
  "Audio Reactive": "Fase 5 — Live",
  Universes: "el motor DMX (fuera del alcance frontend de las Fases 1-6)",
  "DMX Output": "el motor DMX (fuera del alcance frontend de las Fases 1-6)",
  Settings: "una fase de configuración general aún no planificada",
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

export default function App() {
  return (
    <FixtureStoreProvider>
      <EffectsEngineMount />
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
  const { blackout } = useFixtureStore();

  return (
    <div className="flex h-screen flex-col bg-bg">
      <Topbar
        showName="Concierto 01"
        dmxConnected={false}
        universe={1}
        bpm={128}
        cpu={18}
        fps={60}
        onBlackout={blackout}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar active={section} onSelect={setSection} />

        {section === "Dashboard" ? <DashboardView /> : null}
        {section === "Live" ? <LiveView /> : null}
        {section === "Fixtures" ? <FixturesView /> : null}
        {section === "Groups" ? <GroupsView /> : null}
        {section === "Scenes" ? <ScenesView /> : null}
        {section === "Chases" ? <ChasesView /> : null}
        {section === "Effects" ? <EffectsView /> : null}
        {PENDING_PHASE[section] ? (
          <PlaceholderView section={section} phase={PENDING_PHASE[section]} />
        ) : null}
      </div>

      <CommandPalette sections={SECTIONS} activeSection={section} onSelectSection={setSection} />
    </div>
  );
}
