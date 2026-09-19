import { PageBody, PageHeader } from "@/components/dash/PageHeader";
import { Plus1Config } from "@/components/dash/Plus1Config";

export const metadata = { title: "plus1" };

export default function Plus1Page() {
  return (
    <>
      <PageHeader
        title="plus1"
        description="Configure the plus1 that joins your meetings — its name and voice, how far it acts on its own, when it asks instead of guessing, and which tools it can reach."
      />
      <PageBody>
        <Plus1Config />
      </PageBody>
    </>
  );
}
