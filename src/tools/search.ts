import { tool } from "langchain";
import { z } from "zod";
import { fetchWithRetry } from "../util/http.ts";
import {
  SEARCH_API_KEY,
  SEARCH_BASE_URL,
  SEARCH_MAX_RESULTS,
  SEARCH_PROVIDER,
} from "../config.ts";

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  siteName?: string;
  score?: number;
}

export interface SearchOptions {
  provider?: string;
  apiKey?: string;
  baseURL?: string;
  maxResults?: number;
  timeoutMs?: number;
}

export interface SearchResponse {
  ok: boolean;
  provider: string;
  query: string;
  results: SearchResultItem[];
  error?: string;
}

function extractSiteName(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function cleanText(text: unknown, maxLen = 500): string {
  if (typeof text !== "string") return "";
  return text.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/** 统一调用 Tavily 搜索 API */
async function searchTavily(
  query: string,
  apiKey: string,
  baseURL: string,
  maxResults: number,
  timeoutMs: number,
): Promise<SearchResultItem[]> {
  const url = baseURL || "https://api.tavily.com/search";
  const res = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: "basic",
        include_answer: false,
      }),
    },
    { timeoutMs, retries: 1, retryPost: false, label: "Tavily 搜索" },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Tavily 搜索失败 (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      score?: number;
      published_date?: string;
    }>;
  };

  return (data.results ?? []).map((r) => ({
    title: cleanText(r.title, 120) || "未命名网页",
    url: String(r.url ?? "").trim(),
    snippet: cleanText(r.content, 600),
    publishedDate: r.published_date,
    siteName: extractSiteName(r.url ?? ""),
    score: typeof r.score === "number" ? r.score : undefined,
  })).filter((item) => item.url && item.snippet);
}

/** 统一调用 Serper (Google Search) API */
async function searchSerper(
  query: string,
  apiKey: string,
  baseURL: string,
  maxResults: number,
  timeoutMs: number,
): Promise<SearchResultItem[]> {
  const url = baseURL || "https://google.serper.dev/search";
  const res = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({
        q: query,
        num: maxResults,
      }),
    },
    { timeoutMs, retries: 1, retryPost: false, label: "Serper 搜索" },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Serper 搜索失败 (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    organic?: Array<{
      title?: string;
      link?: string;
      snippet?: string;
      date?: string;
    }>;
  };

  return (data.organic ?? []).map((r) => ({
    title: cleanText(r.title, 120) || "未命名网页",
    url: String(r.link ?? "").trim(),
    snippet: cleanText(r.snippet, 600),
    publishedDate: r.date,
    siteName: extractSiteName(r.link ?? ""),
  })).filter((item) => item.url && item.snippet);
}

/** 统一调用 Bocha（博查）中文搜索 API */
async function searchBocha(
  query: string,
  apiKey: string,
  baseURL: string,
  maxResults: number,
  timeoutMs: number,
): Promise<SearchResultItem[]> {
  const url = baseURL || "https://api.bochaai.com/v1/web-search";
  const res = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        count: maxResults,
        summary: true,
      }),
    },
    { timeoutMs, retries: 1, retryPost: false, label: "Bocha 搜索" },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Bocha 搜索失败 (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    data?: {
      webPages?: {
        value?: Array<{
          name?: string;
          url?: string;
          snippet?: string;
          datePublished?: string;
          siteName?: string;
        }>;
      };
    };
  };

  const pages = data.data?.webPages?.value ?? [];
  return pages.map((r) => ({
    title: cleanText(r.name, 120) || "未命名网页",
    url: String(r.url ?? "").trim(),
    snippet: cleanText(r.snippet, 600),
    publishedDate: r.datePublished,
    siteName: r.siteName || extractSiteName(r.url ?? ""),
  })).filter((item) => item.url && item.snippet);
}

/** 执行网络检索入口函数，支持优雅降级 */
export async function executeSearch(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResponse> {
  const trimmed = query.trim();
  const provider = (options.provider ?? SEARCH_PROVIDER).toLowerCase();
  const apiKey = options.apiKey ?? SEARCH_API_KEY;
  const baseURL = options.baseURL ?? SEARCH_BASE_URL;
  const maxResults = options.maxResults ?? SEARCH_MAX_RESULTS;
  const timeoutMs = options.timeoutMs ?? 15_000;

  if (!trimmed) {
    return { ok: false, provider, query, results: [], error: "搜索关键词不能为空" };
  }

  if (provider === "none" || !apiKey) {
    return {
      ok: false,
      provider,
      query: trimmed,
      results: [],
      error: !apiKey ? "未配置 SEARCH_API_KEY，已跳过联网检索" : "搜索功能已禁用",
    };
  }

  try {
    let results: SearchResultItem[] = [];
    if (provider === "serper") {
      results = await searchSerper(trimmed, apiKey, baseURL, maxResults, timeoutMs);
    } else if (provider === "bocha") {
      results = await searchBocha(trimmed, apiKey, baseURL, maxResults, timeoutMs);
    } else {
      // 默认走 tavily 协议
      results = await searchTavily(trimmed, apiKey, baseURL, maxResults, timeoutMs);
    }

    return {
      ok: true,
      provider,
      query: trimmed,
      results: results.slice(0, maxResults),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[search] 搜索「${trimmed}」异常：${errorMsg}`);
    return {
      ok: false,
      provider,
      query: trimmed,
      results: [],
      error: errorMsg,
    };
  }
}

/** 挂给主 ReAct Agent 的联网搜索工具 */
export const webSearchTool = tool(
  async ({ query, maxResults }) => {
    const res = await executeSearch(query, { maxResults });
    if (!res.ok) return `联网搜索未获取到有效结果：${res.error ?? "未知错误"}`;
    if (res.results.length === 0) return `未找到与「${query}」相关的检索结果。`;
    return JSON.stringify(
      res.results.map((r, i) => ({
        index: i + 1,
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        siteName: r.siteName,
      })),
      null,
      2,
    );
  },
  {
    name: "web_search",
    description:
      "在互联网上检索最新信息、技术动态、事实数据与行业观点。返回搜索结果列表（含标题、URL、摘要及站点）。",
    schema: z.object({
      query: z.string().describe("搜索关键词或查询短语"),
      maxResults: z.number().optional().describe("最大返回条数，默认 5"),
    }),
  },
);
