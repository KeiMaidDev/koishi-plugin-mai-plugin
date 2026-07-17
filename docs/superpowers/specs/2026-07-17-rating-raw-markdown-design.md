# Rating Raw Markdown 图片设计

## 目标

将 B15、B25、B35、B40、B50 的 Rating 图片统一改为 QQ Raw Markdown 图片，并在图片下挂操作按钮。图片通过 Koishi Assets 服务转存，Markdown 中的宽高取自最终渲染 PNG 的实际尺寸。

带筛选条件或查询目标的 Rating 指令同样使用此输出。其他图片指令不在本次范围内。

## 输出流程

仅当平台为 QQ、未启用兼容模式且 Koishi Assets 服务可用时执行以下流程：

1. Rating renderer 生成 PNG Buffer。
2. 使用 `sharp(image).metadata()` 读取最终 PNG 的实际宽度和高度。
3. 将 Buffer 构造成 Koishi `<img>` 消息元素并序列化。
4. 调用公开 API `ctx.assets.transform(content)` 转存资源。
5. 使用 Koishi 元素解析器解析返回内容，取得 `<img>` 的永久链接。
6. 校验宽高为正整数，图片链接为绝对 HTTP 或 HTTPS URL，并将链接转换为 Markdown 安全形式。
7. 生成 Raw Markdown：

```markdown
![B50 #1440px #1490px](https://assets.example/image.png)
```

替代文本中的 B 数量与当前查询一致，尺寸来自步骤 2，不使用模板常量。

Raw Markdown 消息自身包含图片链接，不再额外附加 Buffer 图片元素，避免重复显示。

## Keyboard

所有 Rating 图片统一下挂一行三个按钮：

| 标签 | 命令 | 行为 |
| --- | --- | --- |
| `我也要查` | 根据当前 Rating 查询动态生成 | 立即执行 |
| `成绩列表` | `/mai 分数列表` | 立即执行 |
| `查分设置` | `/mai 查分设置` | 立即执行 |

所有按钮不限制点击用户，使用权限类型 `2`，并设置 `reply: false` 和 `enter: true`。

## 动态查询命令

`我也要查` 保留当前查询的筛选条件和 B 数量，但移除查询目标，使点击者查询自己的成绩：

| 当前查询 | 按钮命令 |
| --- | --- |
| `/mai b15` | `/mai b15` |
| `/mai b25` | `/mai b25` |
| `/mai b40 @用户` | `/mai b40` |
| `/mai 舞萌 b50 @用户` | `/mai 舞萌 b50` |

命令从 Rating 指令已经解析出的 `filterText` 和 `total` 构造，不从原始消息字符串中删除文本，避免残留提及或误删筛选条件。

## 服务边界

- `assets` 作为可选 Koishi 服务注入。插件仍可在没有 Assets 服务时启动。
- 生命周期初始化将 Assets 的公开 `transform(content)` 能力以窄接口传给命令依赖。
- Rating 命令负责提供图片 Buffer、实际查询条件和 B 数量。
- QQ 消息辅助层负责转存、尺寸读取、URL 校验、Raw Markdown 和 keyboard 构造。
- 不直接调用 Assets 的内部 `upload()` 方法。
- 不新增对象存储配置，也不修改 renderer 返回类型。

## 回退与错误处理

以下任一情况发生时，发送当前的普通 PNG 图片消息，不让查询失败：

- 非 QQ 平台或启用了兼容模式。
- Assets 服务未安装或不可用。
- Assets 转存抛出异常。
- 转存结果缺少唯一有效的 `<img>` 元素。
- 返回链接不是绝对 HTTP/HTTPS URL。
- PNG metadata 缺少有效宽高。

转存失败不得进入通用“查询失败”分支，也不得重复发送 Raw Markdown 和普通图片。

## 验收

- B15、B25、B35、B40、B50 均生成与实际 PNG 尺寸一致的 Markdown 图片语法。
- Raw Markdown 只包含转存后的图片链接和一行三个按钮，不额外发送 Buffer 图片。
- `我也要查` 对五种 B 数量、筛选查询和他人查询生成正确的自查命令。
- `成绩列表` 和 `查分设置` 命令固定且可执行。
- 所有按钮均为权限类型 `2`、`reply: false`、`enter: true`。
- Assets 缺失、转存异常、无效元素、无效 URL 和无效尺寸均回退普通图片。
- 非 QQ 平台及兼容模式不调用 Assets。
- `package.json` 不新增 `scripts`、`engines` 或测试工具。
- Koishi 根目录 `yarn build` 通过。
