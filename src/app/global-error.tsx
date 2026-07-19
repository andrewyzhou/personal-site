"use client";

// replaces the root layout when it crashes, so globals.css is not available here —
// styling must be inline and self-contained
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          backgroundColor: "oklch(17.3% 0 0)",
          color: "oklch(73.8% 0 0)",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <h1 style={{ color: "oklch(94.9% 0 0)", fontSize: "1.5rem", marginBottom: "0.5rem" }}>
            something went wrong
          </h1>
          <button
            onClick={reset}
            style={{
              background: "none",
              border: "none",
              color: "oklch(73.8% 0 0)",
              cursor: "pointer",
              fontSize: "1rem",
              textDecoration: "underline",
            }}
          >
            try again
          </button>
        </div>
      </body>
    </html>
  );
}
