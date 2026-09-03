import Link from "next/link";
import { Logo } from "./Logo";

export function TopBar({ user, current }: { user: { id: string; admin: boolean }; current: "home" | "admin" }) {
  return (
    <header className="topbar">
      <Link href="/" className="brand"><span className="mark" aria-hidden="true"><Logo /></span>SAM <span>Accops collateral</span></Link>
      <nav className="nav" aria-label="Main">
        <Link href="/" aria-current={current === "home" ? "page" : undefined}>Ask & browse</Link>
        {user.admin && <Link href="/admin" aria-current={current === "admin" ? "page" : undefined}>Dashboard</Link>}
        <form action="/api/logout" method="post"><button type="submit" title={`Signed in as ${user.id}`}>Sign out</button></form>
      </nav>
    </header>
  );
}
