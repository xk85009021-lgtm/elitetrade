# 宝塔部署与 APP 打包

宝塔：
1. 安装 Node.js 20/22、PM2、Nginx。
2. 上传交付包到 /www/wwwroot/yingto-copy。
3. 保留 data、uploads 目录，执行 npm install。
4. 修改 ecosystem.config.cjs 中的域名和 JWT 密钥。
5. 执行 pm2 start ecosystem.config.cjs && pm2 save。
6. 宝塔创建站点并反向代理到 http://127.0.0.1:8787。
7. 申请 SSL 并开启强制 HTTPS。

Capacitor：
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init 盈透copy com.yingtocopy.app --web-dir=dist
npx cap add android
npx cap add ios
npx cap sync
npx cap open android
npx cap open ios

将 mobile/capacitor.config.json 的 server.url 改为正式 HTTPS 域名。
