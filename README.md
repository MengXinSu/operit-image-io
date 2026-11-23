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
read_image(path: "/storage/emulated/0/DCIM/Camera/xxx.jpg")
read_image(paths: ["/a.jpg", "/b.png"])
```

支持的路径形态：

- 设备绝对路径：`/storage/emulated/0/...`、`/sdcard/...`
- VFS 路径：`/virtual/android/sdcard/...`
- 工作区相对路径

**每张图都会进入模型上下文**，模型能直接看到画面。会消耗看图 token，所以只在真的需要看画面时用。

返回：

```json
{
  "success": true,
  "message": "已送入模型上下文 1 张图片",
  "data": {
    "requested": 1,
    "count": 1,
    "images": [
      {
        "path": "/virtual/android/sdcard/DCIM/Camera/xxx.jpg",
        "raw": "{\"__type__\":\"FileContentData\",\"content\":\"1| \",\"path\":\"...\",\"size\":49}"
      }
    ],
    "failures": []
  }
}
```

> `data.images[].raw` 是宿主返回结构的原样序列化。**不要解析或重组它**——宿主依赖其中的结构标记来判断是否把图片挂到本轮上下文，拆开就会失效。插件内部已按此约定实现。

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

在 Operit2 的插件管理里导入 `image_io.toolpkg`，启用容器和子包 `image_io` 即可。

装完在工具列表里应该能看到：

- `image_io:read_image`
- `image_io:send_image`
- `image_io:read_screen`

---

## 技术说明

- **API 版本**：ToolPkg API `2.0.0`
- **平台**：Android
- **读图接口**：`read_file` 搭配 `direct_image: true`，由宿主把文件注册为图片附件
- **路径处理**：内置设备路径 → VFS 路径映射，屏蔽两种路径体系差异
- **无网络请求**：本插件不联网，不采集任何数据

### 实现要点

1. **路径必须映射。** 宿主的文件接口只认 VFS 路径；直接传设备路径会被当作相对路径拼到插件数据目录下，导致真实存在的图片被判成「文件不存在」。

2. **返回值不能重组。** 读图接口返回的结构带有类型标记，宿主靠它决定是否把图片挂进本轮上下文。拆开只取部分字段会让图片丢失。

3. **发图不做存在性校验。** 宿主的文件检查走 VFS，设备路径会被错译，真实存在的图片会被误判为不存在。渲染失败时界面会直接显形，不需要预检。

---

## 许可

Apache License 2.0
