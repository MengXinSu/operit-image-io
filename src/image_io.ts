/* METADATA
{
  "name": "image_io",
  "display_name": {
    "zh": "图片直读与发送",
    "en": "Image Direct Read & Send"
  },
  "description": {
    "zh": "两条独立的图片通道：read 把图直接送进模型上下文，让 AI 真正看见画面而不是 OCR 文字；send 把图发到对话里给用户看。另有 read_screen 一步截屏并看图。",
    "en": "Two separate image channels: read feeds images straight into the model context so the AI actually sees the picture instead of OCR text; send posts images into the conversation for the user. Also includes read_screen for one-step capture-and-view."
  },
  "author": ["Viya"],
  "category": "Media",
  "tools": [
    {
      "name": "read_image",
      "description": {
        "zh": "读取一张或多张图片，注册为多模态图片送入模型上下文，让模型真正看到画面（不做 OCR）。支持设备绝对路径、VFS 路径、工作区相对路径。",
        "en": "Read one or more images and register them as multimodal images in the model context so the model actually sees the picture (no OCR). Accepts device absolute paths, VFS paths, and workspace-relative paths."
      },
      "parameters": [
        {
          "name": "path",
          "description": {
            "zh": "单张图片路径。",
            "en": "Single image path."
          },
          "type": "string",
          "required": false
        },
        {
          "name": "paths",
          "description": {
            "zh": "多张图片路径，支持字符串数组、JSON 数组字符串，或换行/逗号分隔的字符串。",
            "en": "Multiple image paths: string array, JSON array string, or newline/comma separated."
          },
          "type": "array",
          "required": false
        }
      ]
    },
    {
      "name": "send_image",
      "description": {
        "zh": "把图片发到对话里给用户看。返回 Markdown 图片引用，模型把返回的 markdown 原样输出在回复中，图片就会在对话界面渲染出来。不消耗模型看图 token。",
        "en": "Send images into the conversation for the user. Returns Markdown image references; output them verbatim in the reply and the images render in the chat UI. Costs no vision tokens."
      },
      "parameters": [
        {
          "name": "path",
          "description": {
            "zh": "单张图片路径。",
            "en": "Single image path."
          },
          "type": "string",
          "required": false
        },
        {
          "name": "paths",
          "description": {
            "zh": "多张图片路径，支持数组、JSON 数组字符串或换行/逗号分隔。",
            "en": "Multiple image paths: array, JSON array string, or newline/comma separated."
          },
          "type": "array",
          "required": false
        },
        {
          "name": "alt",
          "description": {
            "zh": "图片替代文本，可选。",
            "en": "Optional alt text."
          },
          "type": "string",
          "required": false
        }
      ]
    },
    {
      "name": "read_screen",
      "description": {
        "zh": "截取当前屏幕并作为图片直接送入模型上下文，一步完成看屏。",
        "en": "Capture the current screen and feed it into the model context as an image in one step."
      },
      "parameters": [
        {
          "name": "save_path",
          "description": {
            "zh": "可选，截图保存路径。不传时自动保存到临时目录并带时间戳。",
            "en": "Optional save path. Defaults to a timestamped file in the temp directory."
          },
          "type": "string",
          "required": false
        }
      ]
    }
  ]
}
*/

// ---------------------------------------------------------------- 基础工具

const IMAGE_PATTERN = /\.(png|jpe?g|webp|gif|bmp)$/i;
const MAX_DEPTH = 4;

