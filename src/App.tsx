import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { hex16, hex8 } from "./core/numbers";
import { MAX_HEX_FILE_SIZE, parseFirmware } from "./core/firmware";
import { disassemble } from "./core/disassembler";
import { normalizeDebugConfig } from "./core/debugger";
import { ByteEditor, DebuggerPanel, RegisterEditor, type DebugSettings, type WritableSpace } from "./components/DebuggerPanel";
import { GpioControls, SerialControls, TimerStatus } from "./components/PeripheralControls";
import { exportWorkspace, importWorkspace, MAX_WORKSPACE_IMPORT_BYTES } from "./persistence/transfer";
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

type AppView = "home" | "editor" | "memory" | "io";

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
  debugger: { breakpoints: [], watchpoints: [] },
};

const MEMORY_LABELS: Record<MemorySpace, string> = {
  code: "CODE",
  iram: "IRAM",
  sfr: "SFR",
  xram: "XRAM",
};

const NAV_ITEMS: Array<{ view: AppView; label: string; short: string }> = [
  { view: "home", label: "HOME", short: "HOME" },
  { view: "editor", label: "BIN_INSPECTOR", short: "CODE" },
  { view: "memory", label: "SYS_MEM", short: "MEM" },
  { view: "io", label: "I/O_PORTS", short: "I/O" },
];

const PORT_ADDRESSES = [0x80, 0x90, 0xa0, 0xb0] as const;

const copyBuffer = (buffer: ArrayBuffer): ArrayBuffer => buffer.slice(0);

const viewFromHash = (): AppView => {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return NAV_ITEMS.some((item) => item.view === hash) ? (hash as AppView) : "home";
};

