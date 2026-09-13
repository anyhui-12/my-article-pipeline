// 幂等命中透出：同一文章/账号重复投递时，publishArticle 与 publish_article 工具
// 都要把 extra.idempotent 带出来，供 /api/publish 响应与前端提示使用
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

// 指到临时 SQLite，避免读写仓库真实的 output/articles.sqlite；须在导入 src 模块前设置
process.env.ARTICLE_DB_FILE = join(
  await mkdtemp(join(tmpdir(), "publish-idempotent-")),
  "articles.sqlite",
);

const { publishArticle, buildPublishTool } = await import("../src/tools/publish.ts");
const { getArticleIndex } = await import("../src/article-db.ts");

function seedSuccessfulDelivery(
  idempotencyKey: string,
  mediaId: string,
  account: string,
  title: string,
): void {
  getArticleIndex().recordDelivery({
    at: new Date().toISOString(),
    platform: "wechat",
    account,
    title,
    mediaId,
    status: "success",
    sourceFile: null,
    idempotencyKey,
  });
}

test("publishArticle: 幂等命中直接返回历史草稿并透出 extra.idempotent（不新建投递记录）", async () => {
  seedSuccessfulDelivery("key-hit", "media-old-1", "测试号", "标题");
  const r = await publishArticle({
    platform: "wechat",
    account: "测试号",
    title: "标题",
    markdown: "正文内容",
    idempotencyKey: "key-hit",
  });
  // 命中历史投递：返回旧 media_id，带 idempotent 标记；wechat publisher 未被调用（否则会去联网）
  assert.equal(r.id, "media-old-1");
  assert.equal(r.platform, "wechat");
  assert.equal(r.account, "测试号");
  assert.equal(r.extra?.idempotent, true);
  const records = getArticleIndex()
    .listDeliveries()
    .filter((d) => d.idempotencyKey === "key-hit");
  assert.equal(records.length, 1);
});

test("buildPublishTool: 幂等命中时 results 携带 idempotent 标记", async () => {
  const account = "工具号";
  const title = "工具标题";
  const markdown = "工具正文";
  // 工具路径不显式传 idempotencyKey，按 platform/account/title/markdown 自动生成
  const key = createHash("sha256")
    .update(`wechat\0${account}\0${title}\0${markdown}`)
    .digest("hex");
  seedSuccessfulDelivery(key, "media-old-2", account, title);
  const publishTool = buildPublishTool("wechat", account);
  const out = (await publishTool.invoke({ title, markdown })) as {
    ok: boolean;
    account: string;
    results: { platform: string; draft_id: string; idempotent: boolean }[];
  };
  assert.equal(out.ok, true);
  assert.equal(out.account, account);
  assert.deepEqual(out.results, [
    { platform: "wechat", draft_id: "media-old-2", idempotent: true },
  ]);
});
