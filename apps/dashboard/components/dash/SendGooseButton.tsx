"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui";
import { Plus } from "@/components/icons";

export function SendGooseButton() {
  const pathname = usePathname();
  if (pathname === "/app") return null;

  return (
    <Link href="/app">
      <Button variant="primary" size="md">
        <Plus width={14} height={14} />
        Send plus1
      </Button>
    </Link>
  );
}
