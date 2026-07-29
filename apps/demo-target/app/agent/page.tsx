import Link from "next/link";

export default function AgentPage() {
  return (
    <main className="workspace">
      <Link href="/dashboard" className="back">
        ← Dashboard
      </Link>
      <p className="kicker">READ ONLY</p>
      <h1>Agent workspace</h1>
      <section className="detail">
        <div>
          <span>Agent ID</span>
          <strong>DEMO-A2</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>Available</strong>
        </div>
        <div>
          <span>Mode</span>
          <strong>Observation only</strong>
        </div>
      </section>
      <p className="note">
        This page is intentionally read-only and contains no pilot application data.
      </p>
    </main>
  );
}
