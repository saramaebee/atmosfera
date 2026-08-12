import type { Piece } from '@sapphire/framework';
import { LoaderStrategy } from '@sapphire/pieces';

/**
 * Colocated `*.test.ts` files live inside piece directories (commands/,
 * listeners/, …), and Sapphire's default loader tries to import every file it
 * finds there — which fails loudly on `bun --watch` because bun:test's
 * describe() only exists under the test runner. Skip them.
 */
export class SkipTestFilesStrategy extends LoaderStrategy<Piece> {
  public override filter(path: string) {
    return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ? null : super.filter(path);
  }
}
