// =====================================================================
// ts-resolve.mjs — テスト実行時だけ使う import 解決フック
//
// アプリ側のコードは Vite / tsconfig の作法に合わせて拡張子を省略している
// （import { ... } from './validation'）。一方 Node は拡張子を省略した
// 相対 import を解決できないため、テストから直接読むと ERR_MODULE_NOT_FOUND になる。
//
// そこで「相対 import で拡張子が無いものは .ts を足して再試行する」だけの
// フックを入れる。アプリ側のコードには一切手を入れなくて済む。
//
// 使い方（package.json の test スクリプトで指定済み）：
//   node --experimental-strip-types --import ./scripts/ts-resolve.mjs --test ...
// =====================================================================

import { registerHooks } from 'node:module';

const HAS_EXTENSION = /\.[cm]?[jt]sx?$/i;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !HAS_EXTENSION.test(specifier)) {
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        try {
          return nextResolve(candidate, context);
        } catch {
          // 次の候補を試す
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
