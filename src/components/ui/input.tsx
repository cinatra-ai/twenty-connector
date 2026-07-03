import * as React from "react";

import { cn } from "../../lib/utils";

// Self-contained shadcn-style Input primitive (vendored into components/ui so
// the raw-<input> ban exempts it). Semantic tokens only.

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-[7px] border border-input bg-surface-strong px-2.5 py-1 text-base font-normal shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

// A bare hidden-input wrapper (vendored into components/ui so the raw-<input>
// ban exempts it). Used to carry the row id into a delete <form> server action.
function HiddenInput({ ...props }: React.ComponentProps<"input">) {
  return <input type="hidden" data-slot="hidden-input" {...props} />;
}

export { Input, HiddenInput };
