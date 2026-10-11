import { useEffect, useState } from "react";
import { verifySdccDebug, type SdccDebugData, type VerifiedSdccDebug } from "../core/sdcc-debug";

export function useSdccDebug(data?: SdccDebugData, firmware?: ArrayBuffer) {
  const [result, setResult] = useState<{ data: SdccDebugData; firmware: ArrayBuffer; verified?: VerifiedSdccDebug; error?: string }>();
  useEffect(() => {
    let cancelled = false;
    if (data && firmware) void verifySdccDebug(data, firmware).then(verified => {
      if (!cancelled) setResult({ data, firmware, verified });
    }).catch(error => {
      if (!cancelled) setResult({ data, firmware, error: error instanceof Error ? error.message : "校验失败" });
    });
    return () => { cancelled = true; };
  }, [data, firmware]);
  const current = result?.data === data && result?.firmware === firmware ? result : undefined;
  return { verified: current?.verified, error: current?.error, checking: Boolean(data && firmware && !current) };
}
