import { expect,it } from 'vitest';
import { PROJECT_BUNDLE_LIMIT, serializeSdccBundle } from '../../src/core/sdcc-project';
it('uses exact downloadable UTF-8 bytes including newline at the 2 MiB boundary',()=>{
  for(const prefix of ['', '汉字😀', '\u0001\u0000"\\']) {
    const base=serializeSdccBundle({source:prefix});
    const source=prefix+'x'.repeat(PROJECT_BUNDLE_LIMIT-new TextEncoder().encode(base).byteLength);
    const serialized=serializeSdccBundle({source});
    expect(new TextEncoder().encode(serialized).byteLength).toBe(PROJECT_BUNDLE_LIMIT);
    expect(JSON.parse(serialized).source).toBe(source);
    expect(()=>serializeSdccBundle({source:source+'x'})).toThrow('2 MiB');
  }
});
