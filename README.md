# QuanX-Roaming

适合经常从香港、澳门往来中国内地或其他地区时使用的 Quantumult X 配置。

人在不同地区时，网络出口和 App 访问方式经常要跟着变：在内地，大部分国外网站和 App 通常需要走代理；在港澳，很多国外服务可以直连，可能只需要让 AI 这类服务单独走代理。

这份配置的核心思路很简单：用 `环境模式` 在 `中国策略` 和 `香港策略` 之间快速切换，同时保留 AI、常用 App、媒体、金融支付、广告拦截和 rewrite 增强等功能。

配置导入链接：

```text
https://raw.githubusercontent.com/YatMn/QuanX-Roaming/main/profiles/QuanX-Roaming.conf
```

## 致谢与来源

本配置基于墨鱼的 Quantumult X 配置改造，保留了原配置中的规则体系和大量实用模块，并在此基础上增加了港澳往来内地或其他地区、AI、App 独立策略和金融支付等使用场景。

原始配置来源：

- [ddgksf2013/Profile - QuantumultX.conf](https://github.com/ddgksf2013/Profile/blob/master/QuantumultX.conf)

感谢原作者和相关规则、rewrite、图标资源维护者的长期整理与分享。

## 功能概览

- `环境模式`：在内地常用的 `中国策略` 和港澳常用的 `香港策略` 之间切换。
- `AI`：AI 流量单独控制，不完全跟随当前地区模式。
- App 独立策略：Google、YouTube、Telegram、Netflix、TikTok、Instagram、Twitter 等可以单独切换。
- 媒体分流：包含 Netflix、YouTube、Spotify、哔哩哔哩、国际媒体等规则。
- `金融支付`：支付宝、微信支付、银联、银行、保险、12306 等可单独控制。
- 广告拦截与净化：包含广告规则、去开屏、YouTube/微博/高德/网易云/闲鱼/知乎/彩云天气等净化类 rewrite。
- 网页与功能增强：包含 Safari 搜索增强、豆瓣网页观影跳转、Google 重定向、小红书去水印、百度网盘净化/倍速、微信解锁被屏蔽链接等。
- 流媒体查询：包含流媒体解锁查询入口，方便检查节点支持情况。

## 使用前准备

你需要先准备：

1. 已安装 Quantumult X 的 iPhone 或 iPad。
2. 一个可用的节点订阅，或你自己手动添加的节点。
3. 可以访问 GitHub Raw 链接的网络环境。

这份配置只提供规则、策略组和 rewrite，不提供节点。导入后还需要添加你自己的节点订阅。

## 导入配置

1. 打开 Quantumult X。
2. 进入配置管理页面。
3. 添加远程配置。
4. 粘贴下面的链接：

   ```text
   https://raw.githubusercontent.com/YatMn/QuanX-Roaming/main/profiles/QuanX-Roaming.conf
   ```

5. 保存并下载配置。
6. 回到 Quantumult X 主界面，确认当前使用的是这份配置。

如果导入失败，先确认：

- 复制的是 Raw 链接，不是 GitHub 页面链接。
- 链接末尾是 `QuanX-Roaming.conf`。
- 当前网络可以访问 `raw.githubusercontent.com`。

## 添加节点

配置导入后，还需要添加节点：

1. 进入 Quantumult X 的节点、服务器或资源管理页面。
2. 添加你的节点订阅，或手动添加节点。
3. 更新节点资源。
4. 回到策略页，确认节点已经出现。

如果策略组里没有节点，通常是节点还没添加、订阅没有更新成功，或节点名称不适合自动归类。先确认节点本身能正常显示和使用。

## 日常使用

在中国内地：

1. 打开 Quantumult X 的策略页。
2. 找到 `环境模式`。
3. 切换到 `中国策略`。
4. Google、YouTube、Telegram、Netflix 等国外服务跟随 `环境模式` 走代理。
5. `金融支付` 建议优先保持 `direct`。
6. `AI` 可以单独选择一个适合 AI 的节点。

在香港、澳门或其他国外服务可直连的地区：

1. 打开 Quantumult X 的策略页。
2. 找到 `环境模式`。
3. 切换到 `香港策略`。
4. Google、YouTube、Telegram、Netflix 等常用国外服务可以跟随 `环境模式` 直连。
5. `AI` 仍然单独选择可用节点。
6. 如果某个媒体 App 需要指定地区，可以只切换对应 App 的策略。

遇到单个 App 异常时，优先进入对应策略组手动切换，不需要马上改全局模式。

## 常见问题

### 导入后没有节点

正常。这份配置不包含节点，请先添加自己的节点订阅。

### AI 不能用

进入 `AI` 策略组，手动换一个节点。AI 服务通常更依赖出口地区、IP 质量和节点稳定性。

### 支付或银行 App 异常

进入 `金融支付` 策略组，先尝试 `direct`。如果仍然异常，再检查相关 rewrite。

### 某个 App 登录、播放或跳转异常

优先检查 rewrite。rewrite 会改变部分 App 或网页请求行为，如果登录、播放、地图、网盘、支付异常，可以先临时关闭相关 rewrite 再测试。

## 注意事项

- 配置中保留了 `[mitm]` 段落，但不包含证书内容。如果你不理解 Quantumult X 的 MITM 设置，建议先在客户端里关闭或仔细检查后再启用。
- `geo_location_checker` 会让 Quantumult X 显示当前出口 IP 的地理位置和运营商信息；启用后会向配置中的 IP 查询服务发送请求。
