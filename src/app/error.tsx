"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[page-error]", error);
  }, [error]);

  return (
    <main className="site-container">
      <section className="py-16">
        <h1 className="font-sans font-bold text-off-white text-3xl">
          something went wrong
        </h1>
        <p className="font-sans text-gray text-lg" style={{ marginTop: "0.5rem" }}>
          this page hit an unexpected error.
        </p>
        <button
          onClick={reset}
          className="font-sans text-gray text-lg link-highlight"
          style={{ marginTop: "1rem" }}
        >
          try again
        </button>
      </section>
    </main>
  );
}
