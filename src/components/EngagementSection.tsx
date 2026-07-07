"use client";

import { useEffect, useRef, useState } from "react";

// public engagement bar + comments for blog posts, photosets, and activities.
// degrades quietly: if the api is down the section renders nothing noisy and
// the page content is unaffected.

interface CommentItem {
  id: number;
  authorName: string;
  isGuest: boolean;
  body: string;
  createdAt: string;
}

interface Summary {
  comments: CommentItem[];
  likes: number;
  liked: boolean;
  claps: number;
  views: number;
  me: { signedIn: boolean; name?: string };
}

export default function EngagementSection({ target }: { target: string }) {
  const [data, setData] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [signInPrompt, setSignInPrompt] = useState(false);
  const pendingClaps = useRef(0);
  const clapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // comment form state
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [posting, setPosting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/engagement?target=${encodeURIComponent(target)}`)
      .then(async (res) => {
        const payload = await res.json().catch(() => null);
        if (!cancelled) {
          if (payload?.data) setData(payload.data);
          else setFailed(true);
        }
      })
      .catch(() => !cancelled && setFailed(true));

    // count a view once per session
    try {
      const key = `viewed:${target}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        fetch("/api/engagement/views", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target }),
        }).catch(() => {});
      }
    } catch {
      // sessionStorage unavailable — skip counting
    }

    return () => {
      cancelled = true;
    };
  }, [target]);

  if (failed || !data) return null;

  async function toggleLike() {
    if (!data) return;
    if (!data.me.signedIn) {
      setSignInPrompt(true);
      return;
    }
    const res = await fetch("/api/engagement/likes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
    const payload = await res.json().catch(() => null);
    if (payload?.data) {
      setData({ ...data, liked: payload.data.liked, likes: payload.data.likes });
    }
  }

  function clap() {
    if (!data) return;
    setData({ ...data, claps: data.claps + 1 });
    pendingClaps.current += 1;
    if (clapTimer.current) clearTimeout(clapTimer.current);
    clapTimer.current = setTimeout(() => {
      const pending = pendingClaps.current;
      pendingClaps.current = 0;
      if (pending > 0) {
        fetch("/api/engagement/claps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target, count: pending }),
        }).catch(() => {});
      }
    }, 800);
  }

  async function postComment() {
    if (!data) return;
    setPosting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/engagement/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, body, authorName: name, website }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.data) {
        setFormError(payload?.error?.message ?? "comment failed");
        return;
      }
      if (payload.data.id) {
        setData({ ...data, comments: [payload.data, ...data.comments] });
      }
      setBody("");
    } catch {
      setFormError("comment failed — check your connection");
    } finally {
      setPosting(false);
    }
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const month = d.toLocaleDateString("en-US", { month: "short" }).toLowerCase();
    return `${month} ${d.getDate()}, ${d.getFullYear()}`;
  };

  return (
    <section style={{ marginTop: "3rem" }}>
      {/* bar */}
      <div className="flex items-center" style={{ gap: "16px" }}>
        <button
          onClick={toggleLike}
          className={`font-sans text-sm ${data.liked ? "text-off-white link-highlight-active" : "text-gray link-highlight"}`}
          aria-label="like"
        >
          ♥ {data.likes > 0 ? data.likes : ""}
        </button>
        <button onClick={clap} className="font-sans text-gray text-sm link-highlight" aria-label="clap">
          👏 {data.claps > 0 ? data.claps : ""}
        </button>
        <span className="font-sans text-gray text-xs" style={{ marginLeft: "auto" }}>
          {data.views > 0 ? `${data.views} view${data.views === 1 ? "" : "s"}` : ""}
        </span>
      </div>

      {signInPrompt && (
        <p className="font-sans text-gray text-sm italic" style={{ marginTop: "0.5rem" }}>
          <a href={`/api/auth/signin?callbackUrl=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : "/")}`} className="link-highlight">
            sign in with google
          </a>{" "}
          to like — claps are open to everyone
        </p>
      )}

      {/* comments */}
      <div style={{ marginTop: "1.5rem" }}>
        <p className="font-sans text-off-white text-sm font-medium" style={{ marginBottom: "0.75rem" }}>
          comments{data.comments.length > 0 ? ` (${data.comments.length})` : ""}
        </p>

        <div className="flex flex-col" style={{ gap: "8px", marginBottom: "1rem" }}>
          {!data.me.signedIn && (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="name (optional)"
              className="font-sans text-off-white text-sm"
              style={{
                padding: "8px 12px", borderRadius: 8, width: "100%", maxWidth: "240px",
                backgroundColor: "var(--theme-card-bg)", border: "1px solid var(--theme-highlight-bg)",
              }}
            />
          )}
          {/* honeypot — visually hidden, bots fill it */}
          <input
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", height: 0, width: 0, opacity: 0 }}
            placeholder="website"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={data.me.signedIn ? `comment as ${data.me.name}…` : "leave a comment…"}
            rows={3}
            className="font-sans text-off-white text-sm"
            style={{
              padding: "8px 12px", borderRadius: 8, width: "100%",
              backgroundColor: "var(--theme-card-bg)", border: "1px solid var(--theme-highlight-bg)",
            }}
          />
          {formError && <p className="font-sans text-gray text-xs italic">⚠ {formError}</p>}
          <button
            onClick={postComment}
            disabled={posting || body.trim().length < 2}
            className="font-sans text-gray text-sm link-highlight rounded"
            style={{ alignSelf: "flex-start", padding: "4px 10px", opacity: body.trim().length < 2 ? 0.5 : 1 }}
          >
            {posting ? "posting…" : "post"}
          </button>
        </div>

        <div className="flex flex-col" style={{ gap: "10px" }}>
          {data.comments.map((c) => (
            <div key={c.id}>
              <p className="font-sans text-gray text-xs">
                <span className="text-off-white">{c.authorName}</span>
                {c.isGuest ? "" : " ✓"} · {formatDate(c.createdAt)}
              </p>
              <p className="font-sans text-secondary text-sm" style={{ marginTop: "2px", whiteSpace: "pre-wrap" }}>{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
