================================
  Iron Nest 火控计算机 ModPack 安装说明
========================================

【安装步骤】

1. 通过 Steam 安装 "IRON NEST: Heavy Turret Simulator" (Demo)
2. 找到游戏安装目录，例如：
   D:\Steam\steamapps\common\IRON NEST Heavy Turet Simulator Demo\
3. 将本压缩包内的所有文件/文件夹，直接解压覆盖到游戏根目录
4. 启动游戏即可

【包含内容】

- MelonLoader (mod加载器)
- BepInEx (mod框架 + .NET运行时)
- MapEnemyMarker.dll (敌人雷达 + HTTP服务 + 打击桥接)
- IronNestFCS.dll + IronNestFCS.Logic.dll (火控自动化)
- 火控计算机网页版 (弹道计算网页，游戏中访问 http://localhost:45678)

【使用方法】

1. 启动游戏，等待进入关卡（约10-15秒完成初始化）
2. 用浏览器（手机/电脑均可）打开 http://[游戏机器IP]:45678
3. 网页地图页会自动显示所有敌人位置
4. 可直接在网页上点击"打击"按钮下发火力任务

【注意事项】

- 首次启动可能比原版慢约10秒，这是加载器初始化的正常现象
- 如果防火墙弹窗，请允许游戏的网络访问（端口45678）
- 游戏更新后如果mod失效，可能需要更新本包
- 不要删除 bepinex_dotnet 目录，它是.NET运行时

【文件结构说明】

游戏根目录/
├── version.dll          ← 加载器入口
├── doorstop_config.ini  ← 加载器配置
├── .doorstop_version
├── MelonLoader/         ← MelonLoader 运行时
├── Mods/                ← MelonLoader mods (IronNestFCS)
├── UserData/            ← mod配置和热加载逻辑DLL
├── UserLibs/            ← mod依赖库
├── Plugins/             ← 额外插件
├── BepInEx/             ← BepInEx框架 (MapEnemyMarker)
├── bepinex_dotnet/      ← .NET 6运行时
└── 火控计算机网页版/    ← 网页前端文件

================================