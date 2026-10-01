import { httpJson, type HttpJson } from '../core/http.js';
import type { Platform, PlatformAdapter } from '../core/types.js';
import { createJabamaAdapter } from './jabama.js';
import { createJajigaAdapter } from './jajiga.js';
import { createOtaghakAdapter } from './otaghak.js';

export function createAdapters(http: HttpJson = httpJson): Record<Platform, PlatformAdapter> {
  return {
    jabama: createJabamaAdapter(http),
    jajiga: createJajigaAdapter(http),
    otaghak: createOtaghakAdapter(http),
  };
}
