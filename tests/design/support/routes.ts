// every page the v1 lock renders, from fixture content
export const V1_ROUTES = [
  { name: "home", path: "/" },
  { name: "blog", path: "/blog" },
  { name: "blog-post", path: "/blog/hello-world" },
  { name: "library", path: "/library" },
  { name: "library-entry", path: "/library/foundation" },
  { name: "photos", path: "/photos" },
  { name: "not-found", path: "/this-page-does-not-exist" },
] as const;

export const V1_PATHS = V1_ROUTES.map((r) => r.path);
