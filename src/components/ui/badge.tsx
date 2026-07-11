import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Agentic Labs badge system.
 * - No border (border-transparent) — color differentiation by background only
 * - Mono font, uppercase, letter-spacing
 * - Category variants use the trace-category palette (L=60% across hues, equal APCA)
 */
const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-xs px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none transition-[color,box-shadow] overflow-hidden font-mono uppercase tracking-wider",
  {
    variants: {
      variant: {
        // Primary: accent blue
        default:
          "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        // Secondary: warm surface
        secondary:
          "bg-surface-2 text-secondary-foreground [a&]:hover:bg-surface-3",
        destructive:
          "bg-error text-white [a&]:hover:bg-error/90",
        outline:
          "border border-border text-foreground [a&]:hover:bg-accent-soft [a&]:hover:text-accent-foreground",
        // Agentic Labs category colors (L=60% bg, soft fg)
        catLlm:
          "bg-cat-llm/15 text-cat-llm",
        catAgent:
          "bg-cat-agent/15 text-cat-agent",
        catTool:
          "bg-cat-tool/15 text-cat-tool",
        catChain:
          "bg-cat-chain/15 text-cat-chain",
        catRetrieval:
          "bg-cat-retrieval/15 text-cat-retrieval",
        catGuardrail:
          "bg-cat-guardrail/15 text-cat-guardrail",
        // Status variants
        success:
          "bg-success/15 text-success",
        warning:
          "bg-warning/15 text-warning",
        error:
          "bg-error/15 text-error",
        pending:
          "bg-pending/15 text-pending",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
