// every page the v1 lock renders, from fixture content
export const V1_ROUTES = [
  { name: "home", path: "/" },
  { name: "work", path: "/work" },
  { name: "writing", path: "/writing" },
  { name: "post", path: "/writing/sample-post" },
  { name: "library", path: "/library" },
  { name: "reading", path: "/library/reading" },
  { name: "reading-entry", path: "/library/reading/sample-book" },
  { name: "tv-movies", path: "/library/tv-movies" },
  { name: "tv-movies-entry", path: "/library/tv-movies/sample-movie" },
  { name: "photos", path: "/library/photos" },
  { name: "projects", path: "/library/projects" },
  { name: "coursework", path: "/library/coursework" },
  { name: "not-found", path: "/this-page-does-not-exist" },
] as const;

export const V1_PATHS = V1_ROUTES.map((r) => r.path);
