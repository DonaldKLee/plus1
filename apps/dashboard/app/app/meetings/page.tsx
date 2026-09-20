import { PageBody, PageHeader } from "@/components/dash/PageHeader";
import { ArchiveStats } from "@/components/dash/ArchiveStats";
import { SessionsList } from "@/components/dash/SessionsList";

export const metadata = { title: "Meetings" };

export default function MeetingsPage() {
  return (
    <>
      <PageHeader
        title="Meetings"
        description=""
      />
      <PageBody>
        <ArchiveStats />
        <SessionsList searchable />
      </PageBody>
    </>
  );
}
