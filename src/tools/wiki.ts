import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const API = "https://uk.wikipedia.org/w/api.php";

/** Wikimedia asks every client to identify itself. */
const USER_AGENT = "agent-pipeline-talk-demo/1.0 (conference demo)";

/** Fixtures make the live demo independent of the network. */
const USE_FIXTURES = process.env.USE_FIXTURES === "1";

async function wiki(params: Record<string, string>): Promise<any> {
  const path = `?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  if (USE_FIXTURES) {
    const { readFixture } = await import("./fixtures.js");
    return readFixture(path);
  }
  // The agent often fires several calls at once; Wikipedia answers 429 to bursts.
  // Wait and retry instead of handing the model an error it will improvise around.
  let res = await fetch(`${API}${path}`, { headers: { "User-Agent": USER_AGENT } });
  for (let attempt = 1; res.status === 429 && attempt <= 4; attempt++) {
    const wait = Number(res.headers.get("retry-after")) || attempt;
    await new Promise((r) => setTimeout(r, wait * 1000));
    res = await fetch(`${API}${path}`, { headers: { "User-Agent": USER_AGENT } });
  }
  if (!res.ok) {
    throw new Error(`Wikipedia ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (process.env.RECORD_FIXTURES === "1") {
    const { writeFixture } = await import("./fixtures.js");
    await writeFixture(path, data);
  }
  return data;
}

/** Search snippets come with <span class="searchmatch"> markup. */
const plain = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

export const searchArticles = tool(
  "search_articles",
  "Search Ukrainian Wikipedia. Returns matching article titles with a short snippet, the article size in words, and the total number of matches.",
  {
    query: z.string().describe('Search terms, e.g. "Говерла" or "українські письменниці XIX століття"'),
    limit: z.number().int().min(1).max(20).optional().describe("How many articles to return"),
  },
  async (args) => {
    try {
      const data = await wiki({
        action: "query",
        list: "search",
        srsearch: args.query,
        srlimit: String(args.limit ?? 10),
      });

      const rows = data.query.search.map((r: any) => ({
        title: r.title,
        snippet: plain(r.snippet),
        words: r.wordcount,
      }));

      return {
        content: [
          { type: "text", text: JSON.stringify({ total: data.query.searchinfo.totalhits, articles: rows }, null, 2) },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `search_articles failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

export const getArticle = tool(
  "get_article",
  "Fetch one Ukrainian Wikipedia article by its exact title: plain text (first 4000 characters), its URL, and whether it is a disambiguation page that lists several meanings.",
  {
    title: z.string().describe('Exact article title, e.g. "Говерла"'),
  },
  async (args) => {
    try {
      const data = await wiki({
        action: "query",
        prop: "extracts|pageprops|info",
        explaintext: "1",
        exchars: "4000",
        inprop: "url",
        redirects: "1",
        titles: args.title,
      });

      const page = data.query.pages[0];
      if (page.missing) {
        return {
          content: [{ type: "text", text: `No article titled "${args.title}" in Ukrainian Wikipedia.` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                title: page.title,
                url: page.fullurl,
                disambiguation: page.pageprops?.disambiguation !== undefined,
                text: page.extract ?? "",
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `get_article failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

export const wikiServer = createSdkMcpServer({
  name: "wiki",
  version: "1.0.0",
  tools: [searchArticles, getArticle],
});

export const WIKI_TOOLS = ["mcp__wiki__search_articles", "mcp__wiki__get_article"];
