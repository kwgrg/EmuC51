# 2026-10-13 现网 403 有界诊断

## 当前结论

**本次确实复现普通 HTTP 403，响应正文明确为 `error code: 1010`，带 Cloudflare Ray ID。证据支持 Cloudflare 浏览器签名检查拒绝此 Python 请求；不是本次 CONNECT 隧道拒绝或 TLS 证书错误的表现。**具体触发规则、所属安全配置及是否仅由 User-Agent 触发，仍需服务端日志确认，不能断言用户手动配置过拦截。

Cloudflare [Error 1010 官方说明](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/)将此错误定义为基于浏览器签名的访问拒绝，并指向 Browser Integrity Check。其 [BIC 文档](https://developers.cloudflare.com/waf/tools/browser-integrity-check/)说明非标准 User-Agent 等请求特征可能受到检查。因此，当前 `Python-urllib/3.12` 与此前成功的 curl / Chromium 客户端差异是有依据的排查线索，**尚未证明是唯一触发因素**。没有换客户端、伪装 User-Agent 或调整代理来做差异试探。

## 单次请求事实

- 时间：2026-10-13 **08:01:19.808823–08:01:20.116954 UTC**。
- 精确 URL：`https://emuc51.kwgrg-01.workers.dev/`，GET，无查询参数、请求体、自定义头或 SSL context，20 秒超时，零重试。
- Python 3.12.14 / urllib 默认 User-Agent `Python-urllib/3.12`；沿环境原代理 `http://proxy:8080`，目标未命中 NO_PROXY；未调整证书校验或环境配置。
- 状态 **403**；完整正文仅 17 字节，`error code: 1010` 加换行。
- Ray ID：**`a49cd0d48a50ddab-DFW`**；另有 `cf-nel`、`x-envoy-upstream-service-time: 146` 和 `server: envoy`。
- `server: envoy` 单独不能说明是代理策略拒绝；既有成功响应同样有该值。本次 Cloudflare 错误码/Ray/相关头共同支持上游 Cloudflare 拒绝的判断。
- 返回类型是 `urllib.error.HTTPError`，而本机标准库 CONNECT 非成功路径抛 `OSError("Tunnel connection failed: …")`，由 urllib 包装为传输错误；本次没有这种错误，也没有证书校验错误。没有抓取 CONNECT 原始报文，结论依据异常路径和实际 HTTP 响应，而非虚构 CONNECT 记录。
- 已停止该生产站点的后续请求，未获取 HTML、JS/CSS 或资源哈希，未恢复新版浏览器验收。当前可确认此 Python 请求不能正常访问，不能外推所有普通浏览器均不可访问。

原始材料：[请求脚本](probe.py)、[脱敏配置](configuration.json)、[状态/响应头/时间](response.json)、[完整错误正文](response-body.txt)。脚本仅供审查/获授权后复现，不应循环重试拒绝。

## 与旧证据、发布时序的关系

父线程确认最新应用 `58de5b8135c52e9f762b670fbf2bc743ba89d3fe` 的 Cloudflare check **115190899961** 于 **07:56:34 UTC** 成功，version **e4c83dc1-9fbf-4e8c-bd7c-6eb8fe006bd1**。此元数据由父线程提供，本任务没有重新调用 Cloudflare API。当前 403 在该成功时间之后约五分钟，不能仅用“发布尚未完成”解释；也没有拿到资源来证明已访问到最新版本。

旧证据位于提交 `a08a22c21dc8673aafcb7121d7164f6d61cf0f0c` 的 `docs/evidence/sdcc-diagnostics-production-2026-10-13/`：

- 成功 curl 头/HTML来自 **07:00:45–46 UTC、合入前**，内容为旧 `index-BLsTETfI.js`；证明当时可达，不证明后来发布失败或缓存故障。
- 旧失败仅保存 Python `HTTPError: 403`，没有其响应头/正文；本次 1010 不能追溯证明旧失败也是同一原因。
- 旧任务已只读确认没有保存完整轮询脚本及成功 curl 完整命令，不能断言当时两个客户端的代理解析/证书参数完全一致。已知失败调用与本次相同，未显式关闭证书校验。
- 10 月 12 日存在另一条早期 CONNECT 403 记录，也存在其后放行后的 curl/真实 Chromium 15 项线上通过证据；不能将三次不同证据混为同一限制。

## 最小处理建议

1. **先查日志，不改应用或网络设置。**将精确域名、08:01:20 UTC、Ray `a49cd0d48a50ddab-DFW` 提供给管理该主机安全策略的一方，确认命中的服务/规则和请求特征。若账户提供该主机的 [Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)，按时间和主机缩小范围并匹配 Ray；该页面可显示 BIC 等安全事件，但日志有采样，未查到不能反证没有拦截。
2. 若证实为误拦截且该主机的 BIC 可由用户管理，再由用户批准只针对所需主机/验收流量的最小例外。官方支持选择性跳过/配置 BIC；不要默认全局关闭防护。当前是 `workers.dev` 平台子域名，**没有确认该账户能管理对应 zone 的 BIC**；如果控制台没有该主机的安全事件或设置入口，应将上述证据交给平台/Cloudflare 支持定位，不要去改无关自有域名或猜一个开关。
3. 目前没有证据需要重新放行环境域名、换环境/代理、改 CSP、禁用证书验证、清缓存、回滚或重新部署。CSP 属于浏览器收到页面后执行的策略，不能导致这次 urllib 的根页面 1010。
4. 访问限制经负责方确认修正或提供正式允许的验收配置后，再沿同一正常链路验证根页面、比对最新资源哈希、恢复真实浏览器验收。当前尚不能声称验收恢复或新版现网通过。

只新增诊断证据，保存在独立 evidence 分支；不合入 master、不触发主线发布、不改安全配置。本轮没有运行新功能或修改应用代码。
