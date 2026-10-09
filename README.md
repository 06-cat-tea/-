# 折纸文学

一个无需构建工具的静态中文小说站点，包含 10 部原创示例作品、分类筛选、书名/作者/关键词搜索、人气与更新排序、分页书库、作者草稿、个人书架、阅读进度续读、书评评分和作品分享。浏览器数据目前通过 `localStorage` 保存；接入正式后端时可在 `index.html` 脚本开头设置 `API_BASE`。

站点提供 PWA manifest 和离线服务工作线程。用户首次在线打开后，页面外壳会缓存在设备上，断网时可继续访问页面；外部字体和未来接入的服务端内容仍需要网络。

## 本地预览

直接打开 `index.html` 可以查看页面。若要体验离线缓存和 PWA 安装能力，请通过本地 HTTP 静态服务器访问，例如：

```powershell
python -m http.server 8000
```

然后打开 `http://localhost:8000`。服务工作线程只会在 HTTPS 或 localhost 下启用。

## GitHub Pages 发布

仓库包含 `.github/workflows/pages.yml`。推送到 `main` 分支后，GitHub Actions 会发布静态站点。首次设置仓库时，在 **Settings → Pages → Build and deployment** 里将来源选择为 **GitHub Actions**。发布完成后，页面地址会显示在 Pages 设置页和 Actions 部署任务中。

GitHub Pages 发布的网站是公开可访问的；不要把密码、密钥、私人草稿或其他敏感资料放进站点文件。
