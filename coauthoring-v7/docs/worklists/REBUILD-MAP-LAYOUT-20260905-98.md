# 第98批：功能地图桌面留白修复

## 变更合同

- 目标：修复用户截图中功能目录下方大片留白，使阅读长详情时仍能查看和切换目录。
- 范围：功能地图专属CSS、对应运行证据与交接记录；复用现有列表、详情和选择逻辑。
- 保留及不改：绿色白色视觉、79单元与85来源、搜索/筛选/依赖跳转、选中状态和手机单栏；不改共享外壳、业务代码、接口、账号、数据或其他后台功能。
- 验收：桌面目录在顶栏下停留，高度随窗口调整，长详情滚动时目录不滚走；列表末尾可达，切换详情、筛选空结果及恢复有效；手机不悬浮遮挡、不横向溢出。
- 验证：桌面1440×1000修复前后截图及滚动尺寸、较矮桌面、390×844手机；既有地图/后台组件测试、后台类型检查和构建。纯局部CSS，不触发全量测试或模型调用。
- 发布：仅本地修复，不推送、不部署，不改变生产。
- 状态：本地修复与验收通过；未推送、未部署。

## 定位证据

- 现有`.rebuild-map`固定`max-height: 850px`，`.rebuild-workspace`使用`align-items: start`；较长详情决定工作区高度，目录随外层页面滚走后，左列留下空白。
- 1440×1000真实浏览器、RB-00：目录高850px，详情高1403px；向下阅读后目录底部进入视口中段，截图重现空白。Git来源为`8aaecc14`，复用原实现，仅调整目录定位和高度。

## 验证与交付

- 实现仅改两处专属CSS：桌面目录`position: sticky; top: 100px`，最大高度为视口减120px；1100px及以下恢复静态单栏和原520px上限。详情仍按原页面滚动，目录抵达详情末尾后一起退出，不遮挡后续内容。
- 1440×1000同视口修复前后截图已记录在本任务浏览器输出；修复后阅读RB-00中段（页面滚动1099px），目录顶部100px、底部980px，右侧详情仍在继续，原大片空白消失。到详情末尾两栏底部齐平。
- 目录79项末尾可达：点击RB-61后详情与URL一致，列表自身滚动5645px，末项仍在视口中；1440×720下目录高600px、顶部100px、底部700px，无横向溢出。
- 搜索不存在的词显示0结果与“清除筛选”；点击恢复79结果并保留当前详情。390×844下目录静态高520px、无横向溢出，点击RB-00后详情定位约100px，不被悬浮目录遮挡，手机截图已记录。
- `node node_modules/vitest/vitest.mjs run --config coauthoring-v7/admin-console/vite.config.mjs --configLoader native coauthoring-v7/admin-console/src/RebuildControlCenter.test.tsx coauthoring-v7/admin-console/src/AssetAdminApp.test.tsx`：2文件、6项通过，覆盖搜索/依赖/定位、空结果恢复、失败重试与保留旧结果、配置入口和既有导航。
- `node node_modules/typescript/bin/tsc -p coauthoring-v7/admin-console/tsconfig.json --noEmit`通过；`node node_modules/vite/bin/vite.js build --config coauthoring-v7/admin-console/vite.config.mjs --configLoader native`通过。保留既有主包596.61kB的体积警告，本次不扩展分包范围。
- 已按界面短验收核对本次滚动、对齐、可达性、空结果恢复和手机布局；本次不改加载/错误逻辑，相关恢复由既有组件测试覆盖，未重复停止测试API。
- 无业务逻辑、数据、权限、状态或入口变化，不新增功能或改变79单元的开发状态；不触发全量验证，无模型调用。保留工作区原有`.claude/`。
