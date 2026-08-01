import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { hex16, hex8 } from "./core/numbers";
import type {
  CpuSnapshot,
  CpuViewState,
  MemorySpace,
  StepResult,
} from "./core/types";
import {
  clearWorkspace,
  loadWorkspace,
  requestPersistentStorage,
  saveWorkspace,
  sha256Hex,
  type WorkspaceRecord,
  type WorkspaceSettings,
} from "./persistence/db";
import type { EmulatorCommand, EmulatorEvent } from "./worker/protocol";

type CommandWithoutId = EmulatorCommand extends infer Command
  ? Command extends { requestId: number }
    ? Omit<Command, "requestId">
    : never
  : never;

interface FirmwareState {
  name: string;
  bytes: ArrayBuffer;
  sha256: string;
  loadedAt: number;
}

const DEFAULT_SETTINGS: WorkspaceSettings = {
  maxSteps: 1_000_000,
  traceEnabled: true,
  selectedMemorySpace: "code",
};

const MEMORY_LABELS: Record<MemorySpace, string> = {
  code: "CODE",
  iram: "IRAM",
  sfr: "SFR",
  xram: "XRAM",
};

const copyBuffer = (buffer: ArrayBuffer): ArrayBuffer => buffer.slice(0);

const formatFault = (event: Extract<EmulatorEvent, { type: "ExecutionFault" }>): string => {
  const location = event.error.pc === undefined ? "" : ` · PC=${hex16(event.error.pc)}`;
  return `${event.error.message}${location}`;
};

