# 图片直读与发送 · Image Direct Read & Send

> 让 AI 真正「看见」图片，而不是读一堆 OCR 文字。

两条独立的图片通道，各管一头：

- **read** — 把图直接送进模型上下文，AI 看到的是画面本身：颜色、布局、位置、表情、光线。OCR 读不出来的东西，这条路都能拿到。
- **send** — 把图发到对话里给用户看，不消耗模型看图 token。

---

## 为什么需要它

大多数「读图」工具走的是 OCR：截图 → 识别文字 → 把文字交给模型。

结果是模型只知道「图里写了什么」，不知道「图长什么样」。你问它「这个界面什么颜色」「照片是横的还是竖的」「屏幕反光在哪」，它答不上来，只能瞎猜。

本插件走的是多模态直读：图片作为真正的图像输入进入模型上下文。

---

## 三个工具

### `read_image` — 让 AI 看图

```
read_image(path: "/sdcard/DCIM/Camera/xxx.jpg")
read_image(paths: ["/a.jpg", "/b.png"])
```

支持三种路径形态：

- 单张：`path` 传字符串
- 多张：`paths` 传数组
- 也接受 JSON 数组字符串，或换行/逗号分隔的字符串

**每张图都会进入模型上下文**，模型能直接看到画面。会消耗看图 token，所以只在真的需要看画面时用。

返回：

```json
{
  "success": true,
  "message": "已送入模型上下文 1 张图片",
  "data": {
    "requested": 1,
    "count": 1,
    "images": [{ "path": "...", "mimeType": "image/jpeg", "width": 1542, "height": 2048 }],
    "failures": []
  }
}
```

### `send_image` — 把图发给用户

```
send_image(path: "photo.jpg", alt: "相册照片")
```

返回一条 Markdown 图片引用：

```json
{ "data": { "markdown": "![相册照片](file:///path/to/photo.jpg)" } }
```

把 `data.markdown` 原样输出在回复里，图片就会在对话界面渲染出来。

**不消耗看图 token** —— 图没有进模型上下文，只是让界面显示。适合「把这个结果给你看」这类场景。

### `read_screen` — 截屏并看图

```
read_screen()
read_screen(save_path: "/sdcard/Pictures/here.png")
```

一步完成「截当前屏幕 + 送进模型上下文」。

截图完全交给宿主内置能力，不在代码里写死任何平台目录。传入 `save_path` 时会把截图另存一份到指定位置。

如果宿主不支持截图，工具会**明确报错**，不会假装成功。

---

## 两条通道怎么选

| 场景 | 用哪个 | 代价 |
|---|---|---|
| 我要 AI 看懂这张图 | `read_image` | 看图 token |
| 我要把图给用户看 | `send_image` | 免费 |
| 我要 AI 看当前屏幕 | `read_screen` | 看图 token |

**关键区别**：`read` 让图进模型的眼睛，`send` 让图进用户的屏幕。两件事，别混用。

---

## 安装

1. 下载本仓库 Release 里的 `image_io.toolpkg`
2. 在 Operit2 的插件管理中导入
3. 启用容器 `com.viya.image_io`
4. 启用子包 `image_io`

装完在工具列表里应该能看到：

- `image_io:read_image`
- `image_io:send_image`
- `image_io:read_screen`

---

## 从源码构建

需要 Node.js 与 TypeScript。

```bash
npm install
npm run build
cp dist/image_io.js packages/image_io.js
```

然后把 `manifest.json`、`dist/`、`packages/`、`src/` 打成 zip，扩展名改成 `.toolpkg`。

`types/` 目录是 Operit 插件开发套件随附的类型定义，可从应用内的 Skill 目录复制。

---

## 技术说明

- **API 版本**：ToolPkg API `2.0.0`
- **平台**：Android（依赖宿主的 `media_register_from_path` 与截图能力）
- **图片注册**：走内置工具 `media_register_from_path`，图片由宿主媒体池管理，不上传到任何第三方服务器
- **无网络请求**：本插件不联网，不采集任何数据

### 相对 Operit1 同名插件的差异

Operit1 时代的「直读图片」使用 `NativeInterface.registerImageFromPath`，该接口在 Operit2 中不存在。本插件改用内置工具 `media_register_from_path`，并把「读图」与「发图」两条通道合并到同一个包里。

---

## 许可

Apache License 2.0

思路参考了社区插件 `see-image`（直读图片）与 `media-display`（本地图片显示）。本实现为 Operit2 重写：更换了图片注册接口、重构了参数解析与批处理结构、合并两条通道并提供统一的错误处理。
