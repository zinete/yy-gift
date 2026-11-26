# React + TypeScript + Vite

## 本地识图、找图和采集

启动 Ollama 和 `npm run dev`，通过终端显示的本机地址访问项目。识图需要 Python 3、Pillow 和 requests。

```powershell
python -m pip install Pillow requests
ollama pull qwen3-vl:2b-instruct
ollama pull nomic-embed-text:latest
```

- 在表情包库展开「识图索引与网络采集」，点击「识别已有素材」。脚本会给静态图或 GIF 代表帧生成中文描述，索引保存在本机 SQLite。再次运行只补建缺失或图片地址已变更的记录。
- 在分镜「重新匹配当前镜头」处，按字幕或输入的画面描述进行语义找图，点击候选图应用到当前镜头。
- 在表情包库输入关键词或公开图片直链并点击「采集并分类入库」。网页每次最多尝试 5 张。图片成功下载和识别后，程序把原始文件上传到 Supabase Storage 的 `yy-meme-originals` 存储桶，校验公开地址可读取且文件内容一致，再写入表情包记录。

已有 `qwen3-vl:2b` 时也可以运行，优先使用已安装的 Instruct 版。使用关键词或已有素材要配置
`.env.local` 中的 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`，并应用仓库的 Supabase schema。
采集需要在本机 `.env.local` 配置后端专用的 `SUPABASE_SECRET_KEY`，也支持旧版 `SUPABASE_SERVICE_ROLE_KEY`。
该密钥只能由本地后端读取。首次上传如果存储桶尚不存在，会创建一个公开读取的桶，上传仍由后端凭据授权。
重新采集旧来源链接可把对应表情包迁到 Storage，保留原记录 ID 和标签。
网页识图接口只供本机 Vite 服务使用。也可以在终端分批索引，或在不写入 Supabase 的情况下验证采集。

```powershell
python -X utf8 scripts/visual_index.py index --limit 20
python -X utf8 scripts/visual_index.py search "小熊紧张地藏起鸡腿"
python -X utf8 scripts/visual_index.py crawl "一二布布 gif" --limit 3 --dry-run
python -X utf8 scripts/visual_index.py migrate-local --dry-run
python -X utf8 scripts/visual_index.py migrate-local
```

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
