"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // Gate the theme-dependent icon on mount so SSR and the first client render
  // agree (both render the light-mode Moon), then swap to the real icon after
  // hydration. This uses useState+useEffect rather than a useSyncExternalStore
  // "isMounted" snapshot: that pattern left the button stuck in its unmounted,
  // icon-less state in this Next/React setup, so the toggle was invisible.
  const [mounted, setMounted] = useState(false);
  // The one-shot mount flip is the whole point here (match SSR, then reveal the
  // real theme icon) — the "cascading renders" the rule warns about don't apply.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
