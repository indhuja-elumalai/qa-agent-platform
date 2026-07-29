"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const [error, setError] = useState("");
  const router = useRouter();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
    });
    if (!response.ok) {
      const body = await response.json();
      setError(body.error);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <main className="center">
      <section className="loginCard">
        <p className="kicker">QA DEMO WORKSPACE</p>
        <h1>Welcome back</h1>
        <p className="muted">Use the deterministic demo account to continue.</p>
        <form onSubmit={submit}>
          <label>
            Email
            <input
              aria-label="Email"
              name="email"
              type="email"
              placeholder="demo@example.test"
              required
            />
          </label>
          <label>
            Password
            <input
              aria-label="Password"
              name="password"
              type="password"
              placeholder="Password"
              required
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button data-testid="login-button" type="submit">
            Login
          </button>
        </form>
        <small>Demo: demo@example.test / demo-password</small>
      </section>
    </main>
  );
}
