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
};

const MEMORY_LABELS: Record<MemorySpace, string> = {
  code: "CODE",
  iram: "IRAM",
  sfr: "SFR",
  xram: "XRAM",
};

const NAV_ITEMS: Array<{ view: AppView; label: string; short: string }> = [
  { view: "home", label: "HOME", short: "HOME" },
  { view: "editor", label: "ASM_EDITOR", short: "CODE" },
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
    const ports = PORT_ADDRESSES.map((address) => nextSfr[address - 0x80] ?? 0xff);
    setPortHistory((current) => [...current, ports].slice(-64));
  }, []);

  const persistSnapshot = useCallback(
    async (snapshot: CpuSnapshot): Promise<void> => {
      captureSnapshot(snapshot);
      const currentFirmware = firmwareRef.current;
      if (!currentFirmware) return;
      const record: WorkspaceRecord = {
        schemaVersion: 2,
        coreStateVersion: 2,
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
    },
    [captureSnapshot],
  );

  const requestMemory = useCallback(() => {
    if (!firmwareRef.current) return;
    postCommand({
      type: "ReadMemory",
      space: settingsRef.current.selectedMemorySpace,
      address: memoryAddressRef.current,
      length: 256,
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
      setPortHistory([]);
      setRunning(false);
      setRestoring(true);
      setNotice("正在本地加载固件…");
      navigate("editor");
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
    setPortHistory([]);
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
    const next = Number.isFinite(parsed)
      ? Math.max(0, Math.min(0xffff, parsed))
      : 0;
    memoryAddressRef.current = next;
    setMemoryAddress(next);
  };

  const portValues = useMemo(
    () => PORT_ADDRESSES.map((address) => sfrBytes[address - 0x80] ?? 0xff),
    [sfrBytes],
  );

  const controls = {
    run,
    pause,
    step,
    reset,
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
            />
          )}
          {activeView === "io" && (
            <IoView
              firmware={firmware}
              portHistory={portHistory}
              portValues={portValues}
            />
          )}
        </main>
      </div>

      <AppFooter statusText={statusText} />
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
          accept=".bin,application/octet-stream"
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
            在浏览器 Worker 中运行经典 8051 裸二进制固件。无需账号、无需上传，
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
                accept=".bin,application/octet-stream"
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
            <p>指令执行与界面隔离，支持单步、连续运行、暂停、复位和机器周期统计。</p>
            <div className="meter"><span style={{ width: `${Math.max(4, usage)}%` }} /></div>
          </article>
          <article className="feature-card accent-blue">
            <span className="feature-icon">▣</span>
            <h3>&gt; Local Workspace</h3>
            <p>固件、CPU 快照和设置保存在 IndexedDB，刷新后可继续调试。</p>
          </article>
          <article className="feature-card accent-amber">
            <span className="feature-icon">⌁</span>
            <h3>&gt; Zero Upload</h3>
            <p>64 KiB 以内的固件由 File API 本地读取，生产 CSP 禁止应用联网。</p>
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
      </TerminalPanel>

      <TerminalPanel className="source-view" title="BIN_INSPECTOR" bits={["READ", running ? "LIVE" : "IDLE"]} active={running}>
        <ControlStrip
          controls={controls}
          firmware={firmware}
          restoring={restoring}
          running={running}
        />
        <div className="source-scroll">
          <TraceSource firmware={firmware} trace={trace} />
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
          </>
        ) : (
          <EmptyState>FLASH_ROM TO INITIALIZE CPU</EmptyState>
        )}
      </TerminalPanel>

      <TerminalPanel className="compiler-output" title="RUNTIME_OUTPUT" bits={[error ? "FAULT" : "OK"]}>
        <div className={`runtime-log ${error ? "has-error" : ""}`}>
          <p>&gt; EmuC51 local runtime</p>
          <p>&gt; {notice}</p>
          <p>&gt; trace buffer: {trace.length}/1000</p>
          <p>&gt; network transport: BLOCKED_BY_CSP</p>
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
          MAX_STEPS
          <input
            aria-label="最大步数"
            type="number"
            min="0"
            max="100000000"
            value={settings.maxSteps}
            onChange={(event) =>
              updateSettings({
                ...settings,
                maxSteps: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
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
      <button disabled={!firmware || restoring || running} onClick={controls.reset}>↺ 复位</button>
    </div>
  );
}

function TraceSource({
  firmware,
  trace,
}: {
  firmware?: FirmwareState;
  trace: StepResult[];
}) {
  if (trace.length > 0) {
    return (
      <div className="source-lines" data-testid="trace-list">
        {trace.slice(-80).map((item, index) => (
          <div className={index === trace.slice(-80).length - 1 ? "current" : ""} key={`${item.state.steps}-${index}`}>
            <code>{hex16(item.pcBefore)}</code>
            <code>{item.bytes.slice(0, item.length).map(hex8).join(" ")}</code>
            <strong>{item.mnemonic}</strong>
          </div>
        ))}
      </div>
    );
  }
  if (!firmware) return <EmptyState>NO BINARY IMAGE LOADED</EmptyState>;
  const bytes = new Uint8Array(firmware.bytes).slice(0, 96);
  const rows: ReactNode[] = [];
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const chunk = bytes.slice(offset, offset + 4);
    rows.push(
      <div key={offset}>
        <code>{hex16(offset)}</code>
        <code>{Array.from(chunk, hex8).join(" ")}</code>
        <strong>.DB {Array.from(chunk, (value) => `0x${hex8(value)}`).join(", ")}</strong>
      </div>,
    );
  }
  return <div className="source-lines" data-testid="trace-list">{rows}</div>;
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
}: {
  firmware?: FirmwareState;
  portHistory: number[][];
  portValues: number[];
}) {
  const digits = `${hex8(portValues[0] ?? 0xff)}${hex8(portValues[1] ?? 0xff)}`;
  const rotorAngle = ((portValues[1] ?? 0) & 0x03) * 90;
  return (
    <div className="io-workspace">
      <div className="io-notice">
        <strong>SFR PASSIVE MIRROR</strong>
        <span>当前 v1 仅观察端口寄存器输出，不注入键盘或外设输入。</span>
      </div>

      <TerminalPanel className="display-module" title="DISPLAY_MOD" bits={[`P0:${hex8(portValues[0] ?? 0xff)}`]}>
        <div className="lcd-screen">
          <span>{firmware ? "SYSTEM READY..." : "AWAITING FLASH..."}</span>
          <strong>{firmware ? "INIT PERIPH OK_" : "LOAD ROM TO START_"}</strong>
        </div>
        <div className="seven-segment" aria-label={`端口十六进制值 ${digits}`}>
          {digits.split("").map((digit, index) => <span key={index}>{digit}</span>)}
        </div>
      </TerminalPanel>

      <TerminalPanel className="matrix-module" title="MATRIX_4X4" bits={["READ_ONLY"]}>
        <div className="key-matrix">
          {"123A456B789C*0#D".split("").map((key) => (
            <button disabled key={key} title="v1 不支持外设输入注入">{key}</button>
          ))}
        </div>
      </TerminalPanel>

      <TerminalPanel className="stepper-module" title="STEPPER_MOD" bits={[`P1:${hex8(portValues[1] ?? 0xff)}`]}>
        <div className="stepper-content">
          <div className="phase-list">
            {[0, 1, 2, 3].map((bit) => (
              <span key={bit}><i className={(portValues[1] ?? 0) & (1 << bit) ? "on" : ""} />PH{String.fromCharCode(65 + bit)}</span>
            ))}
          </div>
          <div className="rotor"><span style={{ transform: `rotate(${rotorAngle}deg)` }} /></div>
          <code>POS: {rotorAngle}°<br />DIR: CW</code>
        </div>
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
