// 微信正文 20000 字符投前预检：超限本地拦截（不发建草稿请求），不超限放行
import test from "node:test";
import assert from "node:assert/strict";
import { WECHAT_CONTENT_LIMIT, assertWechatContentLength } from "../src/publishers/wechat.ts";

test("预检放行：正文长度在上限内（含恰好等于上限）", () => {
  assert.equal(WECHAT_CONTENT_LIMIT, 20_000);
  assert.doesNotThrow(() => assertWechatContentLength("<p>短正文</p>"));
  assert.doesNotThrow(() => assertWechatContentLength("字".repeat(WECHAT_CONTENT_LIMIT)));
});

test("预检拦截：超限抛中文错误，含当前/上限/超出字符数与可操作建议", () => {
  // 计数基于最终发给微信的 HTML 字符串（含标签），不是 markdown 源长度
  const html = `<section><p>${"字".repeat(WECHAT_CONTENT_LIMIT)}</p></section>`;
  const over = html.length - WECHAT_CONTENT_LIMIT;
  assert.ok(over > 0);
  assert.throws(
    () => assertWechatContentLength(html),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.match(e.message, /超出微信草稿长度上限/);
      assert.match(e.message, new RegExp(`当前 ${html.length} 字符`));
      assert.match(e.message, new RegExp(`上限 ${WECHAT_CONTENT_LIMIT} 字符`));
      assert.match(e.message, new RegExp(`超出 ${over} 字符`));
      assert.match(e.message, /精简正文/);
      assert.match(e.message, /拆分/);
      return true;
    },
  );
});

test("预检按字符计：仅超出 1 个字符也拦截", () => {
  assert.throws(
    () => assertWechatContentLength("x".repeat(WECHAT_CONTENT_LIMIT + 1)),
    /超出 1 字符/,
  );
});
