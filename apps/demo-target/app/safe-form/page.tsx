"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

export default function SafeForm() {
  const [message, setMessage] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      setMessage("Please complete all required fields");
      return;
    }
    setMessage("Validation passed. No external action was performed.");
  }
  return (
    <main className="workspace">
      <Link href="/dashboard" className="back">
        ← Dashboard
      </Link>
      <p className="kicker">SAFE LOCAL MUTATION</p>
      <h1>Validation sandbox</h1>
      <form className="safeForm" onSubmit={submit} noValidate>
        <label>
          Display name
          <input aria-label="Display name" name="name" required />
        </label>
        <label>
          Category
          <select aria-label="Category" name="category" required defaultValue="">
            <option value="" disabled>
              Select a category
            </option>
            <option>Demo</option>
            <option>QA</option>
          </select>
        </label>
        <label className="check">
          <input aria-label="Confirm test data" type="checkbox" required /> Confirm this is test
          data
        </label>
        <button>Validate locally</button>
        {message && <p role="status">{message}</p>}
      </form>
    </main>
  );
}
