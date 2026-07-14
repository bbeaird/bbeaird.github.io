import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect("/quiz");

  return (
    <div className="hero">
      <h1>
        Stop just consuming AI content.
        <br />
        Start retaining it.
      </h1>
      <p>
        A 3-minute adaptive daily quiz built from the podcasts, newsletters, and courses you already
        follow — with an explanation for every answer, right or wrong.
      </p>
      <Link href="/signup" className="btn">
        Start your first quiz
      </Link>

      <div className="feature-grid">
        <div className="feature">
          <h3>📚 Grounded in real sources</h3>
          <p>
            Questions inspired by The AI Daily Brief, Lenny&apos;s Newsletter, Andrew Ng&apos;s The
            Batch, and official model-provider docs — every explanation cites its source.
          </p>
        </div>
        <div className="feature">
          <h3>🎯 Adapts to you</h3>
          <p>
            Mastery is tracked per topic. Weak areas show up more often, and difficulty ramps from
            recall to nuanced tradeoffs as you improve.
          </p>
        </div>
        <div className="feature">
          <h3>🔁 Misses come back</h3>
          <p>
            Questions you get wrong resurface in later quizzes until you get them right — the
            fastest path from &quot;I heard that once&quot; to &quot;I know that.&quot;
          </p>
        </div>
        <div className="feature">
          <h3>🧠 Learn either way</h3>
          <p>
            Wrong answers get a full explanation of why. Right answers get a deeper nuance note, so
            every question teaches you something.
          </p>
        </div>
      </div>
    </div>
  );
}
