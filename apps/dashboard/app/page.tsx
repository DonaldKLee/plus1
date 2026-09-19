"use client";

import { useState } from "react";
import { NavRail, type View } from "@/components/NavRail";
import { ConsoleView } from "@/components/ConsoleView";
import { Setup } from "@/components/Setup";
import { Integrations } from "@/components/Integrations";

export default function Page() {
  const [view, setView] = useState<View>("console");

  return (
    <main className="flex min-h-[100dvh] gap-2.5 overflow-y-auto p-2.5 lg:h-[100dvh] lg:overflow-hidden">
      <NavRail view={view} onView={setView} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {view === "console" && <ConsoleView />}
        {view === "setup" && <Setup />}
        {view === "integrations" && <Integrations />}
      </div>
    </main>
  );
}
