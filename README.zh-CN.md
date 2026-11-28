# Wickline

[English](README.md) · 简体中文 · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md)

免费、开源的看盘软件（股票和加密货币 K 线图表）。
- 加密货币、美股、港股、A 股、ETF、指数、外汇和期货的实时行情（部分交易所有延迟），支持任意周期（2 分钟、45 分钟、3 小时……）。
- 美股、ETF、比特币和以太坊的期权链，含希腊值（Greeks）、隐含波动率、预期波动和最大痛点。
- 100 个内置技术指标；也可以用 JavaScript 编写自己的指标和交易策略，并进行回测。
- **可折叠指标列表：**点击指标标签下方的小型向上箭头，可统一折叠该图表的主图和副图指标标签；点击向下箭头和数量即可展开。指标继续绘制和实时更新，每张图表独立保存状态，切换交易对、周期、布局及重启后均可恢复。支持 Tab 聚焦和 Enter、空格操作。
- 画线工具、价格警报，一屏 1 到 8 个图表。
- **Shift 单击临时测量：**在普通光标模式下，按 Shift＋左键单击主价格图设置起点；随后可松开 Shift 和鼠标左键，自由移动光标查看价差、涨跌幅、最小价格变动点数、K 线间隔数及组合时长，再次左键单击确定终点。完成后结果保留，下次点击或 Escape 清除。不保存、不占用绘图撤销历史；从现有绘图或可拖动订单线之外开始，原有选择、拖动和 Shift 编辑保持原行为。
- 社区脚本库：发布你的脚本给所有人用，一键添加别人的脚本。
- 选股器、热力图（18 个股票市场和加密货币）、新闻与财经日历、K 线回放和模拟交易。
- 更长的历史数据：加密货币 1 分钟 K 线可回溯到 2017 年，美股用免费的 Alpaca 密钥（可选）可回溯到 2016 年。数据保存在你的电脑上，K 线回放也可以从多年前开始。策略测试器也可以在这些历史数据中按日期范围回测。
- 无需注册账号，不收订阅费，也无需 API 密钥（Alpaca 密钥可选）。

**[下载桌面版](../../releases/latest)**（Windows、macOS、Linux）。下载即用，无需任何设置。

![Wickline：多图布局、指标、任意周期、社区脚本、新闻、K 线回放与模拟交易、期权链、热力图](docs/demo.gif)

## 下载

在 [Releases](../../releases/latest) 页面下载适合你电脑的文件：

| 你的电脑 | 文件 |
| --- | --- |
| **Windows** | `Wickline-for-Windows-Portable-x.y.z.exe`（免安装，直接运行），或安装版 `Wickline-for-Windows-Setup-x.y.z.exe`（会自动更新） |
| **搭载 Apple 芯片的 Mac**（M1、M2、M3、M4 及更新） | `Wickline-for-Mac-Apple-Silicon-x.y.z.dmg` |
| 搭载 Intel 处理器的 Mac（较旧的 Mac） | `Wickline-Intel-Mac-x.y.z.dmg` |
| Linux | `Wickline-Linux-x.y.z.AppImage`（任何发行版，会自动更新）或 `Wickline-Linux-x.y.z.deb`（Debian、Ubuntu） |

**更新：**Windows 安装版和 Linux AppImage 会自动下载新版本，并在重启时安装。免安装版、.deb 和 Mac 版会显示带下载链接的提示。

不确定是哪种 Mac？苹果菜单 →“关于本机”：显示“芯片：Apple M…”的是 Apple 芯片，显示“处理器：… Intel”的是 Intel。

### 首次打开

软件没有付费的代码签名，所以第一次打开时系统会提示一次：
- **Windows**：在“Windows 已保护你的电脑”窗口中点“更多信息 → 仍要运行”。
- **macOS**：把 Wickline 拖到“应用程序”文件夹后打开。提示无法验证该应用时，**不要点“移到废纸篓”**，点“取消”（或“完成”），然后打开“系统设置 → 隐私与安全性”，向下滚动，点“仍要打开”。
- **macOS 提示应用“已损坏”**（0.1.6 之前的版本在 Apple 芯片的 Mac 上会出现）：在“终端”中运行 `xattr -cr /Applications/Wickline.app`。

## 数据来源

股票、ETF、指数、外汇和期货行情来自 Yahoo（包括美股、港股、A 股、日股等），加密货币来自 Binance、Binance 合约、Coinbase、Bybit 和 OKX，比特币和以太坊期权来自 Deribit。数据通过你自己的网络连接获取，中间不经过任何其他服务器。部分地区的网络无法直接访问这些网站。这种情况下，可以在桌面版中设置网络代理：⚙（数据源）→ **网络代理**，使用系统代理，或手动填写 HTTP / SOCKS5 代理（例如 Clash 的 `127.0.0.1:7890`）。详见英文说明中的 [Using a proxy](README.md#using-a-proxy)。

**下载的历史数据：**向前滚动图表或使用 K 线回放时，应用会下载更早的数据并保存在你的电脑上：加密货币从 2017 年开始（Binance 公开存档），美股用你自己的免费 [Alpaca](https://alpaca.markets) 密钥从 2016 年开始（⚙ → 数据源 → Alpaca；密钥只保存在这台电脑上，只发送给 Alpaca）。小的下载会自动进行，大的会先询问。详见英文版：[Downloaded history](README.md#downloaded-history)。

## 界面语言

界面支持简体中文、繁體中文、English、日本語、한국어、Español、Português (Brasil)、Italiano、Deutsch 和 Français，默认跟随系统语言。要切换语言，点右上角的 ⚙（数据源）→ **语言 (Language)**，选择后点 **保存**。

## 常用绘图工具

在左侧绘图工具菜单中点击星星，可收藏或取消收藏工具，不会选中工具或关闭菜单。收藏的工具按收藏先后显示在图表内的浮动栏中，点击图标即可绘图。拖动左侧手柄可以移动工具栏，工具较多时可横向滚动，也可使用鼠标滚轮。收藏顺序和位置会自动保存，并与弹出窗口同步；取消最后一个收藏后，工具栏自动隐藏。

## 反馈

欢迎在 [Issues](../../issues) 中用中文或英文提问、报告问题或提出建议。

## 许可证

[MIT](LICENSE)，免费开源。
