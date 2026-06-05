"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  MessageSquare,
  FileText,
  StickyNote,
  CheckSquare,
  Brain,
  Settings,
} from "lucide-react";

const navItems = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/notes", label: "Notes", icon: StickyNote },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function NavSidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main navigation"
      style={{ width: "var(--sidebar-width)", background: "var(--sidebar-bg)", borderRight: "1px solid var(--sidebar-border)" }}
      className="flex flex-col h-full shrink-0 py-4"
    >
      {/* Logo */}
      <div className="px-4 mb-6 flex items-center gap-2">
        <Image
          src="/lantern-logo.png"
          alt="Lantern logo"
          width={28}
          height={28}
          priority
          className="shrink-0"
        />
        <span className="text-lg font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
          Lantern
        </span>
      </div>

      {/* Nav items */}
      <ul className="flex flex-col gap-1 px-2 flex-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + "/");
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "font-semibold"
                    : "hover:opacity-80"
                )}
                style={{
                  color: isActive ? "var(--sidebar-item-active-text)" : "var(--sidebar-text)",
                  background: isActive ? "var(--sidebar-item-active)" : "transparent",
                }}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <div className="px-4 pt-4" style={{ borderTop: "1px solid var(--sidebar-border)" }}>
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          Lantern v0.1
        </p>
      </div>
    </nav>
  );
}
