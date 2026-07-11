import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30",
  {
    variants: {
      variant: {
        // Agentic Labs primary: blue-600 bg, white text, no border, subtle shadow
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-accent-strong active:scale-[0.98]",
        destructive:
          "bg-destructive text-white shadow-sm hover:bg-destructive/90 focus-visible:ring-destructive/20 active:scale-[0.98]",
        // Agentic Labs secondary: warm surface-2 bg, no border
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-surface-3 active:scale-[0.98]",
        // Agentic Labs outline: subtle border (used sparingly)
        outline:
          "border border-border bg-transparent shadow-xs hover:bg-accent-soft hover:text-accent-foreground active:scale-[0.98]",
        // Agentic Labs ghost: transparent, blue text on hover
        ghost:
          "bg-transparent text-muted-foreground hover:bg-accent-soft hover:text-accent-foreground active:scale-[0.98]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5 text-xs",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
