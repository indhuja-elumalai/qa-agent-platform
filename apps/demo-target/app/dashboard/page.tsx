import Link from "next/link";

export default function Dashboard() {
  return (
    <main className="workspace">
      <header>
        <div>
          <p className="kicker">DEMO OPERATIONS</p>
          <h1>Dashboard</h1>
        </div>
        <span className="status">● Systems nominal</span>
      </header>
      <section className="hero">
        <p>Tuesday overview</p>
        <strong>8</strong>
        <span>safe checks ready for automation</span>
      </section>
      <section className="grid">
        <Link className="agentCard" href="/agent">
          <span className="icon">A2</span>
          <div>
            <p className="kicker">AUTOMATION AGENT</p>
            <h2>Agent workspace</h2>
            <span>Open read-only agent details →</span>
          </div>
        </Link>
        <Link className="plainCard" href="/safe-form">
          <p className="kicker">STAGING-STYLE FORM</p>
          <h2>Validation sandbox</h2>
          <span>Open safe form →</span>
        </Link>
      </section>
    </main>
  );
}
