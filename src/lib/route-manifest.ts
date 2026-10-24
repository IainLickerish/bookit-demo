import { readdirSync } from 'node:fs';
import path from 'node:path';

// BookIt's route manifest: every path the app serves, read from the App
// Router's directory tree, so it can never drift from the code. Tests and
// documentation checks (DEF-05) compare in-app paths against it. Dynamic
// segments stay as written, for example `/auth/reset-password/[token]`.

export const APP_DIR = path.resolve(import.meta.dirname, '../app');

const ROUTE_FILES = new Set(['page.tsx', 'page.ts', 'route.ts']);

function isRouteGroup(segment: string): boolean {
  return segment.startsWith('(') && segment.endsWith(')');
}

export function routeManifest(appDir: string = APP_DIR): string[] {
  const routes: string[] = [];
  const walk = (dir: string, segments: string[]): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // Private folders (`_x`) and parallel-route slots (`@x`) are not URL segments.
        if (entry.name.startsWith('_') || entry.name.startsWith('@')) {
          continue;
        }
        walk(path.join(dir, entry.name), isRouteGroup(entry.name) ? segments : [...segments, entry.name]);
      } else if (ROUTE_FILES.has(entry.name)) {
        routes.push(`/${segments.join('/')}`);
      }
    }
  };
  walk(appDir, []);
  return [...new Set(routes)].sort();
}

function segmentMatches(pattern: string, segment: string): boolean {
  return /^\[[^.\]]+\]$/.test(pattern) ? segment !== '' : pattern === segment;
}

/** Whether a concrete path such as `/auth/reset-password/abc` is served by a manifest route. */
export function pathInManifest(pathWithQuery: string, manifest: readonly string[]): boolean {
  const [pathname = ''] = pathWithQuery.split(/[?#]/, 1);
  const segments = pathname.split('/').filter((s) => s !== '');
  return manifest.some((route) => {
    const pattern = route.split('/').filter((s) => s !== '');
    const catchAll = pattern.at(-1)?.startsWith('[...') ?? false;
    if (catchAll) {
      const fixed = pattern.slice(0, -1);
      return segments.length > fixed.length && fixed.every((p, i) => segmentMatches(p, segments[i]!));
    }
    return pattern.length === segments.length && pattern.every((p, i) => segmentMatches(p, segments[i]!));
  });
}
