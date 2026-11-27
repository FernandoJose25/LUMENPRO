import { useEffect, useState } from "react";
import { Sidebar, SECTIONS } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { FixtureStoreProvider, useFixtureStore } from "@/lib/fixtureStore";
import { DashboardView } from "@/components/views/DashboardView";
import { FixturesView } from "@/components/views/FixturesView";
import { GroupsView } from "@/components/groups/GroupsView";
import { ScenesView } from "@/components/scenes/ScenesView";
import { ChasesView } from "@/components/chases/ChasesView";
import { EffectsView } from "@/components/effects/EffectsView";
import { PalettesView } from "@/components/palettes/PalettesView";
import { MidiView } from "@/components/midi/MidiView";
import { AudioView } from "@/components/audio/AudioView";
import { LiveView } from "@/components/live/LiveView";
import { DmxOutputView } from "@/components/dmx/DmxOutputView";
import { UniversesView } from "@/components/dmx/UniversesView";
import { MomentsView } from "@/components/moments/MomentsView";
import { RemoteView } from "@/components/remote/RemoteView";
import { StageView } from "@/components/stage/StageView";
import { TimelineView } from "@/components/timeline/TimelineView";
import { MusicView } from "@/components/music/MusicView";
import { SettingsView } from "@/components/views/SettingsView";
import { GuideView } from "@/components/views/GuideView";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { DialogHost } from "@/components/ui/DialogHost";
import { useAudioInput } from "@/lib/audioInput";
import { useDmxOutput } from "@/lib/dmxOutput";
import { useRemoteControl } from "@/lib/remoteControl";
import { useStagePublisher } from "@/lib/stageMirror";
import { useTimelineAudio } from "@/lib/timelineAudio";
import { useMusicPlayer } from "@/lib/musicPlayer";
import { useLinkPlayer } from "@/lib/links";
import { useMusicLights } from "@/lib/musicLights";
import { PC_AUDIO } from "@/lib/pcAudio";
import { useEffectCatalog } from "@/lib/effectCatalog";

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
  useTimelineAudio();
  const music = useMusicPlayer();
  // Un enlace (YouTube/Spotify) suena en la PC: pausa la canción guardada y
  // las luces pasan a escuchar lo que suena en esta PC.
  const lights = useMusicLights();
  const links = useLinkPlayer(() => {
    if (music.playing) music.toggle();
    if (audio.deviceId !== PC_AUDIO) audio.setDeviceId(PC_AUDIO);
    if (!audio.listening) void audio.start();
    lights.onMusicStart();
  });
  // Una canción guardada que empieza a sonar: ya no suena el enlace, y las
  // luces siguen la música si nada la seguía.
  const { forget: forgetLink } = links;
  const { onMusicStart } = lights;
  useEffect(() => {
    if (!music.playing) return;
    forgetLink();
    onMusicStart();
  }, [music.playing, forgetLink, onMusicStart]);
  useEffectCatalog();

  return (
    <div className="flex h-screen flex-col bg-bg">
      <Topbar
        dmx={dmx.status}
        bpm={music.bpm !== null ? Math.round(music.bpm) : audio.bpm}
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
        {section === "Línea de tiempo" ? <TimelineView /> : null}
        {section === "Música" ? <MusicView music={music} links={links} lights={lights} audio={audio} /> : null}
        {section === "Escenario" ? <StageView /> : null}
        {section === "Fixtures" ? <FixturesView /> : null}
        {section === "Groups" ? <GroupsView /> : null}
        {section === "Scenes" ? <ScenesView /> : null}
        {section === "Chases" ? <ChasesView /> : null}
        {section === "Effects" ? <EffectsView /> : null}
        {section === "Paletas" ? <PalettesView /> : null}
        {section === "Audio Reactive" ? <AudioView audio={audio} /> : null}
        {section === "Universes" ? <UniversesView dmx={dmx} /> : null}
        {section === "DMX Output" ? <DmxOutputView dmx={dmx} /> : null}
        {section === "MIDI" ? <MidiView /> : null}
        {section === "Celular" ? <RemoteView remote={remote} /> : null}
        {section === "Settings" ? <SettingsView /> : null}
        {section === "Guía" ? <GuideView /> : null}
      </div>

      <CommandPalette sections={SECTIONS} activeSection={section} onSelectSection={setSection} />
      <DialogHost />
    </div>
  );
}