const formatFault = (
  event: Extract<EmulatorEvent, { type: "ExecutionFault" }>,
): string => {
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
  const exportRequestRef = useRef<number | undefined>(undefined);
  const firmwareRequestRef = useRef(0);
  const fileActionRef = useRef(0);
  const clearingRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const [activeView, setActiveView] = useState<AppView>(viewFromHash);
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
  const [sfrBytes, setSfrBytes] = useState<Uint8Array<ArrayBufferLike>>(
    new Uint8Array(128),
  );
  const [iramBytes, setIramBytes] = useState<Uint8Array<ArrayBufferLike>>(
    new Uint8Array(128),
  );
  const [portHistory, setPortHistory] = useState<number[][]>([]);
  const [serialOutput, setSerialOutput] = useState<number[]>([]);

  const postCommand = useCallback(
    (command: CommandWithoutId, transfer: Transferable[] = []): number => {
      const requestId = ++requestIdRef.current;
      workerRef.current?.postMessage(
        { ...command, requestId } satisfies EmulatorCommand,
        transfer,
      );
      return requestId;
    },
    [],
  );

  const captureSnapshot = useCallback((snapshot: CpuSnapshot): void => {
    snapshotRef.current = snapshot;
    const nextSfr = snapshot.sfr.slice();
    setSfrBytes(nextSfr);
    setIramBytes(snapshot.iram.slice());
    const ports = PORT_ADDRESSES.map((address, index) => (nextSfr[address - 0x80] ?? 0xff) & (snapshot.coreStateVersion === 2 ? snapshot.peripherals.portInputs[index] ?? 0xff : 0xff));
    setPortHistory((current) => [...current, ports].slice(-64));
    if (snapshot.coreStateVersion === 2) setSerialOutput(snapshot.peripherals.serial.txOutput.slice(-4096));
  }, []);

  const workspaceRecord = useCallback((snapshot: CpuSnapshot): WorkspaceRecord | undefined => {
    const currentFirmware = firmwareRef.current;
    if (!currentFirmware) return undefined;
    return {
      schemaVersion: 2,
      coreStateVersion: snapshot.coreStateVersion,
      firmware: { ...currentFirmware, bytes: copyBuffer(currentFirmware.bytes) },
      cpu: snapshot,
      settings: settingsRef.current,
      updatedAt: Date.now(),
    };
  }, []);

  const persistSnapshot = useCallback(
    async (snapshot: CpuSnapshot): Promise<void> => {
      if (clearingRef.current) return;
      captureSnapshot(snapshot);
      const record = workspaceRecord(snapshot);
      if (!record) return;
      try {
        const write = saveQueueRef.current.catch(() => undefined).then(() => saveWorkspace(record));
        saveQueueRef.current = write;
        await write;
        setNotice("工作区已保存在此浏览器");
      } catch {
        setNotice("无法写入浏览器存储；本次会话仍可继续");
      }
    },
    [captureSnapshot, workspaceRecord],
  );

  const requestMemory = useCallback(() => {
    if (!firmwareRef.current) return;
    const space = settingsRef.current.selectedMemorySpace;
    const minimum = space === "sfr" ? 0x80 : 0;
    const maximum = space === "iram" ? 0x7f : space === "sfr" ? 0xff : 0xffff;
    const address = Math.max(minimum, Math.min(maximum, memoryAddressRef.current));
    memoryAddressRef.current = address;
    setMemoryAddress(address);
    postCommand({
      type: "ReadMemory",
      space,
      address,
      length: Math.min(256, maximum - address + 1),
    });
  }, [postCommand]);

  const navigate = useCallback(
    (view: AppView): void => {
      setActiveView(view);
      const nextHash = view === "home" ? "" : `#${view}`;
      window.history.replaceState(null, "", `${window.location.pathname}${nextHash}`);
      if (view === "memory") setTimeout(requestMemory, 0);
    },
    [requestMemory],
  );

  const handleWorkerEvent = useCallback(
    (event: EmulatorEvent): void => {
      if (event.requestId < firmwareRequestRef.current) return;
      switch (event.type) {
        case "Ready":
          setCpuState(event.state);
          setRunning(false);
          setRestoring(false);
          setError(undefined);
          postCommand({ type: "SetDebugConfig", ...(settingsRef.current.debugger ?? { breakpoints: [], watchpoints: [] }) });
          void persistSnapshot(event.snapshot);
          setTimeout(requestMemory, 0);
          break;
        case "StateChanged":
          setCpuState(event.state);
          setRunning(event.running);
          setSerialOutput(event.state.peripherals.serial.txOutput.slice(-4096));
          break;
        case "DebugConfigChanged":
          break;
        case "SerialOutput":
          // StateChanged supplies the bounded, persisted TX history.
          break;
        case "TraceBatch":
          setTrace((current) => [...current, ...event.trace].slice(-1000));
          break;
        case "MemoryData":
          if (event.space === settingsRef.current.selectedMemorySpace && event.address === memoryAddressRef.current) setMemoryBytes(event.bytes);
          break;
        case "SnapshotCreated":
          void persistSnapshot(event.snapshot);
          if (exportRequestRef.current === event.requestId) {
            exportRequestRef.current = undefined;
            const record = workspaceRecord(event.snapshot);
            if (record) {
              try {
                const blob = new Blob([exportWorkspace(record)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `${record.firmware.name.replace(/\.[^.]+$/, "")}.emuc51.json`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                setNotice("工作区已导出；固件、CPU 和调试设置均已包含");
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "无法导出工作区");
              }
            }
          }
          break;
        case "Stopped":
          setCpuState(event.state);
          setRunning(false);
          void persistSnapshot(event.snapshot).then(() => {
            setNotice(event.reason === "StepLimitReached" ? "已达到本次运行步数上限"
              : event.reason === "Breakpoint" ? `断点暂停 · PC=${hex16(event.state.pc)}`
              : event.reason === "Watchpoint" ? `监视点暂停 · ${event.watchpoint?.space.toUpperCase()} ${hex16(event.watchpoint?.address ?? 0)}`
              : event.reason === "RunToAddress" ? `已运行至地址 ${hex16(event.state.pc)}`
              : event.reason === "PowerDown" ? "CPU 已进入掉电模式；复位后继续执行"
              : event.reason === "StepComplete" ? "工作区已保存在此浏览器" : "执行已暂停");
          });
          setTimeout(requestMemory, 0);
          break;
        case "ExecutionFault":
          setRunning(false);
          setError(formatFault(event));
          if (event.state) setCpuState(event.state);
          if (event.snapshot) void persistSnapshot(event.snapshot);
          setTimeout(requestMemory, 0);
          break;
        case "CommandRejected":
          setError(formatFault({ ...event, type: "ExecutionFault" }));
          break;
      }
    },
    [persistSnapshot, requestMemory, postCommand, workspaceRecord],
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
        if (firmwareRequestRef.current !== 0) return;
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
          firmwareRequestRef.current = postCommand(
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
          firmwareRequestRef.current = postCommand(
            { type: "LoadFirmware", name: savedFirmware.name, bytes: transferBytes },
            [transferBytes],
          );
          setNotice("CPU 快照不兼容，已保留固件并从复位状态启动");
        }
      } catch {
        if (firmwareRequestRef.current !== 0) return;
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
    const syncView = () => setActiveView(viewFromHash());
    window.addEventListener("hashchange", syncView);
    return () => window.removeEventListener("hashchange", syncView);
  }, []);

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
    const action = ++fileActionRef.current;
    setError(undefined);
    if (file.size > MAX_HEX_FILE_SIZE) {
      setError("固件源文件超过 1 MiB 上限；CODE 空间上限为 64 KiB");
      return;
    }
    try {
      const source = new Uint8Array(await file.arrayBuffer());
      const bytes = new Uint8Array(parseFirmware(source, file.name)).buffer;
      const nextFirmware: FirmwareState = {
        name: file.name,
        bytes: copyBuffer(bytes),
        sha256: await sha256Hex(bytes),
        loadedAt: Date.now(),
      };
      if (action !== fileActionRef.current) return;
      firmwareRef.current = nextFirmware;
      snapshotRef.current = undefined;
      setFirmware(nextFirmware);
      setCpuState(undefined);
      setTrace([]);
      setPortHistory([]);
      setSerialOutput([]);
      setRunning(false);
      setRestoring(true);
      setNotice("正在本地加载固件…");
      navigate("editor");
      const transferBytes = copyBuffer(bytes);
      firmwareRequestRef.current = postCommand(
        { type: "LoadFirmware", name: file.name, bytes: transferBytes },
        [transferBytes],
      );
      const persisted = await requestPersistentStorage();
      if (action === fileActionRef.current && persisted === false) {
        setNotice("固件已保存在浏览器，但浏览器未授予永久存储权限");
      }
    } catch (caught) {
      if (action !== fileActionRef.current) return;
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
    setPortHistory([]);
    setSerialOutput([]);
    postCommand({ type: "Reset" });
  };

  const updateDebugConfig = (config: DebugSettings): void => {
    try {
      const validated = normalizeDebugConfig(config);
      updateSettings({ ...settingsRef.current, debugger: validated });
      postCommand({ type: "SetDebugConfig", ...validated });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无效调试设置");
    }
  };

  const runToAddress = (address: number): void => {
    setError(undefined);
    setRunning(true);
    postCommand({ type: "RunToAddress", address, maxSteps: settings.maxSteps, trace: settings.traceEnabled });
  };

  const stepOver = (): void => {
    setError(undefined);
    setRunning(true);
    postCommand({ type: "StepOver", maxSteps: settings.maxSteps, trace: settings.traceEnabled });
  };

  const writeMemory = (space: WritableSpace, address: number, value: number): void => {
    setError(undefined);
    postCommand({ type: "WriteMemory", space, address, value });
    requestMemory();
  };

  const writeRegister = (name: string, value: number): void => {
    setError(undefined);
    postCommand({ type: "SetRegister", name, value });
  };

  const importFile = async (file: File): Promise<void> => {
    const action = ++fileActionRef.current;
    setError(undefined);
    try {
      if (file.size > MAX_WORKSPACE_IMPORT_BYTES) throw new Error("工作区文件超过 1 MiB 上限");
      const record = await importWorkspace(await file.text());
      if (action !== fileActionRef.current) return;
      // Validation finishes before changing the active CPU or persisted record.
      const nextFirmware = { ...record.firmware, bytes: copyBuffer(record.firmware.bytes) };
      firmwareRef.current = nextFirmware;
      snapshotRef.current = undefined;
      settingsRef.current = record.settings;
      setFirmware(nextFirmware);
      setSettingsState(record.settings);
      setTrace([]);
      setPortHistory([]);
      setRestoring(true);
      setRunning(false);
      navigate("editor");
      const transferBytes = copyBuffer(record.firmware.bytes);
      firmwareRequestRef.current = postCommand({ type: "RestoreWorkspace", name: record.firmware.name, bytes: transferBytes, snapshot: record.cpu }, [transferBytes]);
    } catch (caught) {
      if (action !== fileActionRef.current) return;
      setError(caught instanceof Error ? caught.message : "无法导入工作区");
    }
  };

  const onWorkspaceChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) void importFile(file);
    event.target.value = "";
  };

  const downloadWorkspace = (): void => {
    exportRequestRef.current = postCommand({ type: "CreateSnapshot" });
  };

  const clearLocal = async (): Promise<void> => {
    clearingRef.current = true;
    fileActionRef.current += 1;
    firmwareRequestRef.current = Number.MAX_SAFE_INTEGER;
    firmwareRef.current = undefined;
    snapshotRef.current = undefined;
    workerRef.current?.terminate();
    await saveQueueRef.current.catch(() => undefined);
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
    const next = Number.isFinite(parsed)
      ? Math.max(0, Math.min(0xffff, parsed))
      : 0;
    memoryAddressRef.current = next;
    setMemoryAddress(next);
  };

  const portValues = useMemo(
    () => PORT_ADDRESSES.map((address, index) => cpuState?.peripherals.ports[index]?.pins ?? sfrBytes[address - 0x80] ?? 0xff),
    [sfrBytes, cpuState],
  );

  const controls = {
    run,
    pause,
    step,
    reset,
    stepOver,
  };

  const statusText = error ?? (restoring ? "正在准备工作区…" : notice);

  return (
    <div className="terminal-app">
      <div className="scanline-overlay" aria-hidden="true" />
      <AppHeader activeView={activeView} navigate={navigate} running={running} />

      <div className={`page-frame ${activeView === "home" ? "is-home" : "is-console"}`}>
        {activeView !== "home" && (
          <SystemRail
            activeView={activeView}
            cpuState={cpuState}
            dragging={dragging}
            firmware={firmware}
            navigate={navigate}
            onDrop={onDrop}
            onFileChange={onFileChange}
            setDragging={setDragging}
          />
        )}

        <main className="view-stage" data-view={activeView}>
          {activeView === "home" && (
            <HomeView
              cpuState={cpuState}
              firmware={firmware}
              navigate={navigate}
              onFileChange={onFileChange}
              statusText={statusText}
            />
          )}
          {activeView === "editor" && (
            <WorkbenchView
              controls={controls}
              cpuState={cpuState}
              error={error}
              firmware={firmware}
              memoryBytes={memoryBytes}
              notice={statusText}
              portValues={portValues}
              restoring={restoring}
              running={running}
              settings={settings}
              trace={trace}
              updateSettings={updateSettings}
              updateDebugConfig={updateDebugConfig}
              runToAddress={runToAddress}
              writeRegister={writeRegister}
              downloadWorkspace={downloadWorkspace}
              onWorkspaceChange={onWorkspaceChange}
              onFileChange={onFileChange}
              clearLocal={clearLocal}
            />
          )}
          {activeView === "memory" && (
            <MemoryView
              cpuState={cpuState}
              firmware={firmware}
              iramBytes={iramBytes}
              memoryAddress={memoryAddress}
              memoryBytes={memoryBytes}
              requestMemory={requestMemory}
              settings={settings}
              chooseMemorySpace={chooseMemorySpace}
              updateMemoryAddress={updateMemoryAddress}
              running={running}
              restoring={restoring}
              writeMemory={writeMemory}
            />
          )}
          {activeView === "io" && (
            <IoView
              firmware={firmware}
              portHistory={portHistory}
              portValues={portValues}
              cpuState={cpuState}
              sfrBytes={sfrBytes}
              serialOutput={serialOutput}
              restoring={restoring}
              onPortInput={(port, value) => postCommand({ type: "SetPortInput", port, value })}
              onReceive={(bytes, ninthBit) => { for (const value of bytes) postCommand({ type: "ReceiveSerial", value, ninthBit }); }}
            />
          )}
        </main>
      </div>

      <AppFooter statusText={statusText} />
      {error && <div className="error-banner" role="alert">{error}<button aria-label="关闭错误" onClick={() => setError(undefined)}>×</button></div>}
      <MobileNav activeView={activeView} navigate={navigate} />

      {activeView !== "home" && (
        <button
          className="clear-workspace"
          onClick={() => void clearLocal()}
          disabled={!firmware}
          title="删除此浏览器中的固件和 CPU 快照"
        >
          &gt; CLEAR_LOCAL
        </button>
      )}
    </div>
  );
}