function reasonOf(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function ok(message: string, data: unknown): any {
    return { success: true, message: message, data: data };
}

function fail(message: string, data?: unknown): any {
    const out: any = { success: false, message: message };
    if (data !== undefined) {
        out.data = data;
    }
    return out;
}

/** 工具返回值可能被包一层 data，这里统一摊平成一层。 */
function unwrap(source: any, key: string): any {
    if (!source || typeof source !== "object") {
        return undefined;
    }
    const bag = source.data && typeof source.data === "object" ? source.data : source;
    return bag[key];
}

// ---------------------------------------------------------------- 路径映射

/**
 * 设备路径 → VFS 路径。
 *
 * 宿主的文件与媒体接口只认 VFS 路径。直接把设备路径传进去，会被当成相对路径
 * 拼到插件自己的数据目录下，于是真实存在的图片被判成"文件不存在"。
 *
 *   /storage/emulated/0/xxx   →  /virtual/android/sdcard/xxx
 *   /storage/self/primary/xxx →  /virtual/android/sdcard/xxx
 *   /sdcard/xxx               →  /virtual/android/sdcard/xxx
 *   /virtual/...              →  原样
 *   其他（相对工作区）         →  原样
 */
function toVfsPath(path: string): string {
    const raw = String(path || "").trim();

    if (!raw) {
        return raw;
    }

    if (raw.indexOf("/virtual/") === 0) {
        return raw;
    }

    let rest: string | null = null;
    if (raw.indexOf("/storage/emulated/0/") === 0) {
        rest = raw.slice("/storage/emulated/0/".length);
    } else if (raw.indexOf("/storage/self/primary/") === 0) {
        rest = raw.slice("/storage/self/primary/".length);
    } else if (raw.indexOf("/sdcard/") === 0) {
        rest = raw.slice("/sdcard/".length);
    }

    if (rest === null) {
        return raw;
    }

    return "/virtual/android/sdcard/" + rest;
}

// ---------------------------------------------------------------- 输入解析

/**
 * 把任意形态的输入递归拍平成一串不重复的路径。
 * 接受：字符串、数组、嵌套数组、JSON 数组字符串、换行/逗号分隔字符串。
 */
function flattenPaths(input: unknown, depth: number, out: string[], seen: Record<string, boolean>): void {
    if (input === null || input === undefined || depth > MAX_DEPTH) {
        return;
    }

    if (Array.isArray(input)) {
        for (const item of input) {
            flattenPaths(item, depth + 1, out, seen);
        }
        return;
    }

    if (typeof input !== "string") {
        const text = String(input).trim();
        if (text && !seen[text]) {
            seen[text] = true;
            out.push(text);
        }
        return;
    }

    const raw = input.trim();
    if (!raw) {
        return;
    }

    if (raw.charAt(0) === "[") {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                flattenPaths(parsed, depth + 1, out, seen);
                return;
            }
        } catch (e) {
            // 不是合法 JSON，按普通字符串继续
        }
    }

    if (raw.indexOf("\n") >= 0 || raw.indexOf(",") >= 0) {
        for (const piece of raw.split(/[\n,]+/)) {
            const t = piece.trim();
            if (t && !seen[t]) {
                seen[t] = true;
                out.push(t);
            }
        }
        return;
    }

    if (!seen[raw]) {
        seen[raw] = true;
        out.push(raw);
    }
}

/** 从工具参数里取出全部目标路径。 */
function resolveTargets(params: any): string[] {
    const out: string[] = [];
    const seen: Record<string, boolean> = {};
    const bag = params || {};
    flattenPaths(bag.path, 0, out, seen);
    flattenPaths(bag.paths, 0, out, seen);
    return out;
}

// ---------------------------------------------------------------- 批处理

interface BatchResult {
    done: any[];
    failed: any[];
}

/**
 * 对每个路径执行同一个动作，收集成功与失败。
 * 单个失败不影响其余，全部失败由调用方决定如何表述。
 */
async function runEach(targets: string[], action: (path: string) => Promise<any>): Promise<BatchResult> {
    const done: any[] = [];
    const failed: any[] = [];

    for (const path of targets) {
        try {
            done.push(await action(path));
        } catch (error) {
            failed.push({ path: path, reason: reasonOf(error) });
        }
    }

    return { done: done, failed: failed };
}

/** 拼一句「成功 N 张（M 张失败）」的摘要。 */
function summarize(done: number, failed: number, verb: string): string {
    let text = verb + " " + done + " 张图片";
    if (failed > 0) {
        text += "，" + failed + " 张失败";
    }
    return text;
}

// ---------------------------------------------------------------- 读图

interface AttachedImage {
    path: string;
    raw: string;
}

/**
 * 把一张图送进模型上下文。
 *
 * 走 read_file + direct_image:true：宿主会把这文件直接注册成图片附件，
 * 模型看到的是画面本身，而不是文本解码结果。
 */
async function attachImage(vfsPath: string): Promise<AttachedImage> {
    const raw = await toolCall("read_file", {
        path: vfsPath,
        direct_image: true
    });

    // 宿主返回 FileContentData。必须把原始结构原样带回去：
    // 宿主靠识别返回值里的 __type__ 决定是否把图片挂到这一轮上下文。
    // 拆开重组会丢掉该标记，图片就送不进去。
    let serialized: string;
    try {
        serialized = dataUtils.stringifyJson(raw);
    } catch (error) {
        serialized = String(raw);
    }

    return {
        path: vfsPath,
        raw: serialized,
    };
}

// ---------------------------------------------------------------- 三个工具

