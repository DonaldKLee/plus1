"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui";
import { Plus } from "@/components/icons";

/**
 * The persistent way back to the primary action. Home already leads with the
 * full join panel, so this stays out of its way and appears everywhere else.
 */
export function SendGooseButton() {
  const pathname = usePathname();
  if (pathname === "/app") return null;

  return (
    <Link href="/app">
      <Button variant="primary" size="md">
        <Plus width={14} height={14} />
        Send the goose
      </Button>
    </Link>
  );
}
