import * as React from "react";

import { cn } from "../../lib/utils";

// Self-contained shadcn-style Badge primitive (vendored into components/ui).
// Dependency-light: no class-variance-authority / radix. Semantic tokens only.

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  destructive: "bg-destructive/10 text-destructive",
  outline: "border-border text-foreground",
};

function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & { variant?: BadgeVariant }) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
