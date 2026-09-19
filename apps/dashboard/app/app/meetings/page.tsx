import { PageBody, PageHeader } from "@/components/dash/PageHeader";
import { SessionsList } from "@/components/dash/SessionsList";

export const metadata = { title: "Meetings" };

export default function MeetingsPage() {
  return (
    <>
      <PageHeader
        title="Meetings"
        description="Every room the goose has sat in. Open one to watch its live transcript."
      />
      <PageBody>
        <SessionsList />
      </PageBody>
    </>
  );
}
