import { PageBody, PageHeader } from "@/components/dash/PageHeader";
import { ArchiveStats } from "@/components/dash/ArchiveStats";
import { SessionsList } from "@/components/dash/SessionsList";

export const metadata = { title: "Meetings" };

export default function MeetingsPage() {
  return (
    <>
      <PageHeader
        title="Meetings"
        description="Every room the plus1 has sat in. Transcripts are saved to MongoDB — open one to read it back, or search across all of them."
      />
      <PageBody>
        <ArchiveStats />
        <SessionsList searchable />
      </PageBody>
    </>
  );
}
