# 2026-10-13 生产后验收：访问阻塞

应用已通过最终 682 单测、75 Chromium E2E、类型/Lint、构建和 dry-run，正常快进远端 master 到 **2e571b17c3df1054d2d0283bc435c7ced8617db6**。未强推、改保护、增加服务或单独部署。主线代码及本地验证见 [验证记录](../sdcc-diagnostics-2026-10-13/validation.json)。

合入后普通 curl GET 仍观察到上一版 `index-BLsTETfI.js`，本轮预期为 `index-H2DU56iy.js`、`index-BwBJdLr2.css`、`compiler.worker-zxGCDQU1.js`。尚未取得线上新资源哈希匹配，也未对新版执行线上诊断测试。

随后使用环境既有 HTTPS_PROXY 的 Python 3.12 urllib GET 同一精确 URL `https://emuc51.kwgrg-01.workers.dev/`，失败为：

```text
urllib.error.HTTPError: HTTP Error 403: Forbidden
```

失败调用为 `urllib.request.urlopen('https://emuc51.kwgrg-01.workers.dev/', timeout=20)`；失败发生于原站点轮询的第一次调用，后续循环未执行。异常没有保存响应头/正文，**不能确定 403 来自环境代理还是站点**，不能用昨日 Envoy CONNECT 403 解释本次。没有换代理、客户端、域名/IP 或绕过拒绝；遇到拒绝后停止该站点请求。

[附带响应头](pre-release-headers.txt) 与 [HTML](pre-release-index.html) 来自本轮 **07:00:45–46 UTC、合入前**的一次成功访问，用于记录环境此前可访问和旧资源状态；不是 403 响应，也不是新版本验收证据；头文件副本仅规范化了换行与行末空白。[结构化状态](status.json)明确区分未取得的字段。

[已有桌面/窄屏截图](../../screenshots/sdcc-diagnostics/README.md)均为本地生产构建与生产 CSP 下真实浏览器实测，不冒充现网截图。后续需先确认访问条件，再以原正常路径验证自动发布的新资源与诊断流程；父线程可使用上述应用 SHA 查 Cloudflare check。本分支只保存限制记录，不增加应用变更或触发 master 新发布。
