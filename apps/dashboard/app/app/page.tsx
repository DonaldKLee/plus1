import Link from "next/link";
import { PageBody } from "@/components/dash/PageHeader";
import { HomeHero } from "@/components/dash/HomeHero";
import { SessionsList } from "@/components/dash/SessionsList";

export default function DashboardHome() {
  return (
    <>
      <HomeHero />

      <PageBody>
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-fg">
              Recent meetings
            </h2>
            <Link
              href="/app/meetings"
              className="text-[13px] font-medium text-fg-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
            >
              View all
            </Link>
          </div>
          <SessionsList limit={5} />
        </section>
      </PageBody>
    </>
  );
}
