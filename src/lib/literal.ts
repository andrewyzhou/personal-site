const LITERAL_API = "https://api.literal.club/graphql/";

interface LiteralBook {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  cover?: string;
  authors: { id: string; name: string }[];
}

async function graphqlRequest(query: string, variables: Record<string, unknown> = {}) {
  const token = process.env.LITERAL_TOKEN;

  if (!token) {
    throw new Error("LITERAL_TOKEN environment variable is required");
  }

  const response = await fetch(LITERAL_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(2000),
  });

  const data = await response.json();

  if (data.errors) {
    throw new Error(data.errors[0]?.message || "GraphQL error");
  }

  return data.data;
}

export async function getCurrentlyReading(): Promise<LiteralBook | null> {
  try {
    const profileId = process.env.LITERAL_PROFILE_ID;

    if (!profileId) {
      throw new Error("LITERAL_PROFILE_ID environment variable is required");
    }

    const query = `
      query booksByReadingStateAndProfile(
        $limit: Int!
        $offset: Int!
        $readingStatus: ReadingStatus!
        $profileId: String!
      ) {
        booksByReadingStateAndProfile(
          limit: $limit
          offset: $offset
          readingStatus: $readingStatus
          profileId: $profileId
        ) {
          id
          slug
          title
          subtitle
          cover
          authors {
            id
            name
          }
        }
      }
    `;

    const data = await graphqlRequest(query, {
      limit: 1,
      offset: 0,
      readingStatus: "IS_READING",
      profileId,
    });

    const books = data.booksByReadingStateAndProfile;

    if (books && books.length > 0) {
      return books[0];
    }

    return null;
  } catch (error) {
    console.error("Literal API error:", error);
    return null;
  }
}
