import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateSearchQueries,
  shouldPerformResearch,
  formatResearchForPrompt,
  type ResearchReport,
} from "../src/tools/researchEngine.ts";
import { executeSearch } from "../src/tools/search.ts";
import { inspectArticleQuality } from "../src/tools/quality.ts";
import { createArticle, readArticleResearch, deleteArticle } from "../src/articles.ts";

test("generateSearchQueries: generates clean queries without punctuation noise", () => {
  const queries1 = generateSearchQueries("《DeepSeek-V3 实战》：如何构建高可用文章生产流水线？");
  assert.ok(queries1.length >= 1);
  assert.ok(!queries1[0]!.includes("《"));
  assert.ok(!queries1[0]!.includes("？"));

  const empty = generateSearchQueries("");
  assert.deepEqual(empty, []);
});

test("shouldPerformResearch: respects explicit flags and notes policy", () => {
  // 显式关闭
  assert.equal(shouldPerformResearch({ enableResearch: false, notes: "" }), false);
  // 当未配置 SEARCH_API_KEY 时默认不执行（避免无效报错）
  const originalKey = process.env.SEARCH_API_KEY;
  try {
    delete process.env.SEARCH_API_KEY;
    assert.equal(shouldPerformResearch({ enableResearch: true, notes: "" }), false);
  } finally {
    if (originalKey !== undefined) process.env.SEARCH_API_KEY = originalKey;
  }
});

test("formatResearchForPrompt: generates sandboxed prompt with anti-injection instructions", () => {
  const mockReport: ResearchReport = {
    topic: "大模型量化技术进展",
    queries: ["大模型量化技术进展"],
    searchedAt: "2026-09-02T12:00:00.000Z",
    provider: "test-provider",
    sources: [
      {
        index: 1,
        title: "AWQ 量化原理与实践",
        url: "https://example.com/awq",
        snippet: "AWQ 保护了前 1% 的显著权重，大幅降低量化误差。",
        siteName: "example.com",
      },
      {
        index: 2,
        title: "GPTQ 技术解析",
        url: "https://example.com/gptq",
        snippet: "基于二阶海森矩阵信息的高效单层量化。",
        siteName: "example.com",
      },
    ],
  };

  const prompt = formatResearchForPrompt(mockReport);
  assert.ok(prompt.includes("<untrusted_web_research"));
  assert.ok(prompt.includes("</untrusted_web_research>"));
  assert.ok(prompt.includes("[1] 《AWQ 量化原理与实践》"));
  assert.ok(prompt.includes("[2] 《GPTQ 技术解析》"));
  assert.ok(prompt.includes("【事实引用与安全指引】"));
  assert.ok(prompt.includes("## 参考资料"));
});

test("executeSearch: handles empty query and missing key gracefully without crashing", async () => {
  const emptyRes = await executeSearch("");
  assert.equal(emptyRes.ok, false);
  assert.equal(emptyRes.results.length, 0);

  const noKeyRes = await executeSearch("测试查询", { apiKey: "", provider: "none" });
  assert.equal(noKeyRes.ok, false);
  assert.equal(noKeyRes.results.length, 0);
});

test("inspectArticleQuality: warns when research is present but references section is missing", () => {
  const markdownWithoutRefs = "# 标题\n\n正文内容，数据显示性能提升 50%。";
  const html = "<section><p>正文内容</p></section>";

  // 未联网时
  const issuesNormal = inspectArticleQuality(markdownWithoutRefs, html, false);
  assert.ok(!issuesNormal.some((i) => i.includes("## 参考资料")));

  // 联网研究时若未附带文末参考资料，产生警示
  const issuesWithResearch = inspectArticleQuality(markdownWithoutRefs, html, true);
  assert.ok(issuesWithResearch.some((i) => i.includes("未包含「## 参考资料」小节")));

  // 附带参考资料后通过
  const markdownWithRefs = "# 标题\n\n正文内容 [1]。\n\n## 参考资料\n- [1] 来源链接";
  const issuesPassed = inspectArticleQuality(markdownWithRefs, html, true);
  assert.ok(!issuesPassed.some((i) => i.includes("未包含「## 参考资料」小节")));
});

test("createArticle & readArticleResearch: correctly persists and retrieves research.json", async () => {
  const mockReport: ResearchReport = {
    topic: "持久化测试",
    queries: ["持久化测试"],
    searchedAt: new Date().toISOString(),
    provider: "tavily",
    sources: [
      {
        index: 1,
        title: "测试标题",
        url: "https://example.com/test",
        snippet: "测试摘要",
        siteName: "example.com",
      },
    ],
  };

  const id = await createArticle({
    title: "测试文章带研究资料",
    markdown: "# 测试文章\n\n正文内容 [1]。",
    research: mockReport,
  });

  try {
    const saved = await readArticleResearch(id);
    assert.ok(saved !== null);
    assert.equal(saved.topic, "持久化测试");
    assert.equal(saved.sources.length, 1);
    assert.equal(saved.sources[0]?.url, "https://example.com/test");
  } finally {
    await deleteArticle(id);
  }
});
