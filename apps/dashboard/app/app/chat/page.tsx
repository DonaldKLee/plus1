import { Chat } from "@/components/chat/Chat";

export const metadata = { title: "Chat" };

export default function ChatPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Chat />
    </div>
  );
}
