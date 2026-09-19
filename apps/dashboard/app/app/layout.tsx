import type { Metadata } from "next";
import { Sidebar } from "@/components/dash/Sidebar";

export const metadata: Metadata = {
  title: "Console",
};

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="theme-dark flex min-h-[100dvh] flex-col bg-bg text-fg lg:h-[100dvh] lg:flex-row lg:overflow-hidden">
      <Sidebar />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col lg:overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
