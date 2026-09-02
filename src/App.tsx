import { useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { FixtureStoreProvider } from "@/lib/fixtureStore";
import { DashboardView } from "@/components/views/DashboardView";
import { FixturesView } from "@/components/views/FixturesView";
import { PlaceholderView } from "@/components/views/PlaceholderView";

// A qué fase del plan (sección 33 del brief) corresponde cada sección del
// Sidebar que todavía no está implementada.
const PENDING_PHASE: Record<string, string> = {
  Groups: "Fase 4 — Programming",
  Scenes: "Fase 4 — Programming",
  Chases: "Fase 4 — Programming",
  Effects: "Fase 4 — Programming",
  Timeline: "Fase 4 — Programming",
  "Audio Reactive": "Fase 5 — Live",
  Universes: "el motor DMX (fuera del alcance frontend de las Fases 1-6)",
  "DMX Output": "el motor DMX (fuera del alcance frontend de las Fases 1-6)",
  Settings: "una fase de configuración general aún no planificada",
};

export default function App() {
  const [section, setSection] = useState("Dashboard");

  return (
    <FixtureStoreProvider>
      <div className="flex h-screen flex-col bg-bg">
        <Topbar
          showName="Concierto 01"
          dmxConnected={false}
          universe={1}
          bpm={128}
          cpu={18}
          fps={60}
          onBlackout={() => {
            /* Sin motor DMX todavía — ver AUDIT.md. */
          }}
        />

        <div className="flex min-h-0 flex-1">
          <Sidebar active={section} onSelect={setSection} />

          {section === "Dashboard" ? <DashboardView /> : null}
          {section === "Fixtures" ? <FixturesView /> : null}
          {PENDING_PHASE[section] ? (
            <PlaceholderView section={section} phase={PENDING_PHASE[section]} />
          ) : null}
        </div>
      </div>
    </FixtureStoreProvider>
  );
}
