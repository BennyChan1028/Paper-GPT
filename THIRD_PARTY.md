# 中文 PDF 排版组件

“全文翻译为 PDF”通过本机独立进程调用 [BabelDOC](https://github.com/funstory-ai/BabelDOC)，即 PDFMathTranslate-next 使用的排版引擎。BabelDOC 采用 [AGPL-3.0](https://github.com/funstory-ai/BabelDOC/blob/main/LICENSE) 许可证，其源码与许可证由上游提供，安装包元数据中亦包含相应许可证。

本仓库提供自行编写的文件队列适配器；没有复制 zotero-pdf2zh 的插件代码，没有把 BabelDOC 源码、模型或 Python 环境打包进 XPI。首次安装 PDF 导出组件时，通过 PyPI 单独安装列于 pdf-export-requirements.txt 的依赖。BabelDOC 自身及依赖保留各自版权与许可，发布或修改这些依赖时应遵守相应许可。

自 1.6.19 起，翻译本页、全文译文批注及 PDF 导出由插件直接请求 DeepSeek 官方 API，密钥保存在本机 Zotero 密码管理器。本机组件处理 PDF 的解析与排版，Python 工作进程不接收 API 密钥。模型和字体首次下载由上游资产下载器完成。没有自建远程翻译服务器或本机 HTTP 监听端口。