function AppHeader({
  activeView,
  navigate,
  running,
}: {
  activeView: AppView;
  navigate: (view: AppView) => void;
  running: boolean;
}) {
  return (
    <header className="top-bar">
      <button className="brand-mark" onClick={() => navigate("home")}>
        MCS-51_EMU_V1.0
      </button>
      <nav className="desktop-nav" aria-label="主导航">
        {NAV_ITEMS.filter((item) => item.view !== "home").map((item) => (
          <button
            className={activeView === item.view ? "active" : ""}
            key={item.view}
            onClick={() => navigate(item.view)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="system-icons" aria-label="系统状态">
        <span title="浏览器 Worker">⌁</span>
        <span title="本地存储">▣</span>
        <span className={running ? "is-live" : ""} title={running ? "正在运行" : "已暂停"}>
          ϟ
        </span>
      </div>
    </header>
  );
}

function SystemRail({
  activeView,
  cpuState,
  dragging,
  firmware,
  navigate,
  onDrop,
  onFileChange,
  setDragging,
}: {
  activeView: AppView;
  cpuState?: CpuViewState;
  dragging: boolean;
  firmware?: FirmwareState;
  navigate: (view: AppView) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  setDragging: (value: boolean) => void;
}) {
  return (
    <aside className="system-rail">
      <div className="cpu-ident">
        <span>SYSTEM OPERATOR</span>
        <strong>CPU_8051</strong>
        <small>STATUS: {cpuState ? "ONLINE" : "STANDBY"}</small>
      </div>

      <label
        className={`flash-button ${dragging ? "is-dragging" : ""}`}
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
          accept=".bin,.hex,.ihx,application/octet-stream,text/plain"
          onChange={onFileChange}
        />
        &gt; {firmware ? "REPLACE_ROM" : "FLASH_ROM"}
      </label>

      <nav className="rail-nav" aria-label="工作台导航">
        {NAV_ITEMS.filter((item) => item.view !== "home").map((item) => (
          <button
            className={activeView === item.view ? "active" : ""}
            key={item.view}
            onClick={() => navigate(item.view)}
          >
            <span>{item.view === "editor" ? "⌑" : item.view === "memory" ? "◫" : "◇"}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="rail-log">
        <span>▰ LOGS</span>
        <small>LOCAL_ONLY</small>
      </div>
    </aside>
  );
}

function HomeView({
  cpuState,
  firmware,
  navigate,
  onFileChange,
  statusText,
}: {
  cpuState?: CpuViewState;
  firmware?: FirmwareState;
  navigate: (view: AppView) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  statusText: string;
}) {
  const usage = firmware ? Math.round((firmware.bytes.byteLength / 0x10000) * 100) : 0;
  return (
    <div className="home-view">
      <section className="hero-terminal">
        <pre className="code-watermark" aria-hidden="true">
{`ORG 0000H
LJMP START
MOV SP, #60H
SETB EA
MAIN_LOOP:
  SJMP MAIN_LOOP
RET`}
        </pre>
        <div className="hero-copy">
          <span className="status-chip">STATUS: ONLINE // LOCAL RUNTIME</span>
          <h1>MCS-51 Next-Gen Emulation</h1>
          <p>
            在浏览器 Worker 中运行经典 8051 BIN / Intel HEX 固件。无需账号、无需上传，
            CPU、内存与调试状态全部留在当前设备。
          </p>
          <div className="hero-actions">
            <button className="primary-command" onClick={() => navigate("editor")}>
              &gt; INIT_ENV
            </button>
            <label className="secondary-command">
              <input
                data-testid="firmware-input"
                type="file"
                accept=".bin,.hex,.ihx,application/octet-stream,text/plain"
                onChange={onFileChange}
              />
              {firmware ? "REPLACE_ROM" : "LOAD_FIRMWARE"}
            </label>
          </div>
          <small className="hero-status">// {statusText}</small>
        </div>
        <div className="chip-visual" aria-label="8051 芯片示意图">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="chip-body">
            <span>MCS-51</span>
            <strong>8051</strong>
            <small>8-BIT MCU</small>
          </div>
        </div>
      </section>

      <section className="feature-section" id="features">
        <h2><span>◫</span> SYS_FEATURES</h2>
        <div className="feature-grid">
          <article className="feature-card wide accent-green">
            <span className="feature-icon">ϟ</span>
            <h3>&gt; Browser Worker Core</h3>
            <p>支持地址断点、写入监视点、单步、步过、定时器、中断、串口与 GPIO。</p>
            <div className="meter"><span style={{ width: `${Math.max(4, usage)}%` }} /></div>
          </article>
          <article className="feature-card accent-blue">
            <span className="feature-icon">▣</span>
            <h3>&gt; Local Workspace</h3>
            <p>固件、CPU 快照和调试设置保存在 IndexedDB，也可导入导出为 JSON 工作区。</p>
          </article>
          <article className="feature-card accent-amber">
            <span className="feature-icon">⌁</span>
            <h3>&gt; Zero Upload</h3>
            <p>BIN 最大 64 KiB；HEX 源文件最大 1 MiB。固件本地读取，生产 CSP 禁止应用联网。</p>
          </article>
          <article className="feature-card metrics wide">
            <div className="metric-heading">
              <span>RUNTIME METRICS</span>
              <strong>{cpuState ? "CORE READY" : "AWAITING ROM"}</strong>
            </div>
            <div className="metric-grid">
              <span>ROM_USAGE<strong>{firmware ? `${firmware.bytes.byteLength} / 65536 B` : "—"}</strong></span>
              <span>INSTRUCTIONS<strong>{cpuState?.steps.toLocaleString() ?? "0"}</strong></span>
              <span>M_CYCLES<strong>{cpuState?.machineCycles.toLocaleString() ?? "0"}</strong></span>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

interface ControlActions {
  run: () => void;
  pause: () => void;
  step: () => void;
  reset: () => void;
  stepOver: () => void;
}

function WorkbenchView({
  controls,
  cpuState,
  error,
  firmware,
  notice,
  portValues,
  restoring,
  running,
  settings,
  trace,
  updateSettings,
  updateDebugConfig,
  runToAddress,
  writeRegister,
  downloadWorkspace,
  onWorkspaceChange,
  onFileChange,
  clearLocal,
}: {
  controls: ControlActions;
  cpuState?: CpuViewState;
  error?: string;
  firmware?: FirmwareState;
  memoryBytes: Uint8Array<ArrayBufferLike>;
  notice: string;
  portValues: number[];
  restoring: boolean;
  running: boolean;
  settings: WorkspaceSettings;
  trace: StepResult[];
  updateSettings: (settings: WorkspaceSettings) => void;
  updateDebugConfig: (config: DebugSettings) => void;
  runToAddress: (address: number) => void;
  writeRegister: (name: string, value: number) => void;
  downloadWorkspace: () => void;
  onWorkspaceChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  clearLocal: () => Promise<void>;
}) {
  const registerCards: Array<[string, string]> = cpuState
    ? [
        ["PC", hex16(cpuState.pc)],
        ["DPTR", hex16(cpuState.dptr)],
        ["A (ACC)", hex8(cpuState.acc)],
        ["B", hex8(cpuState.b)],
        ["SP", hex8(cpuState.sp)],
        ["PSW", hex8(cpuState.psw)],
      ]
    : [];

  return (
    <div className="workbench-grid">
      <TerminalPanel className="project-files" title="PROJECT_FILES" bits={["FS", "RO"]}>
        <div className="tree-root">⌄ SRC</div>
        {firmware ? (
          <div className="tree-file active" data-testid="firmware-name">
            ▣ <span title={firmware.name}>{firmware.name}</span>
          </div>
        ) : (
          <div className="tree-file muted">— NO ROM —</div>
        )}
        <div className="tree-file muted">▧ trace.log</div>
        <div className="file-meta">
          <span>SHA</span>
          <code>{firmware ? `${firmware.sha256.slice(0, 10)}…` : "—"}</code>
          <span>SIZE</span>
          <code>{firmware ? `${firmware.bytes.byteLength} B` : "0 B"}</code>
        </div>
        <div className="workspace-actions">
          <label className="secondary-command">
            <input data-testid="workbench-firmware-input" aria-label="加载固件" type="file" accept=".bin,.hex,.ihx" onChange={onFileChange} />
            {firmware ? "替换固件" : "加载 BIN / HEX"}
          </label>
          <button disabled={!firmware || restoring} onClick={downloadWorkspace}>导出工作区</button>
          <label className={`secondary-command ${restoring ? "is-disabled" : ""}`}>
            <input data-testid="workspace-input" aria-label="导入工作区" type="file" accept=".json,application/json" onChange={onWorkspaceChange} disabled={restoring} />
            导入工作区
          </label>
          <small>JSON 含固件、CPU、外设和调试设置</small>
          <button className="clear-inline" disabled={!firmware} onClick={() => void clearLocal()}>CLEAR_LOCAL</button>
        </div>
      </TerminalPanel>

      <TerminalPanel className="source-view" title="BIN_INSPECTOR" bits={["READ", running ? "LIVE" : "IDLE"]} active={running}>
        <ControlStrip
          controls={controls}
          firmware={firmware}
          restoring={restoring}
          running={running}
        />
        <div className="source-scroll">
          <TraceSource firmware={firmware} pc={cpuState?.pc ?? 0} breakpoints={settings.debugger?.breakpoints ?? []} />
        </div>
      </TerminalPanel>

      <TerminalPanel className="cpu-monitor" title="CPU_MONITOR" bits={[running ? "RUN" : "PAUSE"]} active={running}>
        {cpuState ? (
          <>
            <div className="monitor-registers">
              {registerCards.map(([label, value]) => (
                <div className="monitor-row" data-testid={`register-${label.split(" ")[0]}`} key={label}>
                  <span>{label}</span><strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="register-bank">
              {cpuState.registers.map((value, index) => (
                <span key={index}>R{index}<strong>{hex8(value)}</strong></span>
              ))}
            </div>
            <RegisterEditor disabled={!firmware || restoring || running} onWrite={writeRegister} />
          </>
        ) : (
          <EmptyState>FLASH_ROM TO INITIALIZE CPU</EmptyState>
        )}
      </TerminalPanel>

      <TerminalPanel className="debugger-config" title="DEBUGGER" bits={[`${settings.debugger?.breakpoints.length ?? 0} BP`, `${settings.debugger?.watchpoints.length ?? 0} WP`]}>
        <DebuggerPanel config={settings.debugger ?? { breakpoints: [], watchpoints: [] }} disabled={!firmware || restoring || running} onChange={updateDebugConfig} onRunTo={runToAddress} />
      </TerminalPanel>

      <TerminalPanel className="compiler-output" title="RUNTIME_OUTPUT" bits={[error ? "FAULT" : "OK"]}>
        <div className={`runtime-log ${error ? "has-error" : ""}`}>
          <p>&gt; EmuC51 local runtime</p>
          <p>&gt; {notice}</p>
          <p>&gt; trace buffer: {trace.length}/1000</p>
          <p>&gt; network transport: BLOCKED_BY_CSP</p>
          {trace.slice(-12).map((item, index) => <p className="trace-entry" key={`${item.state.steps}-${index}`}>{hex16(item.pcBefore)} · {item.mnemonic} · {item.machineCycles} MC</p>)}
          <span className="terminal-cursor" aria-hidden="true" />
        </div>
      </TerminalPanel>

      <TerminalPanel className="port-panel" title="PORT_1" bits={[`0x${hex8(portValues[1] ?? 0xff)}`]}>
        <div className="led-row">
          {Array.from({ length: 8 }, (_, bit) => (
            <span
              className={(portValues[1] ?? 0xff) & (1 << bit) ? "on" : ""}
              key={bit}
              title={`P1.${bit}`}
            />
          ))}
        </div>
        <div className="port-labels">
          {Array.from({ length: 8 }, (_, bit) => <span key={bit}>P1.{bit}</span>)}
        </div>
      </TerminalPanel>

      <TerminalPanel className="runtime-settings" title="EXEC_CONFIG" bits={[settings.traceEnabled ? "TRACE" : "NO_TRACE"]}>
        <label>
          RUN_BUDGET
          <input
            aria-label="最大执行单元"
            type="number"
            min="0"
            max="100000000"
            value={settings.maxSteps}
            onChange={(event) =>
              updateSettings({
                ...settings,
                maxSteps: Math.min(100_000_000, Math.max(0, Math.trunc(Number(event.target.value) || 0))),
              })
            }
          />
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={settings.traceEnabled}
            onChange={(event) =>
              updateSettings({ ...settings, traceEnabled: event.target.checked })
            }
          />
          CAPTURE_TRACE
        </label>
        <small className="panel-help">预算包括指令、中断进入和空闲时钟单元；0 不执行。</small>
      </TerminalPanel>
    </div>
  );
}

function ControlStrip({
  controls,
  firmware,
  restoring,
  running,
}: {
  controls: ControlActions;
  firmware?: FirmwareState;
  restoring: boolean;
  running: boolean;
}) {
  return (
    <div className="control-strip">
      <button
        className="primary-command"
        disabled={!firmware || restoring || running}
        onClick={controls.run}
      >
        &gt; 运行
      </button>
      <button disabled={!running} onClick={controls.pause}>Ⅱ 暂停</button>
      <button disabled={!firmware || restoring || running} onClick={controls.step}>› 单步</button>
      <button disabled={!firmware || restoring || running} onClick={controls.stepOver}>» 步过</button>
      <button disabled={!firmware || restoring || running} onClick={controls.reset}>↺ 复位</button>
    </div>
  );
}

function TraceSource({
  firmware,
  pc,
  breakpoints,
}: {
  firmware?: FirmwareState;
  pc: number;
  breakpoints: number[];
}) {
  if (!firmware) return <EmptyState>NO BINARY IMAGE LOADED</EmptyState>;
  const rows = disassemble(new Uint8Array(firmware.bytes), pc, 80);
  return <div className="source-lines" data-testid="disassembly-list">{rows.map((item) =>
    <div className={item.address === pc ? "current" : ""} data-testid={item.address === pc ? "current-instruction" : undefined} key={item.address}>
      <code>{breakpoints.includes(item.address) ? "●" : " "} {hex16(item.address)}</code>
      <code>{item.bytes.map(hex8).join(" ")}</code>
      <strong>{item.text}</strong>
    </div>)}</div>;
}

function MemoryView({
  chooseMemorySpace,
  cpuState,
  firmware,
  iramBytes,
  memoryAddress,
  memoryBytes,
  requestMemory,
  settings,
  updateMemoryAddress,
  running,
  writeMemory,
  restoring,
}: {
  chooseMemorySpace: (space: MemorySpace) => void;
  cpuState?: CpuViewState;
  firmware?: FirmwareState;
  iramBytes: Uint8Array<ArrayBufferLike>;
  memoryAddress: number;
  memoryBytes: Uint8Array<ArrayBufferLike>;
  requestMemory: () => void;
  settings: WorkspaceSettings;
  updateMemoryAddress: (value: string) => void;
  running: boolean;
  restoring: boolean;
  writeMemory: (space: WritableSpace, address: number, value: number) => void;
}) {
  return (
    <div className="memory-workspace">
      <TerminalPanel className="memory-main" title={`ROM_VIEW [${MEMORY_LABELS[settings.selectedMemorySpace]}]`} bits={[`BASE: ${hex16(memoryAddress)}`]} active={Boolean(firmware)}>
        <div className="memory-toolbar">
          <div className="memory-tabs">
            {(Object.keys(MEMORY_LABELS) as MemorySpace[]).map((space) => (
              <button
                className={settings.selectedMemorySpace === space ? "active" : ""}
                key={space}
                onClick={() => chooseMemorySpace(space)}
              >
                {MEMORY_LABELS[space]}
              </button>
            ))}
          </div>
          <label>
            GOTO:
            <input
              aria-label="内存起始地址"
              value={hex16(memoryAddress)}
              onChange={(event) => updateMemoryAddress(event.target.value)}
            />
          </label>
          <button onClick={requestMemory} disabled={!firmware}>REFRESH</button>
        </div>
        <ByteEditor key={settings.selectedMemorySpace} space={settings.selectedMemorySpace} disabled={!firmware || running || restoring} onWrite={writeMemory} />
        <MemoryDump start={memoryAddress} bytes={memoryBytes} />
      </TerminalPanel>

      <TerminalPanel className="iram-card" title="IRAM_DATA" bits={["128B"]}>
        <div className="mini-memory">
          <span>ADDR</span>{Array.from({ length: 8 }, (_, i) => <span key={i}>{i.toString(16).toUpperCase()}</span>)}
          <strong>00</strong>{Array.from({ length: 8 }, (_, i) => <code key={i}>{hex8(iramBytes[i] ?? 0)}</code>)}
          <strong>08</strong>{Array.from({ length: 8 }, (_, i) => <code key={i}>{hex8(iramBytes[i + 8] ?? 0)}</code>)}
        </div>
      </TerminalPanel>

      <TerminalPanel className="watch-card" title="WATCH" bits={["+"]}>
        <div className="watch-list">
          <span><b>PC</b><code>0x{hex16(cpuState?.pc ?? 0)}</code></span>
          <span><b>SP</b><code>0x{hex8(cpuState?.sp ?? 0)}</code></span>
          <span><b>DPTR</b><code>0x{hex16(cpuState?.dptr ?? 0)}</code></span>
          <span><b>ACC</b><code>0x{hex8(cpuState?.acc ?? 0)}</code></span>
        </div>
      </TerminalPanel>

      <TerminalPanel className="bank-card" title="REGISTER_BANK" bits={[cpuState ? "BANK0" : "OFF"]}>
        <div className="register-bank large">
          {(cpuState?.registers ?? Array(8).fill(0)).map((value, index) => (
            <span key={index}>R{index}<strong>{hex8(value)}</strong></span>
          ))}
        </div>
      </TerminalPanel>
    </div>
  );
}

function IoView({
  firmware,
  portHistory,
  portValues,
  cpuState,
  sfrBytes,
  serialOutput,
  restoring,
  onPortInput,
  onReceive,
}: {
  firmware?: FirmwareState;
  portHistory: number[][];
  portValues: number[];
  cpuState?: CpuViewState;
  sfrBytes: Uint8Array<ArrayBufferLike>;
  serialOutput: number[];
  restoring: boolean;
  onPortInput: (port: number, value: number) => void;
  onReceive: (bytes: number[], ninthBit: boolean) => void;
}) {
  return (
    <div className="io-workspace">
      <div className="io-notice">
        <strong>GPIO_INPUT_OUTPUT</strong>
        <span>数字引脚、定时器、五路中断与 UART；所有外设状态保存在本地工作区。</span>
      </div>

      <TerminalPanel className="display-module gpio-module" title="GPIO_PORTS" bits={[`P0:${hex8(portValues[0] ?? 0xff)}`]}>
        <GpioControls cpuState={cpuState} disabled={!firmware || restoring} onInput={onPortInput} />
      </TerminalPanel>

      <TerminalPanel className="matrix-module serial-module" title="UART_CONSOLE" bits={["RX/TX"]}>
        <SerialControls cpuState={cpuState} disabled={!firmware || restoring} output={serialOutput} onReceive={onReceive} />
      </TerminalPanel>

      <TerminalPanel className="stepper-module timer-module" title="TIMERS_INTERRUPTS" bits={["T0/T1"]}>
        <TimerStatus cpuState={cpuState} sfr={sfrBytes} />
      </TerminalPanel>

      <TerminalPanel className="logic-module" title="LOGIC_ANALYZER" bits={[`${portHistory.length} SAMPLES`]} active={portHistory.length > 1}>
        <LogicAnalyzer history={portHistory} />
      </TerminalPanel>
    </div>
  );
}

function LogicAnalyzer({ history }: { history: number[][] }) {
  const samples = history.length > 1 ? history : [[0xff, 0xff, 0xff, 0xff], [0xff, 0xff, 0xff, 0xff]];
  return (
    <div className="logic-analyzer">
      {[0, 1, 2].map((portIndex) => {
        const points = samples
          .map((sample, index) => {
            const x = (index / Math.max(1, samples.length - 1)) * 100;
            const high = (sample[portIndex] ?? 0) & 1;
            const y = 18 + portIndex * 30 + (high ? 0 : 12);
            return `${x},${y}`;
          })
          .join(" ");
        return (
          <div className="logic-channel" key={portIndex}>
            <span>P{portIndex}.0</span>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polyline className={`channel-${portIndex}`} points={points} />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

function TerminalPanel({
  active = false,
  bits = [],
  children,
  className = "",
  title,
}: {
  active?: boolean;
  bits?: string[];
  children: ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <section className={`terminal-panel ${active ? "is-active" : ""} ${className}`}>
      <header className="panel-bar">
        <h2>{title}</h2>
        <div>{bits.map((bit) => <span key={bit}>{bit}</span>)}</div>
      </header>
      <div className="panel-body">{children}</div>
    </section>
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
        <code className="ascii-column">
          {Array.from(row, (value) => value >= 32 && value <= 126 ? String.fromCharCode(value) : ".").join("")}
        </code>
      </div>,
    );
  }
  return (
    <div className="memory-dump">
      <div className="memory-heading"><span>ADDR</span><span>00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F</span><span>ASCII</span></div>
      {rows.length > 0 ? rows : <EmptyState>FLASH_ROM TO VIEW MEMORY</EmptyState>}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">// {children}</div>;
}

function MobileNav({
  activeView,
  navigate,
}: {
  activeView: AppView;
  navigate: (view: AppView) => void;
}) {
  return (
    <nav className="mobile-nav" aria-label="移动端导航">
      {NAV_ITEMS.map((item) => (
        <button
          className={activeView === item.view ? "active" : ""}
          key={item.view}
          onClick={() => navigate(item.view)}
        >
          {item.short}
        </button>
      ))}
    </nav>
  );
}

function AppFooter({ statusText }: { statusText: string }) {
  return (
    <footer className="status-footer">
      <span>©1981–2026 INTEL_COMPATIBLE_CORE</span>
      <span className="footer-status">{statusText}</span>
      <span>LOCAL_ONLY · CSP_LOCKED</span>
    </footer>
  );
}
