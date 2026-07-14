import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { QuizClient } from "./quiz-client";

export default async function QuizPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <QuizClient />;
}
