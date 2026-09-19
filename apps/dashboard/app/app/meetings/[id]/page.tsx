import { LiveTranscript } from "@/components/console/LiveTranscript";

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <LiveTranscript sessionId={id} />
    </div>
  );
}
