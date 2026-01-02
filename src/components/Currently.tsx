"use client";

import { useEffect, useState, useRef, useCallback } from "react";

interface SpotifyTrack {
  isPlaying: boolean;
  title: string;
  artist: string;
  playedAt?: string;
  songUrl?: string;
  fetchedAt?: number;
  previousFetchedAt?: number | null;
}

interface StravaActivity {
  id: number;
  name: string;
  type: string;
  formattedDistance: string;
  formattedDuration: string;
  startDate: string;
  fetchedAt?: number;
  previousFetchedAt?: number | null;
}

interface LiteralBook {
  id: string;
  slug: string;
  title: string;
  authors: { id: string; name: string }[];
  fetchedAt?: number;
  previousFetchedAt?: number | null;
}

export default function Currently() {
  const [spotify, setSpotify] = useState<SpotifyTrack | null>(null);
  const [strava, setStrava] = useState<StravaActivity | null>(null);
  const [book, setBook] = useState<LiteralBook | null>(null);
  const [apiCalls, setApiCalls] = useState<number | null>(null);
  const [prevApiCalls, setPrevApiCalls] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // typing animation state
  const [displayedText, setDisplayedText] = useState("");
  const [ellipsis, setEllipsis] = useState("...");
  const [isTypingComplete, setIsTypingComplete] = useState(false);
  const hasStartedTypingRef = useRef(false);

  // api calls counter animation state
  const [displayedApiCalls, setDisplayedApiCalls] = useState<string>("");

  // footer animation state
  const [cachedFetchedAt, setCachedFetchedAt] = useState<number | null>(null);
  const [displayedFetchTime, setDisplayedFetchTime] = useState<string>("");
  const [footerAnimationPhase, setFooterAnimationPhase] = useState<"idle" | "fetch_time" | "api_calls" | "done">("idle");
  const [wasRefetched, setWasRefetched] = useState(false);

  // cursor state: tracks which line the cursor is on
  const [cursorLine, setCursorLine] = useState<"body" | "fetch_time" | "api_calls" | "none">("body");
  const [isTypingActive, setIsTypingActive] = useState(false);

  const INITIAL_TEXT = "i'm currently reading ";
  const TYPING_SPEED = 45; // ms per character
  const LINE_TRANSITION_DELAY = 2000; // 2 seconds between lines
  const PRE_TYPE_DELAY = 1000; // 1 second before starting to type

  // ellipsis animation while loading
  useEffect(() => {
    if (loading && displayedText === INITIAL_TEXT) {
      const ellipsisStates = ["...", "..", ".", "..", "...", "..", "."];
      let index = 0;
      const interval = setInterval(() => {
        index = (index + 1) % ellipsisStates.length;
        setEllipsis(ellipsisStates[index]);
      }, 300);
      return () => clearInterval(interval);
    }
  }, [loading, displayedText]);

  // type out initial text on mount
  useEffect(() => {
    if (hasStartedTypingRef.current) return;
    hasStartedTypingRef.current = true;

    setIsTypingActive(true);
    let charIndex = 0;
    const typeInitial = () => {
      if (charIndex < INITIAL_TEXT.length) {
        setDisplayedText(INITIAL_TEXT.slice(0, charIndex + 1));
        charIndex++;
        setTimeout(typeInitial, TYPING_SPEED);
      } else {
        setIsTypingActive(false);
      }
    };
    typeInitial();
  }, []);

  // continue typing after data loads
  const continueTyping = useCallback((remainingText: string) => {
    setIsTypingActive(true);
    let charIndex = 0;

    const typeNext = () => {
      if (charIndex < remainingText.length) {
        const char = remainingText[charIndex];
        charIndex++;
        setDisplayedText(prev => prev + char);
        setTimeout(typeNext, TYPING_SPEED);
      } else {
        setIsTypingActive(false);
        setIsTypingComplete(true);
      }
    };
    typeNext();
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        const [spotifyRes, stravaRes, literalRes, statsRes] = await Promise.all([
          fetch("/api/spotify"),
          fetch("/api/strava"),
          fetch("/api/literal"),
          fetch("/api/stats"),
        ]);

        let maxFetchedAt: number | null = null;
        let maxPreviousFetchedAt: number | null = null;

        if (spotifyRes.ok) {
          const data = await spotifyRes.json();
          setSpotify(data);
          if (data.fetchedAt && (!maxFetchedAt || data.fetchedAt > maxFetchedAt)) {
            maxFetchedAt = data.fetchedAt;
          }
          // track the most recent previousFetchedAt (indicates a refetch happened)
          if (data.previousFetchedAt && (!maxPreviousFetchedAt || data.previousFetchedAt > maxPreviousFetchedAt)) {
            maxPreviousFetchedAt = data.previousFetchedAt;
          }
        }

        if (stravaRes.ok) {
          const data = await stravaRes.json();
          setStrava(data);
          if (data.fetchedAt && (!maxFetchedAt || data.fetchedAt > maxFetchedAt)) {
            maxFetchedAt = data.fetchedAt;
          }
          if (data.previousFetchedAt && (!maxPreviousFetchedAt || data.previousFetchedAt > maxPreviousFetchedAt)) {
            maxPreviousFetchedAt = data.previousFetchedAt;
          }
        }

        if (literalRes.ok) {
          const data = await literalRes.json();
          setBook(data);
          if (data.fetchedAt && (!maxFetchedAt || data.fetchedAt > maxFetchedAt)) {
            maxFetchedAt = data.fetchedAt;
          }
          if (data.previousFetchedAt && (!maxPreviousFetchedAt || data.previousFetchedAt > maxPreviousFetchedAt)) {
            maxPreviousFetchedAt = data.previousFetchedAt;
          }
        }

        if (statsRes.ok) {
          const data = await statsRes.json();
          setPrevApiCalls(data.prevCount);
          setApiCalls(data.apiCalls);
          // set initial displayed values immediately
          setDisplayedApiCalls(data.prevCount.toLocaleString());
        }

        // if any API was refetched, show the previous cached time first
        // otherwise show the most recent fetchedAt
        if (maxFetchedAt) {
          setCachedFetchedAt(maxFetchedAt);
          // use previousFetchedAt if any refetch happened, otherwise use current fetchedAt
          const initialDisplayTime = maxPreviousFetchedAt || maxFetchedAt;
          setDisplayedFetchTime(formatFetchedTime(initialDisplayTime));
          // track if any API was refetched so we animate the fetch time update
          setWasRefetched(maxPreviousFetchedAt !== null);
        }
      } catch (error) {
        console.error("failed to fetch currently data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const getActivityType = useCallback((type: string): string => {
    const types: Record<string, string> = {
      Run: "run",
      Ride: "bike ride",
      Swim: "swim",
      Walk: "walk",
      Hike: "hike",
      WeightTraining: "lift",
      Workout: "workout",
    };
    return types[type] || type.toLowerCase();
  }, []);

  const formatSpotifyTime = useCallback((dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffMinutes < 1) {
      return "played just now";
    } else if (diffMinutes < 60) {
      return `played ${diffMinutes} min${diffMinutes === 1 ? "" : "s"} ago`;
    } else if (diffHours < 24) {
      return `played ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
    } else {
      // for older, use date format
      const month = date.toLocaleDateString("en-US", { month: "short" }).toLowerCase();
      const day = date.getDate();
      return `played on ${month} ${day}`;
    }
  }, []);

  const formatStravaTime = useCallback((dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    // check if it's today
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) {
      return "today";
    } else if (isYesterday) {
      return "yesterday";
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
    } else {
      // use date format with lowercase month
      const month = date.toLocaleDateString("en-US", { month: "short" }).toLowerCase();
      const day = date.getDate();
      return `on ${month} ${day}`;
    }
  }, []);

  const formatFetchedTime = (timestamp: number): string => {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) {
      return "less than a minute ago";
    } else if (diffMinutes < 60) {
      return `${diffMinutes} min${diffMinutes === 1 ? "" : "s"} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
    } else {
      const date = new Date(timestamp);
      const month = date.toLocaleDateString("en-US", { month: "short" }).toLowerCase();
      const day = date.getDate();
      return `on ${month} ${day}`;
    }
  };


  // build plain text and track link info for after typing completes
  interface LinkInfo {
    start: number;
    end: number;
    url: string;
  }

  const buildPlainTextAndLinks = useCallback((): { text: string; links: LinkInfo[] } => {
    let text = "";
    const links: LinkInfo[] = [];

    // book part (first)
    if (book) {
      const authorName = book.authors?.[0]?.name?.toLowerCase() || "unknown";
      const bookTitle = book.title.toLowerCase();
      const bookText = `${bookTitle} by ${authorName}`;
      text += "i'm currently reading ";
      const linkStart = text.length;
      text += bookText;
      links.push({
        start: linkStart,
        end: text.length,
        url: `https://literal.club/book/${book.slug}`,
      });
      text += ".";
    }

    // spotify part
    if (spotify) {
      const songTitle = spotify.title.toLowerCase();
      const artistName = spotify.artist.toLowerCase();
      const songText = `${songTitle} by ${artistName}`;

      if (spotify.isPlaying) {
        text += " right now, i'm listening to ";
        const linkStart = text.length;
        text += songText;
        if (spotify.songUrl) {
          links.push({
            start: linkStart,
            end: text.length,
            url: spotify.songUrl,
          });
        }
        text += ".";
      } else if (spotify.playedAt) {
        const timeAgo = formatSpotifyTime(spotify.playedAt);
        text += " my last played song was ";
        const linkStart = text.length;
        text += songText;
        if (spotify.songUrl) {
          links.push({
            start: linkStart,
            end: text.length,
            url: spotify.songUrl,
          });
        }
        text += ", " + timeAgo + ".";
      } else {
        text += " my last played song was ";
        const linkStart = text.length;
        text += songText;
        if (spotify.songUrl) {
          links.push({
            start: linkStart,
            end: text.length,
            url: spotify.songUrl,
          });
        }
        text += ".";
      }
    }

    // strava part
    if (strava) {
      const timeAgo = formatStravaTime(strava.startDate);
      const useDuration = ["WeightTraining", "Workout", "Yoga", "Crossfit"].includes(strava.type);
      const activityMetric = useDuration ? strava.formattedDuration : strava.formattedDistance;
      const workoutText = `${activityMetric} ${getActivityType(strava.type)}`;

      text += " my last workout was a ";
      const linkStart = text.length;
      text += workoutText;
      links.push({
        start: linkStart,
        end: text.length,
        url: `https://www.strava.com/activities/${strava.id}`,
      });
      text += " " + timeAgo + ".";
    }

    return { text, links };
  }, [book, spotify, strava, formatSpotifyTime, formatStravaTime, getActivityType]);

  // trigger continue typing when data loads
  useEffect(() => {
    if (!loading && displayedText === INITIAL_TEXT && (book || spotify || strava)) {
      const { text } = buildPlainTextAndLinks();
      // get the remaining text after "i'm currently reading"
      const remainingText = text.slice(INITIAL_TEXT.length);
      continueTyping(remainingText);
    }
  }, [loading, displayedText, book, spotify, strava, buildPlainTextAndLinks, continueTyping]);

  // reusable delete/type animation function
  const animateDeleteType = useCallback((
    oldStr: string,
    newStr: string,
    setDisplay: (s: string) => void,
    onComplete: () => void
  ) => {
    setIsTypingActive(true);
    let deleteIndex = oldStr.length;
    const deleteChar = () => {
      if (deleteIndex > 0) {
        deleteIndex--;
        setDisplay(oldStr.slice(0, deleteIndex));
        setTimeout(deleteChar, TYPING_SPEED);
      } else {
        // pause after deleting before typing new text
        setIsTypingActive(false);
        setTimeout(() => {
          setIsTypingActive(true);
          let typeIndex = 0;
          const typeChar = () => {
            if (typeIndex < newStr.length) {
              typeIndex++;
              setDisplay(newStr.slice(0, typeIndex));
              setTimeout(typeChar, TYPING_SPEED);
            } else {
              setIsTypingActive(false);
              onComplete();
            }
          };
          typeChar();
        }, PRE_TYPE_DELAY);
      }
    };
    deleteChar();
  }, []);

  // footer animation: after body typing completes, animate fetch time (if refetched), then api calls
  useEffect(() => {
    if (!isTypingComplete || footerAnimationPhase !== "idle") return;
    if (cachedFetchedAt === null || prevApiCalls === null || apiCalls === null) return;

    const animateApiCalls = () => {
      // move cursor to api_calls line, wait, then start typing
      setCursorLine("api_calls");
      setTimeout(() => {
        setFooterAnimationPhase("api_calls");
        const oldStr = prevApiCalls.toLocaleString();
        const newStr = apiCalls.toLocaleString();
        animateDeleteType(oldStr, newStr, setDisplayedApiCalls, () => {
          setFooterAnimationPhase("done");
          setCursorLine("none");
        });
      }, PRE_TYPE_DELAY);
    };

    // wait 2 seconds after body finishes, then start footer animations
    setTimeout(() => {
      if (wasRefetched) {
        // move cursor to fetch_time line, wait, then animate
        setCursorLine("fetch_time");
        setTimeout(() => {
          setFooterAnimationPhase("fetch_time");
          const oldTime = displayedFetchTime;
          const newTime = formatFetchedTime(cachedFetchedAt);
          animateDeleteType(oldTime, newTime, setDisplayedFetchTime, () => {
            // wait 2 seconds before moving to api calls
            setTimeout(animateApiCalls, LINE_TRANSITION_DELAY);
          });
        }, PRE_TYPE_DELAY);
      } else {
        // skip fetch time animation, just animate api calls
        animateApiCalls();
      }
    }, LINE_TRANSITION_DELAY);
  }, [isTypingComplete, footerAnimationPhase, cachedFetchedAt, prevApiCalls, apiCalls, wasRefetched, displayedFetchTime, animateDeleteType]);

  // update "data last fetched" every minute with typing animation
  useEffect(() => {
    if (footerAnimationPhase !== "done" || cachedFetchedAt === null) return;

    const interval = setInterval(() => {
      const oldTime = displayedFetchTime;
      const newTime = formatFetchedTime(cachedFetchedAt);

      // only animate if the text actually changed
      if (oldTime !== newTime) {
        setCursorLine("fetch_time");
        setTimeout(() => {
          animateDeleteType(oldTime, newTime, setDisplayedFetchTime, () => {
            setCursorLine("none");
          });
        }, PRE_TYPE_DELAY);
      }
    }, 60000); // every minute

    return () => clearInterval(interval);
  }, [footerAnimationPhase, cachedFetchedAt, displayedFetchTime, animateDeleteType]);

  // render text with links (apply links as soon as we start typing them)
  const renderTextWithLinks = () => {
    const { links } = buildPlainTextAndLinks();

    // if no data loaded yet, just show the displayed text
    if (links.length === 0) {
      return displayedText;
    }

    const result: React.ReactNode[] = [];
    let lastIndex = 0;

    // sort links by start position
    const sortedLinks = [...links].sort((a, b) => a.start - b.start);

    for (let i = 0; i < sortedLinks.length; i++) {
      const link = sortedLinks[i];

      // skip links that haven't been reached yet in typing
      if (link.start >= displayedText.length) continue;

      // add text before this link
      if (link.start > lastIndex) {
        result.push(<span key={`text-${i}`}>{displayedText.slice(lastIndex, link.start)}</span>);
      }

      // add the link (partial or complete depending on how far we've typed)
      const linkEnd = Math.min(link.end, displayedText.length);
      result.push(
        <a
          key={`link-${i}`}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="link-highlight"
        >
          {displayedText.slice(link.start, linkEnd)}
        </a>
      );
      lastIndex = linkEnd;
    }

    // add remaining text after last link
    if (lastIndex < displayedText.length) {
      result.push(<span key="text-end">{displayedText.slice(lastIndex)}</span>);
    }

    return result;
  };

  const showEllipsis = loading && displayedText === INITIAL_TEXT;

  // blinking cursor component
  const Cursor = ({ visible }: { visible: boolean }) => {
    if (!visible) return null;
    return (
      <span
        className={`inline-block w-[2px] h-[1.1em] bg-off-white align-middle ml-[1px] ${isTypingActive ? '' : 'animate-cursor-blink'}`}
      />
    );
  };

  return (
    <div>
      <h3 className="font-sans font-bold text-off-white text-3xl" style={{ marginBottom: '0.5rem' }}>
        currently
      </h3>
      <p className="font-sans text-gray text-lg leading-[1.35]">
        {displayedText.length > 0 ? (
          <>
            {showEllipsis ? displayedText.trimEnd() : renderTextWithLinks()}
            {showEllipsis && <span className="text-gray">{ellipsis}</span>}
            <Cursor visible={cursorLine === "body"} />
          </>
        ) : (
          <>
            <Cursor visible={cursorLine === "body"} />
          </>
        )}
      </p>
      <p className="font-sans text-off-white text-sm italic" style={{ marginTop: '0.5rem' }}>
        {loading ? (
          <>data last fetched ...</>
        ) : cachedFetchedAt !== null ? (
          <>data last fetched {displayedFetchTime}<Cursor visible={cursorLine === "fetch_time"} /></>
        ) : null}
        {!loading && prevApiCalls !== null && prevApiCalls > 0 && (
          <>
            <br />
            total api calls: {displayedApiCalls}<Cursor visible={cursorLine === "api_calls"} />
          </>
        )}
      </p>
    </div>
  );
}