export default function App() {
  const workerRef = useRef<Worker | undefined>(undefined);
  const requestIdRef = useRef(0);
  const firmwareRef = useRef<FirmwareState | undefined>(undefined);
  const snapshotRef = useRef<CpuSnapshot | undefined>(undefined);
  const settingsRef = useRef<WorkspaceSettings>(DEFAULT_SETTINGS);
  const memoryAddressRef = useRef(0);

  const [firmware, setFirmware] = useState<FirmwareState>();
  const [cpuState, setCpuState] = useState<CpuViewState>();
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const [running, setRunning] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState("正在检查本地工作区…");
  const [trace, setTrace] = useState<StepResult[]>([]);
  const [memoryAddress, setMemoryAddress] = useState(0);
  const [memoryBytes, setMemoryBytes] = useState<Uint8Array<ArrayBufferLike>>(
    new Uint8Array(),
  );

  const postCommand = useCallback(
    (command: CommandWithoutId, transfer: Transferable[] = []): number => {
      const requestId = ++requestIdRef.current;
      workerRef.current?.postMessage({ ...command, requestId } satisfies EmulatorCommand, transfer);
      return requestId;
    },
    [],
  );

  const persistSnapshot = useCallback(async (snapshot: CpuSnapshot): Promise<void> => {
    snapshotRef.current = snapshot;
    const currentFirmware = firmwareRef.current;
    if (!currentFirmware) return;
    const record: WorkspaceRecord = {
      schemaVersion: 1,
      coreStateVersion: 1,
      firmware: {
        name: currentFirmware.name,
        bytes: copyBuffer(currentFirmware.bytes),
        sha256: currentFirmware.sha256,
        loadedAt: currentFirmware.loadedAt,
      },
      cpu: snapshot,
      settings: settingsRef.current,
      updatedAt: Date.now(),
    };
    try {
      await saveWorkspace(record);
      setNotice("工作区已保存在此浏览器");
    } catch {
      setNotice("无法写入浏览器存储；本次会话仍可继续");
    }
  }, []);

  const requestMemory = useCallback(() => {
    if (!firmwareRef.current) return;
    postCommand({
      type: "ReadMemory",
      space: settingsRef.current.selectedMemorySpace,
      address: memoryAddressRef.current,
      length: 256,
    });
  }, [postCommand]);

  const handleWorkerEvent = useCallback(
    (event: EmulatorEvent): void => {
      switch (event.type) {
        case "Ready":
          setCpuState(event.state);
          setRunning(false);
          setRestoring(false);
          setError(undefined);
          void persistSnapshot(event.snapshot);
          setTimeout(requestMemory, 0);
          break;
        case "StateChanged":
          setCpuState(event.state);
          setRunning(event.running);
          break;
        case "TraceBatch":
          setTrace((current) => [...current, ...event.trace].slice(-1000));
          break;
        case "MemoryData":
          setMemoryBytes(event.bytes);
          break;
        case "SnapshotCreated":
          void persistSnapshot(event.snapshot);
          break;
        case "Stopped":
          setCpuState(event.state);
          setRunning(false);
          setNotice(
            event.reason === "StepLimitReached"
              ? "已达到本次运行步数上限"
              : "执行已暂停",
          );
          void persistSnapshot(event.snapshot);
          setTimeout(requestMemory, 0);
          break;
        case "ExecutionFault":
          setRunning(false);
          setError(formatFault(event));
          if (event.state) setCpuState(event.state);
          if (event.snapshot) void persistSnapshot(event.snapshot);
          setTimeout(requestMemory, 0);
          break;
      }
    },
    [persistSnapshot, requestMemory],
  );

  useEffect(() => {
    const worker = new Worker(new URL("./worker/emulator.worker.ts", import.meta.url), {
      type: "module",
      name: "emuc51-core",
    });
    workerRef.current = worker;
    worker.onmessage = (message: MessageEvent<EmulatorEvent>) =>
      handleWorkerEvent(message.data);

    void (async () => {
      try {
        const loaded = await loadWorkspace();
        if (!loaded) {
          setRestoring(false);
          setNotice("选择一个本地固件即可开始；文件不会离开浏览器");
          return;
        }
        const savedFirmware =
          loaded.kind === "complete" ? loaded.record.firmware : loaded.firmware;
        const savedSettings =
          loaded.kind === "complete"
            ? loaded.record.settings
            : (loaded.settings ?? DEFAULT_SETTINGS);
        const restoredFirmware: FirmwareState = {
          ...savedFirmware,
          bytes: copyBuffer(savedFirmware.bytes),
        };
        firmwareRef.current = restoredFirmware;
        settingsRef.current = savedSettings;
        setFirmware(restoredFirmware);
        setSettingsState(savedSettings);
        const transferBytes = copyBuffer(savedFirmware.bytes);
        if (loaded.kind === "complete") {
          postCommand(
            {
              type: "RestoreWorkspace",
              name: savedFirmware.name,
              bytes: transferBytes,
              snapshot: loaded.record.cpu,
            },
            [transferBytes],
          );
          setNotice("正在恢复上次工作区…");
        } else {
          postCommand(
            { type: "LoadFirmware", name: savedFirmware.name, bytes: transferBytes },
            [transferBytes],
          );
          setNotice("CPU 快照不兼容，已保留固件并从复位状态启动");
        }
      } catch {
        setRestoring(false);
        setNotice("本地工作区不可用，请重新选择固件");
      }
    })();

    return () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = undefined;
    };
  }, [handleWorkerEvent, postCommand]);

  useEffect(() => {
    const saveOnHide = () => {
      const snapshot = snapshotRef.current;
      if (snapshot) void persistSnapshot(snapshot);
    };
    window.addEventListener("pagehide", saveOnHide);
    return () => window.removeEventListener("pagehide", saveOnHide);
  }, [persistSnapshot]);

  const updateSettings = (next: WorkspaceSettings): void => {
    settingsRef.current = next;
    setSettingsState(next);
    const snapshot = snapshotRef.current;
    if (snapshot) void persistSnapshot(snapshot);
  };

  const loadFile = async (file: File): Promise<void> => {
    setError(undefined);
    if (file.size > 0x10000) {
      setError(`固件为 ${file.size.toLocaleString()} 字节，超过 64 KiB 上限`);
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      const nextFirmware: FirmwareState = {
        name: file.name,
        bytes: copyBuffer(bytes),
        sha256: await sha256Hex(bytes),
        loadedAt: Date.now(),
      };
      firmwareRef.current = nextFirmware;
      setFirmware(nextFirmware);
      setCpuState(undefined);
      setTrace([]);
      setRunning(false);
      setRestoring(true);
      setNotice("正在本地加载固件…");
      const transferBytes = copyBuffer(bytes);
      postCommand(
        { type: "LoadFirmware", name: file.name, bytes: transferBytes },
        [transferBytes],
      );
      const persisted = await requestPersistentStorage();
      if (persisted === false) {
        setNotice("固件已保存在浏览器，但浏览器未授予永久存储权限");
      }
    } catch (caught) {
      setRestoring(false);
      setError(caught instanceof Error ? caught.message : "无法读取固件");
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) void loadFile(file);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  };

  const run = (): void => {
    setError(undefined);
    setRunning(true);
    postCommand({
      type: "Run",
      maxSteps: settings.maxSteps,
      trace: settings.traceEnabled,
    });
  };

  const pause = (): void => {
    postCommand({ type: "Pause" });
  };

  const step = (): void => {
    setError(undefined);
    postCommand({ type: "Step", trace: settings.traceEnabled });
  };

  const reset = (): void => {
    setError(undefined);
    setTrace([]);
    postCommand({ type: "Reset" });
  };

  const clearLocal = async (): Promise<void> => {
    await clearWorkspace();
    window.location.reload();
  };

  const chooseMemorySpace = (space: MemorySpace): void => {
    const nextAddress = space === "sfr" ? 0x80 : 0;
    memoryAddressRef.current = nextAddress;
    setMemoryAddress(nextAddress);
    updateSettings({ ...settingsRef.current, selectedMemorySpace: space });
    setTimeout(requestMemory, 0);
  };

  const updateMemoryAddress = (value: string): void => {
    const parsed = Number.parseInt(value.replace(/^0x/i, ""), 16);
    const next = Number.isFinite(parsed) ? Math.max(0, Math.min(0xffff, parsed)) : 0;
    memoryAddressRef.current = next;
    setMemoryAddress(next);
  };

  const registerCards = useMemo(
    () =>
      cpuState
        ? [
            ["PC", hex16(cpuState.pc)],
            ["ACC", hex8(cpuState.acc)],
            ["B", hex8(cpuState.b)],
            ["PSW", hex8(cpuState.psw)],
            ["SP", hex8(cpuState.sp)],
            ["DPTR", hex16(cpuState.dptr)],
          ]
        : [],
    [cpuState],
  );

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">CLASSIC 8051 · BROWSER LAB</p>
          <h1>EmuC51</h1>
          <p className="hero-copy">
            固件在你的浏览器里运行。没有账号、没有上传、没有服务端文件存储。
          </p>
        </div>
        <div className="privacy-chip" title="生产环境由 CSP 禁止网络连接">
          <span className="privacy-dot" />
          本地执行
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="sidebar">
          <label
            className={`drop-zone ${dragging ? "is-dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              data-testid="firmware-input"
              type="file"
              accept=".bin,application/octet-stream"
              onChange={onFileChange}
            />
            <span className="drop-icon">⌁</span>
            <strong>{firmware ? "更换固件" : "打开本地固件"}</strong>
            <small>拖放或选择不超过 64 KiB 的 .bin 文件</small>
          </label>

          {firmware && (
            <div className="firmware-card">
              <span className="section-label">当前固件</span>
              <strong title={firmware.name}>{firmware.name}</strong>
              <dl>
                <div><dt>大小</dt><dd>{firmware.bytes.byteLength.toLocaleString()} B</dd></div>
                <div><dt>SHA-256</dt><dd title={firmware.sha256}>{firmware.sha256.slice(0, 12)}…</dd></div>
              </dl>
            </div>
          )}

          <div className="privacy-card">
            <span className="section-label">隐私边界</span>
            <p>固件、CPU 状态和内存只保存在此浏览器的 IndexedDB 中。</p>
            <button className="text-button danger" onClick={() => void clearLocal()}>
              清除本地工作区
            </button>
          </div>
        </aside>

        <div className="main-panel">
          <section className="control-panel panel">
            <div className="control-row">
              <button
                className="primary-button"
                disabled={!firmware || restoring || running}
                onClick={run}
              >
                ▶ 运行
              </button>
              <button disabled={!running} onClick={pause}>Ⅱ 暂停</button>
              <button disabled={!firmware || restoring || running} onClick={step}>单步</button>
              <button disabled={!firmware || restoring || running} onClick={reset}>复位</button>
              <label className="steps-field">
                <span>最大步数</span>
                <input
                  aria-label="最大步数"
                  type="number"
                  min="0"
                  max="100000000"
                  value={settings.maxSteps}
                  onChange={(event) =>
                    updateSettings({
                      ...settingsRef.current,
                      maxSteps: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                    })
                  }
                />
              </label>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={settings.traceEnabled}
                  onChange={(event) =>
                    updateSettings({ ...settingsRef.current, traceEnabled: event.target.checked })
                  }
                />
                跟踪
              </label>
            </div>
            <div className={`status-line ${error ? "has-error" : ""}`}>
              <span className={`status-led ${running ? "running" : ""}`} />
              {error ?? (restoring ? "正在准备工作区…" : notice)}
            </div>
          </section>

          <section className="register-panel panel">
            <div className="panel-heading">
              <div><span className="section-label">CPU STATE</span><h2>寄存器</h2></div>
              {cpuState && (
                <div className="counter-strip">
                  <span>{cpuState.steps.toLocaleString()} 步</span>
                  <span>{cpuState.machineCycles.toLocaleString()} 机器周期</span>
                </div>
              )}
            </div>
            {cpuState ? (
              <>
                <div className="register-grid">
                  {registerCards.map(([label, value]) => (
                    <div
                      className="register-card"
                      data-testid={`register-${label}`}
                      key={label}
                    >
                      <span>{label}</span><strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="bank-row">
                  {cpuState.registers.map((value, index) => (
                    <span key={index}>R{index}<strong>{hex8(value)}</strong></span>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">选择固件后，这里会显示 CPU 状态。</div>
            )}
          </section>

          <div className="lower-grid">
            <section className="memory-panel panel">
              <div className="panel-heading compact">
                <div><span className="section-label">MEMORY</span><h2>内存查看</h2></div>
                <div className="memory-tools">
                  <input
                    aria-label="内存起始地址"
                    value={hex16(memoryAddress)}
                    onChange={(event) => updateMemoryAddress(event.target.value)}
                  />
                  <button onClick={requestMemory} disabled={!firmware}>刷新</button>
                </div>
              </div>
              <div className="tab-row">
                {(Object.keys(MEMORY_LABELS) as MemorySpace[]).map((space) => (
                  <button
                    key={space}
                    className={settings.selectedMemorySpace === space ? "active" : ""}
                    onClick={() => chooseMemorySpace(space)}
                  >
                    {MEMORY_LABELS[space]}
                  </button>
                ))}
              </div>
              <MemoryDump start={memoryAddress} bytes={memoryBytes} />
            </section>

            <section className="trace-panel panel">
              <div className="panel-heading compact">
                <div><span className="section-label">TRACE</span><h2>指令跟踪</h2></div>
                <button onClick={() => setTrace([])}>清空</button>
              </div>
              <div className="trace-list" data-testid="trace-list">
                {trace.length === 0 ? (
                  <div className="empty-state small">尚无跟踪记录</div>
                ) : (
                  [...trace].reverse().map((item, index) => (
                    <div className="trace-row" key={`${item.state.steps}-${index}`}>
                      <code>{hex16(item.pcBefore)}</code>
                      <code className="trace-bytes">
                        {item.bytes.slice(0, item.length).map(hex8).join(" ")}
                      </code>
                      <span>{item.mnemonic}</span>
                      <small>A={hex8(item.state.acc)} PSW={hex8(item.state.psw)}</small>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </section>

      <footer>
        <span>浏览器清理站点数据后，本地工作区将无法恢复。</span>
        <span>Cloudflare 仅提供静态应用文件，不接收你的固件。</span>
      </footer>
    </main>
  );
}

function MemoryDump({
  start,
  bytes,
}: {
  start: number;
  bytes: Uint8Array<ArrayBufferLike>;
}) {
  const rows = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = bytes.slice(offset, offset + 16);
    rows.push(
      <div className="memory-row" key={offset}>
        <code className="memory-address">{hex16(start + offset)}</code>
        <code>{Array.from(row, hex8).join(" ")}</code>
      </div>,
    );
  }
  return (
    <div className="memory-dump">
      {rows.length > 0 ? rows : <div className="empty-state small">加载固件后可查看内存</div>}
    </div>
  );
}
