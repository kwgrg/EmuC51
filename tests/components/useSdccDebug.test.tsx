import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSdccDebug } from "../../src/components/useSdccDebug";
import { verifySdccDebug, type VerifiedSdccDebug } from "../../src/core/sdcc-debug";
import { sdccFixture } from "../fixtures/sdcc-fixture";
vi.mock("../../src/core/sdcc-debug", async original => ({ ...await original<object>(), verifySdccDebug: vi.fn() }));
afterEach(() => vi.clearAllMocks());
it("hides stale source immediately and ignores out-of-order verification completion", async () => {
  const pending: ((value: VerifiedSdccDebug) => void)[] = [];
  vi.mocked(verifySdccDebug).mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  const first = sdccFixture(), second = sdccFixture("flow", "sdcc-flow");
  const bytes = new ArrayBuffer(1);
  const { result, rerender } = renderHook(({ data }) => useSdccDebug(data, bytes), { initialProps: { data: first } });
  expect(result.current.checking).toBe(true);
  rerender({ data: second });
  const verified = { data: second, firmware: bytes, firmwareSha256: "hash", locations: [] };
  await act(async () => pending[1]!(verified));
  expect(result.current.verified).toBe(verified);
  await act(async () => pending[0]!({ ...verified, data: first }));
  expect(result.current.verified).toBe(verified);
  rerender({ data: first }); expect(result.current.verified).toBeUndefined(); expect(result.current.checking).toBe(true);
});
it("failed restoration exposes no source annotation or line breakpoint data", async () => {
  vi.mocked(verifySdccDebug).mockRejectedValue(new Error("current firmware mismatch"));
  const data = sdccFixture(), bytes = new ArrayBuffer(1);
  const { result } = renderHook(() => useSdccDebug(data, bytes));
  await waitFor(() => expect(result.current.error).toContain("mismatch"));
  expect(result.current.verified).toBeUndefined(); expect(result.current.checking).toBe(false);
});
