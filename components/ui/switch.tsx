"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // Bold gold theme (light): black track when off, gold when on. Dark
        // mode keeps its original grey-off / accent-on look.
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-black transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-[#ffe100] dark:bg-surface-secondary dark:data-checked:bg-accent-primary",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-checked:translate-x-4 data-checked:bg-black dark:data-checked:bg-white"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
