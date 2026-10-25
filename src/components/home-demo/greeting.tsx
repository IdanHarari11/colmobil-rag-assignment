"use client";

import type { ReactNode } from "react";
import { HE_UI } from "@/lib/user-facing-he";
import { typeSection } from "./styles";

export function Greeting(): ReactNode {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 mx-auto mb-8 flex w-full max-w-(--thread-max-width) flex-col items-center text-center duration-200">
      <p className="text-foreground mb-2 text-2xl font-semibold tracking-tight" dir="rtl">
        {HE_UI.brandName}
      </p>
      <p className={typeSection} dir="rtl">
        {HE_UI.heroPrompt}
      </p>
    </div>
  );
}
