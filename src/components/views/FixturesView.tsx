import { FixtureManager } from "@/components/fixtures/FixtureManager";
import { FixtureControl } from "@/components/fixtures/FixtureControl";
import { useFixtureStore } from "@/lib/fixtureStore";

export function FixturesView() {
  const { selectInstance } = useFixtureStore();

  return (
    <div className="flex min-w-0 flex-1 gap-2 p-2">
      <div className="min-w-0 flex-1">
        <FixtureManager onOpenControl={selectInstance} />
      </div>
      <div className="w-[380px] shrink-0">
        <FixtureControl />
      </div>
    </div>
  );
}
