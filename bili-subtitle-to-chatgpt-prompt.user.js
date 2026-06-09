// ==UserScript==
// @name         B站字幕转 ChatGPT 可视化总结 Prompt
// @namespace    https://chatgpt.local/bili-prompt
// @version      1.0
// @description  提取当前 B 站视频字幕，生成适合 ChatGPT 的总结 Prompt，并复制到剪贴板
// @author       HeadWindSmile
// @license      MIT
// @homepageURL  https://github.com/HeadWindSmile/bilibili-subtitle-to-chatgpt-prompt
// @supportURL   https://github.com/HeadWindSmile/bilibili-subtitle-to-chatgpt-prompt/issues
// @match        https://www.bilibili.com/video/*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const BUTTON_ID = "bili-chatgpt-prompt-btn";
  const TOAST_ID = "bili-prompt-toast";

  function toast(message, duration = 4000) {
    const old = document.getElementById(TOAST_ID);
    if (old) old.remove();

    const div = document.createElement("div");
    div.id = TOAST_ID;
    div.textContent = message;
    div.style.cssText = `
      position: fixed;
      right: 24px;
      bottom: 90px;
      z-index: 999999;
      padding: 10px 14px;
      background: rgba(0, 0, 0, 0.86);
      color: #fff;
      border-radius: 8px;
      font-size: 14px;
      max-width: 520px;
      line-height: 1.5;
      white-space: pre-wrap;
    `;
    document.body.appendChild(div);

    setTimeout(() => {
      if (div && div.parentNode) div.remove();
    }, duration);
  }

  function getBvid() {
    const match = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
    return match ? match[1] : null;
  }

  function getCurrentPageIndex() {
    const url = new URL(location.href);
    const p = Number(url.searchParams.get("p") || "1");
    return Math.max(p - 1, 0);
  }

  function gmGetText(url, stepName) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "text",
        withCredentials: true,
        timeout: 20000,
        onload: function (res) {
          if (res.status < 200 || res.status >= 300) {
            reject(
              new Error(
                `${stepName}失败：HTTP ${res.status}\n\n请求地址：${url}\n\n返回内容：${String(res.responseText).slice(0, 500)}`
              )
            );
            return;
          }

          resolve(res.responseText);
        },
        onerror: function (err) {
          console.error(`[${stepName}] 请求失败 URL:`, url, err);
          reject(
            new Error(
              `${stepName}失败：网络请求失败\n\n请求地址：${url}\n\n可能原因：\n1. Tampermonkey 没有允许 @connect 权限；\n2. 当前 B 站没有完整登录态；\n3. 字幕地址被 B 站限制访问。\n\n请按 F12 查看 Console 里的完整 URL。`
            )
          );
        },
        ontimeout: function () {
          reject(new Error(`${stepName}失败：请求超时\n\n请求地址：${url}`));
        }
      });
    });
  }

  async function gmGetJson(url, stepName) {
    const text = await gmGetText(url, stepName);

    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(
        `${stepName}失败：返回内容不是 JSON\n\n请求地址：${url}\n\n返回内容：${String(text).slice(0, 500)}`
      );
    }
  }

  function normalizeSubtitleUrl(url) {
    if (!url) return "";
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("http://")) return url.replace("http://", "https://");
    return url;
  }

  function secondsToTime(seconds) {
    const total = Math.floor(Number(seconds) || 0);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;

    if (h > 0) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }

    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function pickBestSubtitle(subtitles) {
    if (!Array.isArray(subtitles) || subtitles.length === 0) return null;

    return (
      subtitles.find(s => String(s.lan || "").toLowerCase().includes("zh")) ||
      subtitles.find(s => String(s.lan_doc || "").includes("中文")) ||
      subtitles.find(s => String(s.lan_doc || "").includes("AI")) ||
      subtitles[0]
    );
  }

  function subtitleJsonToText(subtitleJson) {
    const body = subtitleJson.body || [];

    return body
      .filter(item => item && item.content)
      .map(item => {
        const time = secondsToTime(item.from);
        const content = String(item.content).replace(/\s+/g, " ").trim();
        return `[${time}] ${content}`;
      })
      .join("\n");
  }

  function buildPrompt({ title, bvid, pageTitle, transcript }) {
    return `你是一个专业的视频内容分析助手。下面是 B 站视频字幕，请基于字幕内容生成一份高密度学习总结。

视频标题：${title}
视频 BV：${bvid}
当前分P：${pageTitle || "未知"}

你的目标：
让我在 ChatGPT 当前对话里，不借助任何外部工具，用 3 分钟看懂这个视频讲了什么、结构是什么、重点是什么、我能怎么用。

重要要求：
- 开头必须先输出「极速速览区」。
- 不要输出 Mermaid / Markmap。
- 不要生成图片。
- 不要泛泛而谈。
- 不要编造字幕中没有的信息。
- 保留关键时间戳。
- 字幕有明显识别错误时，可以结合上下文纠正，但不要过度脑补。
- 删除废话，只保留对理解和行动有价值的信息。
- 总长度控制在 900-1300 字以内。
- 如果字幕内容本身质量一般，要直接指出。

请严格按照下面结构输出：

# 0. 极速速览区

## 0.1 一句话结论

用一句话说清楚这个视频最核心的观点。

## 0.2 重点速览

用 3-5 条 bullet 快速概括视频重点。

要求：
- 每条不超过 30 字。
- 直接说结论，不要铺垫。
- 能让我 10 秒内判断这个视频值不值得细看。

## 0.3 一屏总览卡

用 Markdown 表格输出。

字段包括：
- 模块
- 核心观点
- 时间戳

要求：
- 控制在 5 行以内。
- 每一行是一个核心模块。
- 每个模块的核心观点要短。
- 内容要适合一眼扫完。

# 1. 视频结构脑图

请使用 Unicode 树状结构输出。

格式示例：

视频核心主题
├─ 分支一
│  ├─ 关键点
│  └─ 关键点
├─ 分支二
│  ├─ 关键点
│  └─ 关键点
└─ 分支三
   ├─ 关键点
   └─ 关键点

要求：
- 层级最多 3 层。
- 每个节点不超过 18 个字。
- 保留关键时间戳。
- 看起来像一张可以直接阅读的脑图。

# 2. 核心内容精讲

提炼 3-5 个最重要的知识点、方法论或观点。

每个知识点按下面格式输出：

## 知识点 X：一句话名称

- 讲了什么：
- 为什么重要：
- 我能怎么用：
- 对应时间戳：

要求：
- 不要展开成长篇。
- 优先提炼能直接复用的方法。
- 如果只是普通观点，不要强行拔高。

# 3. 可执行行动项

把视频内容转成我可以直接做的步骤。

要求：
- 按优先级排序。
- 控制在 3-5 条。
- 每条必须具体。
- 不要写“加强学习”“深入理解”“多思考”这类空话。

格式：

1. 做什么：
   - 具体做法：
   - 最终产出：

# 4. 最终复盘建议

用不超过 150 字回答：

- 这个视频最值得记住的是什么？
- 我看完后最应该立刻做什么？
- 这个视频是否值得二刷？为什么？

下面是字幕：

${transcript}`;
  }

  async function copyText(text) {
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(text, "text");
      return;
    }

    await navigator.clipboard.writeText(text);
  }

  async function getVideoInfo(bvid) {
    const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
    const res = await gmGetJson(url, "获取视频信息");

    if (res.code !== 0) {
      throw new Error(`获取视频信息失败：${res.message || res.code}`);
    }

    return res.data;
  }

  async function getSubtitles(bvid, cid) {
    const urls = [
      `https://api.bilibili.com/x/player/wbi/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`,
      `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`
    ];

    let lastMessage = "";

    for (const url of urls) {
      try {
        const res = await gmGetJson(url, "获取字幕列表");

        if (res.code !== 0) {
          lastMessage = res.message || String(res.code);
          continue;
        }

        const subtitles = res.data?.subtitle?.subtitles || [];

        if (subtitles.length > 0) {
          console.log("[BiliPrompt] 字幕列表：", subtitles);
          return subtitles;
        }

        if (res.data?.v_voucher) {
          lastMessage = "接口返回了 v_voucher，可能需要 WBI 签名或触发风控";
        } else {
          lastMessage = "接口返回成功，但字幕列表为空";
        }
      } catch (e) {
        lastMessage = e.message;
      }
    }

    throw new Error(
      `没有检测到可用字幕。\n\n可能原因：\n1. 当前视频没有 B 站 CC / AI 字幕；\n2. 画面里的字幕是 UP 主压进视频的，不是接口字幕；\n3. 你没有登录 B 站；\n4. 接口需要 WBI 签名。\n\n最后状态：${lastMessage}`
    );
  }

  async function main() {
    const bvid = getBvid();

    if (!bvid) {
      throw new Error("没有识别到 BV 号");
    }

    toast("正在获取视频信息...");

    const video = await getVideoInfo(bvid);
    const pageIndex = getCurrentPageIndex();
    const page = video.pages?.[pageIndex] || video.pages?.[0];

    if (!page || !page.cid) {
      throw new Error("没有获取到 cid");
    }

    toast("正在获取字幕列表...");

    const subtitles = await getSubtitles(bvid, page.cid);
    const subtitle = pickBestSubtitle(subtitles);

    if (!subtitle) {
      throw new Error("字幕列表为空");
    }

    const subtitleUrl = normalizeSubtitleUrl(subtitle.subtitle_url);

    if (!subtitleUrl) {
      throw new Error("没有获取到 subtitle_url");
    }

    console.log("[BiliPrompt] 当前使用字幕：", subtitle);
    console.log("[BiliPrompt] 字幕下载地址：", subtitleUrl);

    toast(`正在下载字幕：${subtitle.lan_doc || subtitle.lan || "未知字幕"}`);

    const subtitleJson = await gmGetJson(subtitleUrl, "下载字幕文件");
    const transcript = subtitleJsonToText(subtitleJson);

    if (!transcript.trim()) {
      throw new Error("字幕内容为空");
    }

    const prompt = buildPrompt({
      title: video.title,
      bvid,
      pageTitle: page.part,
      transcript
    });

    await copyText(prompt);

    toast(
      `已复制到剪贴板\n\n字幕长度：${transcript.length} 字\nPrompt 长度：${prompt.length} 字\n\n现在可以粘贴到 ChatGPT 里总结。`,
      5000
    );
  }

  function addButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.textContent = "复制可视化总结 Prompt";
    btn.style.cssText = `
      position: fixed;
      right: 24px;
      bottom: 36px;
      z-index: 999999;
      padding: 10px 14px;
      border: none;
      border-radius: 8px;
      background: #00aeec;
      color: white;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,.2);
    `;

    btn.addEventListener("click", async () => {
      try {
        await main();
      } catch (err) {
        console.error("[BiliPrompt Error]", err);
        toast(err.message || "提取失败，请按 F12 查看控制台", 9000);
      }
    });

    document.body.appendChild(btn);
  }

  addButton();

  setInterval(addButton, 2000);
})();