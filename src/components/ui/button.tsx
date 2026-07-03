import * as React from "react";

import { cn } from "../../lib/utils";

// Self-contained shadcn-style Button primitive (vendored into this extension's
// components/ui so the ui-design-system gate's raw-<button> ban exempts it).
// Kept dependency-light on purpose: no class-variance-authority / radix — the
// extension's dependency footprint matches the twenty/plane connector mirrors
// (clsx + tailwind-merge only). Semantic tokens only.

type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost";
type ButtonSize = "default" | "sm";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default: "border-line-strong bg-primary text-primary-foreground hover:bg-primary/80",
  destructive:
    "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
  outline: "border-border bg-background hover:bg-muted hover:text-foreground",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  ghost: "hover:bg-muted hover:text-foreground",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  default: "h-8 gap-1.5 px-2.5",
  sm: "h-7 gap-1 px-2.5 text-[0.8rem]",
};

function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: React.ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      data-slot="button"
      data-variant={variant}
      data-size={size}
      type={type}
      className={cn(
        "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  );
}

export { Button };
