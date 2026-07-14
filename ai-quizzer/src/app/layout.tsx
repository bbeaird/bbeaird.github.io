import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { LogoutButton } from "./nav-client";

export const metadata: Metadata = {
  title: "AI Quizzer",
  description: "Adaptive daily quizzes that turn the AI content you consume into knowledge you keep.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            <span className="brand-mark">⚡</span> AI Quizzer
          </Link>
          <nav>
            {user ? (
              <>
                <Link href="/quiz">Today&apos;s Quiz</Link>
                <Link href="/dashboard">Dashboard</Link>
                <LogoutButton />
              </>
            ) : (
              <>
                <Link href="/login">Log in</Link>
                <Link href="/signup" className="btn btn-small">
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
