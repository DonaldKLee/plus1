import { PageBody, PageHeader } from "@/components/dash/PageHeader";
import { GooseConfig } from "@/components/dash/GooseConfig";

export const metadata = { title: "Goose" };

export default function GoosePage() {
  return (
    <>
      <PageHeader
        title="Goose"
        description="Configure the goose that joins your meetings — its name and voice, how far it acts on its own, when it asks instead of guessing, and which tools it can reach."
      />
      <PageBody>
        <GooseConfig />
      </PageBody>
    </>
  );
}
