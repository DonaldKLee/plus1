"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { Arrow } from "@/components/icons";

export function ConsoleButton() {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* pop-up preview */}
      <div
        className="pointer-events-none absolute bottom-full right-0"
        style={{
          opacity: hovered ? 1 : 0,
          transform: hovered
            ? "translateY(0) scale(1)"
            : "translateY(8px) scale(0.96)",
          transition: "opacity 0.18s ease, transform 0.18s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <img
          src="/join-call.png"
          alt="A preview of the plus1 console"
          width={30}
          height={20}
          className="h-auto w-[30px]"
        />
      </div>

      <Link href="/app">
        <Button variant="primary" size="lg">
          Open the console
          <Arrow width={16} height={16} />
        </Button>
      </Link>
    </div>
  );
}