async function readImage(params: any): Promise<any> {
    const targets = resolveTargets(params);

    if (targets.length === 0) {
        return fail("没有收到图片路径：请提供 path 或 paths");
    }

    const batch = await runEach(targets, function (path: string) {
        return attachImage(toVfsPath(path));
    });

    if (batch.done.length === 0) {
        return fail("全部读取失败：" + (batch.failed[0] ? batch.failed[0].reason : "未知原因"), {
            failures: batch.failed,
        });
    }

    return ok(summarize(batch.done.length, batch.failed.length, "已送入模型上下文"), {
        requested: targets.length,
        count: batch.done.length,
        images: batch.done,
        failures: batch.failed,
    });
}

/** 绝对路径补 file://，相对路径原样交给界面解析。 */
function toReference(path: string, alt: string): string {
    const source = path.charAt(0) === "/" ? "file://" + path : path;
    return "![" + alt.replace(/[[\]]/g, "") + "](" + source + ")";
}

async function sendImage(params: any): Promise<any> {
    const targets = resolveTargets(params);

    if (targets.length === 0) {
        return fail("没有收到图片路径：请提供 path 或 paths");
    }

    const altBase = String((params && params.alt) || "图片").trim() || "图片";
    let index = 0;

    const batch = await runEach(targets, async function (path: string) {
        if (!IMAGE_PATTERN.test(path)) {
            throw new Error("扩展名不是图片格式");
        }

        // 不做存在性校验：宿主的文件检查走 VFS，设备路径会被错译成插件数据目录，
        // 真实存在的图片会被判成不存在。渲染不出来时界面会直接显形。

        index += 1;
        const alt = targets.length > 1 ? altBase + " " + index : altBase;
        return { path: path, markdown: toReference(path, alt) };
    });

    if (batch.done.length === 0) {
        return fail("没有可发送的图片：" + (batch.failed[0] ? batch.failed[0].reason : "未知原因"), {
            failures: batch.failed,
        });
    }

    const lines: string[] = [];
    for (const item of batch.done) {
        lines.push(item.markdown);
    }

    return ok(
        summarize(batch.done.length, batch.failed.length, "已生成图片引用") +
            "。把 data.markdown 原样输出到回复里，用户就能看到。",
        {
            count: batch.done.length,
            markdown: lines.join("\n"),
            failures: batch.failed,
        }
    );
}

/** 截图并返回文件路径：只用宿主内置截图，不做平台猜测。 */
async function grabScreen(): Promise<{ path: string; via: string }> {
    const shot = await toolCall("capture_screenshot", {});
    const candidate = typeof shot === "string"
        ? shot
        : (unwrap(shot, "value") || unwrap(shot, "path") || unwrap(shot, "file_path") || "");

    if (!candidate) {
        throw new Error("宿主截图没有返回文件路径");
    }
    if (!IMAGE_PATTERN.test(String(candidate))) {
        throw new Error("宿主返回的截图路径不是图片：" + String(candidate));
    }
    return { path: String(candidate), via: "capture_screenshot" };
}

async function readScreen(params: any): Promise<any> {
    const bag = params || {};

    let captured: { path: string; via: string };
    try {
        captured = await grabScreen();
    } catch (error) {
        return fail("截屏失败：" + reasonOf(error));
    }

    // 调用方指定了保存位置时，把宿主截图另存过去，不改变读图用的源文件。
    let sourcePath = captured.path;
    if (bag.save_path) {
        try {
            await toolCall("copy_file", {
                source: captured.path,
                destination: String(bag.save_path),
            });
            sourcePath = String(bag.save_path);
        } catch (error) {
            return fail("截图已拿到，但保存到指定位置失败：" + reasonOf(error), {
                file_path: captured.path,
            });
        }
    }

    try {
        const image = await attachImage(toVfsPath(sourcePath));
        return ok("已截屏并送入模型上下文：" + sourcePath, {
            file_path: sourcePath,
            via: captured.via,
            raw: image.raw,
        });
    } catch (error) {
        return fail("截到图但没能送入上下文：" + reasonOf(error), {
            file_path: sourcePath,
        });
    }
}

// ---------------------------------------------------------------- 导出

function guard(fn: (params: any) => Promise<any>) {
    return async function (params: any) {
        try {
            complete(await fn(params || {}));
        } catch (error) {
            complete(fail("工具执行异常：" + reasonOf(error)));
        }
    };
}

exports.read_image = guard(readImage);
exports.send_image = guard(sendImage);
exports.read_screen = guard(readScreen);
