# 来源与许可

本版本原创工作流、配置适配、文档和新增代码仅供学习交流，未经Ray许可禁止转载或商用；联系方式：hanshinei7@gmail.com，微信mokusei275。下列第三方组件仍按其原许可使用，该限制不覆盖或替换第三方许可。此前版本原有授权不追溯撤销。

- `skills/whiteboard-video`、`investigation-video`、`video-common`：基于 [trustfuture/simon-skills](https://github.com/trustfuture/simon-skills)，MIT，原许可见 licenses/simon-skills-LICENSE。本项目改了入口、品牌、路径、声音调度和发布包规则。
- `skills/humanizer-zh`：[op7418/Humanizer-zh](https://github.com/op7418/Humanizer-zh)，MIT，原许可见 licenses/humanizer-zh-LICENSE。
- `skills/stop-slop`：[hardikpandya/stop-slop](https://github.com/hardikpandya/stop-slop)，MIT，原许可见 licenses/stop-slop-LICENSE。
- `skills/taste-skill`：[Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)，MIT，原许可见 licenses/taste-skill-LICENSE。
- 小赖字体：SIL OFL 1.1，原许可随字体置于 skills/whiteboard-video/assets/fonts/OFL.txt。未使用的两份Noto字体已从当前包移除；历史版本的许可保持原样。
- `dbs-xhs-title` 仅是可选外部审稿依赖，不随本仓库复制。原 [dbskill](https://github.com/dontbesilent2025/dbskill) 使用 CC BY-NC 4.0，商业使用须另行获得许可。没有它也可使用本仓库的数字/关键词/情绪点标题策略。
- 私人原稿、示例案件文章、音色、账号凭证、配乐及用户成片不在公开包中。用户自行加入的素材按各自许可使用，不由本仓库原创部分许可覆盖。

## 运行依赖许可复核（2026-11-17）

- Remotion及其CLI/渲染组件采用Remotion License，不是普通MIT：个人、至多3名员工的营利组织及符合条件的非营利主体可按条款免费创建视频；不符合免费条件的主体需Company License。不得以自己的Remotion衍生品转售或再许可。以随包licenses/Remotion-LICENSE.md及[官方条款](https://www.remotion.dev/docs/license)为准，不因本项目的许可改变。
- React、Playwright、roughjs、lz-string、Babel等组件以各自锁定版本的package.json与许可证为准；完整依赖清单和特殊条目见docs/release-audit.json。Apache/BSD/ISC等许可不自动变成MIT。实际安装目录保留供应方许可文件。
- 小赖字体实际随包文件Xiaolai-Regular.ttf，原始版权与OFL全文保留。OFL允许视频、Logo等商业设计，但再分发字体须遵守许可，不能单独出售字体；[OFL官方说明](https://openfontlicense.org/ofl-faq/)。未把系统SignPainter字体带入包。
- Python运行依赖Pillow遵守其HPND许可，审计工具另列requirements-audit.txt；字体可商用不等于本项目原创工作流也自动获商用授权。
- 根LICENSE与作者已公开的联系/学习交流范围保持不变。音乐、新闻原片、人物声音、商标与用户生成内容须分别确认权利，本次更新不分发这些素材。

- `@remotion/effects@4.0.544`的npm声明仍为UNLICENSED；没有将它冒改成MIT。维护者JonnyBurger于2026-11-16在[官方问题13403](https://github.com/remotion-dev/remotion/issues/13403)明确说明该包应适用Remotion License，并关联声明修正PR13433。清单同时保存原声明和此复核依据；适用Remotion条件，不代表无条件开源授权。
