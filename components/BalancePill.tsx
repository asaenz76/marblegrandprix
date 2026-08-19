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
        // Cream sticker chip: sharp corners (override the badge's rounded-full),
        // ink border + hard offset shadow, teal wallet icon.
        "rounded-md! border-2 border-border-subtle bg-surface-primary shadow-sticker-sm transition-colors hover:bg-surface-secondary",
      )}
    >
      <Wallet className="size-3.5 text-accent-primary" aria-hidden="true" />
      {formatCents(balanceCents)}
    </Link>
  );
}
