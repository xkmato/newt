export interface XkmatoBlogPostFixture {
  id: string;
  title: string;
  slug: string;
  subtitle: string;
  content: string;
  plainTextPreview: string;
  tags: string[];
  authorId: string;
  authorName: string;
  readingTime: number;
  publishedAt: string;
  status: "published";
}

export interface XkmatoMicropostFixture {
  id: string;
  text: string;
  images: string[];
  authorId: string;
  authorName: string;
  createdAt: string;
  status: "published";
}

export const xkmatoFixtures = {
  blogposts: [
    {
      id: "M9dqCTthbn1Re6senFms",
      title: "Launching Amphibian: Build for Your Own Consumption Taste",
      slug: "launching-amphibian",
      subtitle:
        "Opening XKmato up so readers can prompt new limbs right where the content lives.",
      content:
        "<p>I want to experiment with opening this platform up to a bit more collaboration. Think of it like Replit or v0, but embedded directly into XKmato.</p><p>Standard text-to-speech still butchers Luganda phrases like <em>“Oli otya, mukwano gwange — tugende mu maaso n'okuzimba”</em>. With Amphibian, you build for your own consumption taste—like a salamander regrowing a new limb.</p>",
      plainTextPreview:
        "I want to experiment with opening this platform up to a bit more collaboration...",
      tags: ["amphibian", "malleable-software", "luganda", "ai"],
      authorId: "uid:kenneth",
      authorName: "Kenneth",
      readingTime: 4,
      publishedAt: "2026-11-21T08:02:36.424Z",
      status: "published",
    },
  ] satisfies XkmatoBlogPostFixture[],
  microposts: [
    {
      id: "syw0gTrIt2ffuzBR8XJR",
      text: "The Executable Sage thesis: a blog that evolves into a living playground shaped by its readers.",
      images: [],
      authorId: "uid:kenneth",
      authorName: "Kenneth",
      createdAt: "2026-11-20T14:20:00.000Z",
      status: "published",
    },
    {
      id: "Mocsrechn43c3VFe9Zwl",
      text: "Testing Luganda audio synthesis & community speculation markets on top of sidecar SQLite stores.",
      images: [],
      authorId: "uid:kenneth",
      authorName: "Kenneth",
      createdAt: "2026-11-22T09:15:00.000Z",
      status: "published",
    },
  ] satisfies XkmatoMicropostFixture[],
};
