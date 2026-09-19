import { PageBody, PageHeader } from "@/components/dash/PageHeader";
import { Underwrite } from "@/components/dash/Underwrite";

export const metadata = { title: "Underwrite" };

export default function UnderwritePage() {
  return (
    <>
      <PageHeader
        title="Underwrite"
        description="Federato submissions, ranked against appetite. The agent discovers the schema, plans its query, scores each property policy, and can open the account in a cloud browser to present live in the meeting."
      />
      <PageBody>
        <Underwrite />
      </PageBody>
    </>
  );
}
