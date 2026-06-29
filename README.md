# Iron Nest 火控计算机

开火功能：https://github.com/svr2kos2/IronNestFCS

【安装步骤】

1. 通过 Steam 安装 "IRON NEST: Heavy Turret Simulator" (Demo)
2. 找到游戏安装目录，例如：
   D:\Steam\steamapps\common\IRON NEST Heavy Turet Simulator Demo\
3. 将本压缩包内的所有文件/文件夹，直接解压覆盖到游戏根目录
4. 启动游戏即可。

> 是的，就是这么简单

【食用方法】

1. 启动游戏，等待进入关卡（约10-15秒完成初始化）
2. 用浏览器（手机/电脑均可）打开 http://[游戏机器IP]:45678
3. 输入铁巢位置坐标并确定
4. 网页地图页会自动显示所有敌人位置
5. 可直接在网页上点击"打击"按钮下发火力任务

【注意事项】

- 首次启动可能比原版慢约114514秒，这是加载器初始化的正常现象
- 如果防火墙弹窗，请允许游戏的网络访问（端口45678）
- 游戏更新后如果mod失效，可能需要更新本包
- 不要删除 bepinex_dotnet 目录，它是.NET运行时的文件

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
