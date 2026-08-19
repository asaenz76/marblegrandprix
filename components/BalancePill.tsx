import Link from "next/link";
import { Wallet } from "lucide-react";
import { formatCents } from "@/lib/utils/money";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function BalancePill({ balanceCents }: { balanceCents: number }) {
  return (
    <Link
      href="/wallet"
      className={cn(
        badgeVariants({ variant: "primary", size: "lg" }),
        // Bold gold theme: the wallet pill is a black chip with gold text/icon.
        // In dark mode a pure-black pill would vanish on the near-black header,
        // so it steps up to the elevated dark surface, keeping the gold text.
        "border border-black bg-black text-[#ffe100] transition-colors hover:bg-[#1a1a1a]",
        "dark:border-border-subtle dark:bg-surface-elevated dark:hover:bg-surface-secondary",
      )}
    >
      <Wallet className="size-3.5 text-[#ffe100]" aria-hidden="true" />
      {formatCents(balanceCents)}
    </Link>
  );
}
