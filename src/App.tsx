import { nameCallEntry, type CdbFunction } from "./core/cdb-functions";
import { SdccSymbolsPanel, symbolBindingToken, type SymbolSample } from "./components/SdccSymbolsPanel";
import { symbolByteExpressions } from "./core/cdb-symbols";
import { InputScenarioPanel } from "./components/InputScenarioPanel";
import type { InputScenario, ReplayView } from "./core/input-scenario";
import { AsmSourcePanel } from "./components/AsmSourcePanel";
import { CCompilerPanel } from "./components/CCompilerPanel";
import { SdccSourcePanel } from "./components/SdccSourcePanel";
import { useSdccDebug } from "./components/useSdccDebug";
import { toggleSourceBreakpoints, type SdccDebugData } from "./core/sdcc-debug";
import { importSdccFiles } from "./persistence/sdcc-import";
import { AsmPanel } from "./components/AsmPanel";
import { useAsmBuild } from "./components/useAsmBuild";
import { ASM_EXAMPLE, type AsmArtifact, type AsmProject } from "./core/assembler";
import { readAsmDraft, saveAsmDraft } from "./persistence/asm-draft";
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
import { CoveragePanel } from "./components/CoveragePanel";
import type { CoverageReport, CoverageSummary } from "./core/coverage";
import { WatchPanel } from "./components/WatchPanel";
import { DisassemblyView } from "./components/DisassemblyView";
import { normalizeDebugConfig, removeBreakpoint } from "./core/debugger";
import { ByteEditor, DebuggerPanel, RegisterEditor, type DebugSettings, type WritableSpace } from "./components/DebuggerPanel";
import { MemoryNavigation, memoryBounds } from "./components/MemoryNavigation";
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
  const scenarioRequestRef = useRef(0);
  const [scenarioPending, setScenarioPending] = useState(false);
  const [replay, setReplay] = useState<ReplayView>({active:false,delivered:[]});
  const firmwareRef = useRef<FirmwareState | undefined>(undefined);
  const snapshotRef = useRef<CpuSnapshot | undefined>(undefined);
  const settingsRef = useRef<WorkspaceSettings>(DEFAULT_SETTINGS);
  const memoryAddressRef = useRef(0);
  const memoryRequestRef = useRef(0);
  const watchRequestRef = useRef(0);
  const symbolRequestRef = useRef<{id:number;symbolId:string;token:string;data:SdccDebugData;firmware:FirmwareState}|undefined>(undefined);
  const [symbolSample,setSymbolSample]=useState<SymbolSample>();
  const coverageRequestRef = useRef(0);
  const coverageControlRef = useRef(0);
  const coverageEpochRef = useRef(-1);
  const coverageReportRequestRef = useRef<{ id: number; download: boolean } | undefined>(undefined);
  const exportRequestRef = useRef<number | undefined>(undefined);
  const firmwareRequestRef = useRef(0);
  const fileActionRef = useRef(0);
  const clearingRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveRevisionRef = useRef(0);

  const [activeView, setActiveView] = useState<AppView>(viewFromHash);
  const [firmware, setFirmware] = useState<FirmwareState>();
  const [cpuState, setCpuState] = useState<CpuViewState>();
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const asm = useAsmBuild(settings.asmProject);
  const sdcc = useSdccDebug(settings.sdccDebug, firmware?.bytes);
  const [sdccImporting, setSdccImporting] = useState(false);
  const asmBlocked = Boolean(settings.asmBinding && (!asm.artifact ||
    asm.artifact.binding.sourceSha256 !== settings.asmBinding.sourceSha256 ||
    asm.artifact.binding.firmwareSha256 !== firmware?.sha256 ||
    asm.artifact.binding.firmwareSha256 !== settings.asmBinding.firmwareSha256));
  const [running, setRunning] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [workspaceGeneration, setWorkspaceGeneration] = useState(0);
  const watchExpressions = useMemo(() => settings.watchExpressions ?? [], [settings.watchExpressions]);
  const [coverageReport, setCoverageReport] = useState<CoverageReport>();
  const [coverageReportPending, setCoverageReportPending] = useState(false);
  const cancelCoverageReport = useCallback(() => {
    coverageReportRequestRef.current = undefined;
    setCoverageReportPending(false);
    setCoverageReport(undefined);
  }, []);
  const [coverage, setCoverage] = useState<CoverageSummary>();
  const [coverageSample, setCoverageSample] = useState<Extract<EmulatorEvent, { type: "CoverageData" }>>();
  const [watchSample, setWatchSample] = useState<Extract<EmulatorEvent, { type: "WatchResults" }>>();
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
      schemaVersion: 4,
      coreStateVersion: snapshot.coreStateVersion,
      firmware: { ...currentFirmware, bytes: copyBuffer(currentFirmware.bytes) },
      cpu: snapshot,
      settings: settingsRef.current,
      updatedAt: Date.now(),
    };
  }, []);

  const persistSnapshot = useCallback(
    async (snapshot: CpuSnapshot): Promise<boolean> => {
      if (clearingRef.current) return false;
      captureSnapshot(snapshot);
      const record = workspaceRecord(snapshot);
      if (!record) return false;
      const revision = ++saveRevisionRef.current;
      setSaveState("saving");
      setNotice("正在保存工作区…");
      try {
        const write = saveQueueRef.current.catch(() => undefined).then(() => saveWorkspace(record));
        saveQueueRef.current = write;
        await write;
        if (revision !== saveRevisionRef.current || clearingRef.current) return false;
        setSaveState("saved");
        setNotice("工作区已保存在此浏览器");
        return true;
      } catch {
        if (revision === saveRevisionRef.current && !clearingRef.current) {
          setSaveState("error");
          setNotice("无法写入浏览器存储；本次会话仍可继续");
        }
        return false;
      }
    },
    [captureSnapshot, workspaceRecord],
  );

  const requestMemory = useCallback(() => {
    if (!firmwareRef.current) return;
    const space = settingsRef.current.selectedMemorySpace;
    const [minimum, maximum] = memoryBounds(space);
    const address = Math.max(minimum, Math.min(maximum, memoryAddressRef.current));
    memoryAddressRef.current = address;
    setMemoryAddress(address);
    setMemoryBytes(new Uint8Array());
    memoryRequestRef.current = postCommand({
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
    },
    [],
  );

  const handleWorkerEvent = useCallback(
    (event: EmulatorEvent): void => {
      if (event.requestId < firmwareRequestRef.current) return;
      switch (event.type) {
        case "ScenarioChanged":
          setReplay(event.replay);
          if (event.requestId === scenarioRequestRef.current) { scenarioRequestRef.current=0;setScenarioPending(false); }
          if (event.definitionChanged) {
            const next={...settingsRef.current,inputScenario:event.scenario};
            settingsRef.current=next;setSettingsState(next);
          }
          break;
        case "Ready":
          if (settingsRef.current.inputScenario) {
            setScenarioPending(true);
            scenarioRequestRef.current=postCommand({type:"InstallScenario",scenario:settingsRef.current.inputScenario});
          }
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
        case "CoverageChanged":
          if (coverageControlRef.current && event.requestId < coverageControlRef.current) break;
          if (event.requestId === coverageControlRef.current) coverageControlRef.current = 0;
          if (event.summary.epoch < coverageEpochRef.current) break;
          if (event.summary.epoch !== coverageEpochRef.current) {
            setCoverageSample(undefined);
            cancelCoverageReport();
          }
          coverageEpochRef.current = event.summary.epoch;
          setCoverage(event.summary);
          break;
        case "CoverageData":
          if (event.requestId !== coverageRequestRef.current || event.summary.epoch < coverageEpochRef.current) break;
          coverageEpochRef.current = event.summary.epoch;
          setCoverage(event.summary);
          setCoverageSample(event);
          break;
        case "CoverageReportCreated": {
          const request = coverageReportRequestRef.current;
          if (!request || event.requestId !== request.id || event.report.summary.epoch !== coverageEpochRef.current) break;
          coverageReportRequestRef.current = undefined;
          setCoverageReportPending(false);
          if (event.report.firmware.sha256 !== firmwareRef.current?.sha256) {
            setError("覆盖报告的固件摘要不匹配，请重新采样");
            break;
          }
          setCoverageReport(event.report);
          if (request.download) {
            const url = URL.createObjectURL(new Blob([JSON.stringify(event.report, null, 2)], { type: "application/json" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = `${event.report.firmware.name.replace(/\.[^.]+$/, "")}.coverage.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }
          break;
        }
        case "WatchResults": {
          const request=symbolRequestRef.current;
          if(request&&event.requestId===request.id&&request.data===settingsRef.current.sdccDebug&&request.firmware===firmwareRef.current)
            setSymbolSample({id:request.symbolId,token:request.token,results:event.results,pc:event.pc,steps:event.steps});
          if (event.requestId === watchRequestRef.current) setWatchSample(event);
          break;
        }
        case "MemoryData":
          if (event.requestId === memoryRequestRef.current && event.space === settingsRef.current.selectedMemorySpace && event.address === memoryAddressRef.current) setMemoryBytes(event.bytes);
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
          if (event.reason === "BreakpointConditionError") setError(`条件断点 ${hex16(event.address ?? event.state.pc)}：${event.conditionError?.expression} — ${event.conditionError?.message}`);
          setCpuState(event.state);
          setRunning(false);
          void persistSnapshot(event.snapshot).then((saved) => {
            if (!saved) return;
            setNotice(event.reason === "StepLimitReached" ? "已达到本次运行步数上限"
              : event.reason === "BreakpointConditionError" ? `条件求值失败 · PC=${hex16(event.state.pc)}`
              : event.reason === "Breakpoint" ? `断点暂停 · PC=${hex16(event.state.pc)}`
              : event.reason === "OperandWatchpoint" ? `CPU 操作数访问后暂停 · ${(event.accesses ?? []).map(item => `PC=${hex16(item.pc)} ${item.space.toUpperCase()} ${hex16(item.address)}${item.bit ? ` (${item.bit.byteSpace.toUpperCase()} ${hex16(item.bit.byteAddress)}.${item.bit.index})` : ""} ${item.kind === "read" ? "读" : "写"}=${item.bit ? item.value : hex8(item.value)}${item.bit?.readSource ? ` [${{ pins: "引脚", latch: "锁存器", memory: "存储位" }[item.bit.readSource]}]` : ""}`).join(" → ")}`
              : event.reason === "Watchpoint" ? `监视点暂停 · ${event.watchpoint?.space.toUpperCase()} ${hex16(event.watchpoint?.address ?? 0)}`
              : event.reason === "RunToAddress" ? `已运行至地址 ${hex16(event.state.pc)}`
              : event.reason === "PowerDown" ? "CPU 已进入掉电模式；复位后继续执行"
              : event.reason === "CallStackInvalidated" ? "调用帧失去可信度，已停止跳出；请检查栈或返回指令"
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
          if(event.requestId===scenarioRequestRef.current){scenarioRequestRef.current=0;setScenarioPending(false);}
          if (event.requestId === coverageReportRequestRef.current?.id) cancelCoverageReport();
          setRunning(event.running);
          setError(formatFault({ ...event, type: "ExecutionFault" }));
          break;
      }
    },
    [persistSnapshot, requestMemory, postCommand, workspaceRecord, cancelCoverageReport],
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
          const draft = readAsmDraft();
          if (draft) { const initial = { ...DEFAULT_SETTINGS, asmProject: draft }; settingsRef.current = initial; setSettingsState(initial); }
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
        try { saveAsmDraft(savedSettings.asmProject); } catch { /* Workspace copy remains available. */ }
        const restoredAddress = savedSettings.memoryAddress ?? (savedSettings.selectedMemorySpace === "sfr" ? 0x80 : 0);
        memoryAddressRef.current = restoredAddress;
        setMemoryAddress(restoredAddress);
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
    if (activeView === "memory") requestMemory();
  }, [activeView, requestMemory]);

  useEffect(() => {
    const saveOnHide = () => {
      const snapshot = snapshotRef.current;
      if (snapshot) void persistSnapshot(snapshot);
    };
    window.addEventListener("pagehide", saveOnHide);
    return () => window.removeEventListener("pagehide", saveOnHide);
  }, [persistSnapshot]);

  const readCoverage = useCallback((addresses: number[]) => {
    coverageRequestRef.current = postCommand({ type: "ReadCoverage", addresses });
  }, [postCommand]);

  const requestCoverageReport = (download: boolean): void => {
    if (coverageReportRequestRef.current || coverageControlRef.current) return;
    coverageReportRequestRef.current = { id: postCommand({ type: "CreateCoverageReport" }), download };
    setCoverageReportPending(true);
  };

  const setCoverageEnabled = (enabled: boolean): void => {
    cancelCoverageReport();
    coverageRequestRef.current = postCommand({ type: "SetCoverage", enabled });
    coverageControlRef.current = coverageRequestRef.current;
    setCoverage(current => current ? { ...current, enabled } : current);
  };
  const clearCoverage = (): void => {
    cancelCoverageReport();
    coverageRequestRef.current = postCommand({ type: "ClearCoverage" });
    coverageControlRef.current = coverageRequestRef.current;
  };

  const refreshWatch = useCallback(() => {
    if (!firmware || restoring || watchExpressions.length === 0) return;
    watchRequestRef.current = postCommand({ type: "EvaluateExpressions", expressions: watchExpressions });
  }, [firmware, restoring, watchExpressions, postCommand]);

  useEffect(() => {
    watchRequestRef.current = -1;
    setWatchSample(undefined);
    if (activeView === "memory") refreshWatch();
  }, [activeView, cpuState, refreshWatch]);

  const updateWatch = (expressions: string[]): void => {
    watchRequestRef.current = -1;
    setWatchSample(undefined);
    updateSettings({ ...settingsRef.current, watchExpressions: expressions });
  };

  const updateSettings = (next: WorkspaceSettings): void => {
    if (next.asmProject !== settingsRef.current.asmProject) {
      try { saveAsmDraft(next.asmProject); }
      catch { setError("ASM 草稿无法写入本地存储，请导出 ASM 备份"); }
    }
    settingsRef.current = next;
    setSettingsState(next);
    const snapshot = snapshotRef.current;
    if (snapshot) void persistSnapshot(snapshot);
  };

  const loadFile = async (file: File, built?: AsmArtifact, sdccDebug?: SdccDebugData, accept?: () => boolean): Promise<void> => {
    const action = ++fileActionRef.current;
    setSdccImporting(false);
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
      if (action !== fileActionRef.current || (accept && !accept())) return;
      if (built && (settingsRef.current.asmProject?.source !== built.project.source || settingsRef.current.asmProject?.name !== built.project.name || nextFirmware.sha256 !== built.binding.firmwareSha256)) {
        setError("源码或产物已变化，未加载旧构建；请重新构建"); return;
      }
      if (!built) asm.cancel();
      const nextSettings = { ...settingsRef.current, asmBinding: built?.binding, sdccDebug, inputScenario:undefined };
      settingsRef.current = nextSettings; setSettingsState(nextSettings);
      setWorkspaceGeneration(current => current + 1);
      symbolRequestRef.current=undefined;setSymbolSample(undefined);
      setReplay({active:false,delivered:[]});setScenarioPending(false);scenarioRequestRef.current=0;
      firmwareRef.current = nextFirmware;
      snapshotRef.current = undefined;
      coverageRequestRef.current = -1;
      coverageControlRef.current = 0;
      cancelCoverageReport();
      setCoverage(undefined);
      setCoverageSample(undefined);
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

  const onSdccFiles = async (files: File[]): Promise<void> => {
    const action = ++fileActionRef.current;
    setError(undefined); setSdccImporting(true);
    try {
      const verified = await importSdccFiles(files);
      if (action !== fileActionRef.current || clearingRef.current) return;
      setSdccImporting(false);
      await loadFile(new File([verified.data.ihx], verified.data.manifest.files.ihx.name), undefined, verified.data);
    } catch (caught) {
      if (action !== fileActionRef.current) return;
      setSdccImporting(false); setError(caught instanceof Error ? caught.message : "无法导入 SDCC 文件");
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

  const allowExecution = (): boolean => {
    if (scenarioPending) { setError("请等待场景验证完成或取消"); return false; }
    if (asmBlocked) { setError("ASM 源码与当前固件未验证匹配；请构建当前源码并加载产物"); return false; }
    return true;
  };
  const run = (): void => {
    if (!allowExecution()) return;
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
    if (!allowExecution()) return;
    setError(undefined);
    postCommand({ type: "Step", trace: settings.traceEnabled });
  };

  const reset = (): void => {
    scenarioRequestRef.current=0;setScenarioPending(false);
    cancelCoverageReport();
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
    if (!allowExecution()) return;
    setError(undefined);
    setRunning(true);
    postCommand({ type: "RunToAddress", address, maxSteps: settings.maxSteps, trace: settings.traceEnabled });
  };

  const stepOver = (): void => {
    if (!allowExecution()) return;
    setError(undefined);
    setRunning(true);
    postCommand({ type: "StepOver", maxSteps: settings.maxSteps, trace: settings.traceEnabled });
  };

  const stepOut = (): void => {
    if (!allowExecution()) return;
    setError(undefined);
    setRunning(true);
    postCommand({ type: "StepOut", maxSteps: settings.maxSteps, trace: settings.traceEnabled });
  };

  const writeMemory = (space: WritableSpace, address: number, value: number): void => {
    if (replay.active) { setError("请先取消输入重放再修改内存"); return; }
    setError(undefined);
    postCommand({ type: "WriteMemory", space, address, value });
    requestMemory();
  };

  const writeRegister = (name: string, value: number): void => {
    if (replay.active) { setError("请先取消输入重放再修改寄存器"); return; }
    setError(undefined);
    postCommand({ type: "SetRegister", name, value });
  };

  const importFile = async (file: File): Promise<void> => {
    const action = ++fileActionRef.current;
    setSdccImporting(false);
    setError(undefined);
    try {
      if (file.size > MAX_WORKSPACE_IMPORT_BYTES) throw new Error("工作区文件超过 8 MiB 上限");
      const record = await importWorkspace(await file.text());
      if (action !== fileActionRef.current) return;
      asm.cancel();
      // Validation finishes before changing the active CPU or persisted record.
      const nextFirmware = { ...record.firmware, bytes: copyBuffer(record.firmware.bytes) };
      setWorkspaceGeneration(current => current + 1);
      symbolRequestRef.current=undefined;setSymbolSample(undefined);
      setReplay({active:false,delivered:[]});setScenarioPending(false);scenarioRequestRef.current=0;
      firmwareRef.current = nextFirmware;
      snapshotRef.current = undefined;
      coverageRequestRef.current = -1;
      coverageControlRef.current = 0;
      cancelCoverageReport();
      setCoverage(undefined);
      setCoverageSample(undefined);
      settingsRef.current = record.settings;
      setFirmware(nextFirmware);
      setSettingsState(record.settings);
      try { saveAsmDraft(record.settings.asmProject); } catch { setError("ASM 草稿备份写入失败，工作区仍保留源码"); }
      const restoredAddress = record.settings.memoryAddress ?? (record.settings.selectedMemorySpace === "sfr" ? 0x80 : 0);
      memoryAddressRef.current = restoredAddress;
      setMemoryAddress(restoredAddress);
      watchRequestRef.current = -1;
      setWatchSample(undefined);
      setMemoryBytes(new Uint8Array());
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
    // A failed draft deletion must not leave the active emulator terminated.
    try { saveAsmDraft(undefined); }
    catch { setError("无法清除本地 ASM 草稿；当前工作区未清除，请检查浏览器存储权限后重试"); return; }
    setRestoring(true);
    clearingRef.current = true;
    fileActionRef.current += 1;
    firmwareRequestRef.current = Number.MAX_SAFE_INTEGER;
    firmwareRef.current = undefined;
    snapshotRef.current = undefined;
    workerRef.current?.terminate();
    asm.cancel();
    await saveQueueRef.current.catch(() => undefined);
    await clearWorkspace();
    window.location.reload();
  };

  const installScenario = (scenario:InputScenario): void => {
    if(running||restoring||replay.active)return;
    setError(undefined);setScenarioPending(true);
    scenarioRequestRef.current=postCommand({type:"InstallScenario",scenario});
  };
  const startScenario = (): void => {
    if(!allowExecution()||running||restoring||replay.active||scenarioPending)return;
    cancelCoverageReport();setTrace([]);setPortHistory([]);setSerialOutput([]);setError(undefined);
    setScenarioPending(true);scenarioRequestRef.current=postCommand({type:"StartScenario"});
  };
  const cancelScenario = (): void => {
    setScenarioPending(false);scenarioRequestRef.current=0;
    postCommand({type:"CancelScenario"});
  };
  const browseSymbolMemory = (space: MemorySpace, address:number): void => {
    memoryAddressRef.current=address;setMemoryAddress(address);
    updateSettings({...settingsRef.current,selectedMemorySpace:space,memoryAddress:address});
    requestMemory();navigate("memory");
  };
  const chooseMemorySpace = (space: MemorySpace): void => {
    const nextAddress = space === "sfr" ? 0x80 : 0;
    memoryAddressRef.current = nextAddress;
    setMemoryAddress(nextAddress);
    updateSettings({ ...settingsRef.current, selectedMemorySpace: space, memoryAddress: nextAddress });
    requestMemory();
  };

  const updateMemoryAddress = (address: number): void => {
    memoryAddressRef.current = address;
    updateSettings({ ...settingsRef.current, memoryAddress: address });
    requestMemory();
  };

  const portValues = useMemo(
    () => PORT_ADDRESSES.map((address, index) => cpuState?.peripherals.ports[index]?.pins ?? sfrBytes[address - 0x80] ?? 0xff),
    [sfrBytes, cpuState],
  );

  const changeAsmProject = (project: AsmProject): void => {
    if (running || restoring) return;
    asm.cancel();
    updateSettings({ ...settingsRef.current, asmProject: project });
  };
  const loadAsm = (): void => {
    const artifact = asm.artifact;
    if (!artifact || running || restoring) return;
    void loadFile(new File([artifact.bytes], artifact.project.name.replace(/\.asm$/i, ".bin")), artifact);
  };
  const runToSdccAddress = (address: number): void => {
    if (running || restoring || sdccImporting || sdcc.checking || !sdcc.verified?.locations.some(item => item.address === address)) return;
    runToAddress(address);
    document.querySelector(".source-view")?.scrollIntoView({ block: "start" });
  };
  const toggleSdccLine = (addresses: number[]): void => {
    if (!sdcc.verified || running || restoring || sdccImporting) return;
    try { updateDebugConfig(toggleSourceBreakpoints(settingsRef.current.debugger ?? { breakpoints: [], watchpoints: [] }, addresses)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "无法设置源码行断点"); }
  };
  const readSdccSymbol = (id:string):void => {
    const verified=sdcc.verified, data=settingsRef.current.sdccDebug, current=firmwareRef.current;
    if(!verified||!data||!current||sdcc.checking||sdccImporting||restoring||running)return;
    const symbol=verified.symbols.find(item=>item.id===id);if(!symbol)return;
    const expressions=symbolByteExpressions(symbol);if(!expressions.length)return;
    setSymbolSample(undefined);
    symbolRequestRef.current={id:postCommand({type:"EvaluateExpressions",expressions}),symbolId:id,token:symbolBindingToken(verified),data,firmware:current};
  };
  const browseSdccSymbol = (id:string):void => {
    if(sdcc.checking||sdccImporting||restoring||running)return;
    const symbol=sdcc.verified?.symbols.find(item=>item.id===id);
    if(symbol&&!symbol.unavailable&&symbol.memorySpace&&symbol.address!==undefined)browseSymbolMemory(symbol.memorySpace,symbol.address);
  };
  const asmDebugArtifact = settings.asmBinding && !asmBlocked && !asm.building && !restoring ? asm.artifact : undefined;
  const validAsmAddress = (address: number): boolean => Boolean(asmDebugArtifact?.sourceMap.some(item => item.kind === "instruction" && item.address === address));
  const toggleAsmAddress = (address: number): void => {
    if (running || !validAsmAddress(address)) return;
    try { updateDebugConfig(toggleSourceBreakpoints(settingsRef.current.debugger ?? { breakpoints: [], watchpoints: [] }, [address])); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "无法设置 ASM 行断点"); }
  };
  const asmStatus = `${asm.message}。${settings.asmBinding
    ? asmBlocked ? "当前 ASM 固件未验证或源码已变更：执行已锁定，请重建；若结果不同须加载新产物。" : "当前源码与已加载 ASM 固件匹配。"
    : firmware ? "当前固件独立于 ASM 草稿；构建后须显式加载才会改变调试内容。" : "尚未加载固件，可新建 ASM 示例开始。"}`;

  const controls = {
    run,
    pause,
    step,
    reset,
    stepOver,
    stepOut,
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

        <main className="view-stage" data-view={activeView} data-save-state={saveState}>
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
              key={workspaceGeneration}
              asmBlocked={asmBlocked}
              cdbFunctions={sdcc.verified && !sdcc.checking && !sdccImporting && !restoring ? sdcc.verified.functions : undefined}
              sdccPanel={onBrowseAddress => <><CCompilerPanel disabled={running || restoring || sdccImporting} epoch={workspaceGeneration} imported={settings.sdccDebug} onLoad={(data,current) => { void loadFile(new File([data.ihx],data.manifest.files.ihx.name),undefined,data,current); }} /><SdccSourcePanel verified={sdcc.verified} checking={sdcc.checking || sdccImporting} error={sdcc.error}
                disabled={running || restoring || sdccImporting} pc={cpuState?.pc} config={settings.debugger ?? { breakpoints: [], watchpoints: [] }}
                onCancelImport={sdccImporting ? () => { fileActionRef.current += 1; setSdccImporting(false); setNotice("已取消 SDCC 导入"); } : undefined}
                onFiles={files => void onSdccFiles(files)} onToggleLine={toggleSdccLine}
                onBrowseAddress={onBrowseAddress} onRunToAddress={runToSdccAddress} />
                {sdcc.verified&&!sdcc.checking&&!sdccImporting&&!restoring&&<SdccSymbolsPanel key={symbolBindingToken(sdcc.verified)} verified={sdcc.verified} disabled={running}
                  sample={symbolSample} onRead={readSdccSymbol} onBrowse={browseSdccSymbol} />}
              </>}
              asmPanel={onBrowseAddress => <><AsmPanel project={settings.asmProject} artifact={asm.artifact} diagnostics={asm.diagnostics} building={asm.building}
                disabled={running || restoring} status={asmStatus} onProject={changeAsmProject} onBuild={asm.build} onCancel={asm.cancel} onLoad={loadAsm}
                onNew={() => changeAsmProject({ name: "main.asm", source: ASM_EXAMPLE })} />
                {asmDebugArtifact ? <AsmSourcePanel key={`${asmDebugArtifact.binding.sourceSha256}:${asmDebugArtifact.binding.firmwareSha256}`} artifact={asmDebugArtifact}
                  pc={cpuState?.pc} disabled={running} config={settings.debugger ?? { breakpoints: [], watchpoints: [] }} onToggle={toggleAsmAddress}
                  onBrowseMemory={address=>{if(!running&&asmDebugArtifact.labels.some(label=>label.address===address&&label.kind!=="unmapped"))browseSymbolMemory("code",address);}}
                  onBrowse={address => { if (!running && validAsmAddress(address)) onBrowseAddress(address); }}
                  onRunTo={address => { if (!running && validAsmAddress(address)) runToAddress(address); }} />
                  : <p data-testid="asm-mapping-status">ASM 行映射须在构建并验证当前源码与已加载固件匹配后启用；修改、取消、失败或刷新后请重建。</p>}
              </>}
              coverageReport={coverageReport} coverageReportPending={coverageReportPending} requestCoverageReport={requestCoverageReport}
              coverage={coverage} coverageSample={coverageSample} readCoverage={readCoverage}
              setCoverageEnabled={setCoverageEnabled} clearCoverage={clearCoverage}
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
              settings={settings}
              watchExpressions={watchExpressions}
              watchSample={watchSample}
              updateWatch={updateWatch}
              refreshWatch={refreshWatch}
              chooseMemorySpace={chooseMemorySpace}
              updateMemoryAddress={updateMemoryAddress}
              running={running}
              restoring={restoring}
              writeMemory={writeMemory}
            />
          )}
          {activeView === "io" && (<>
            <ControlStrip controls={controls} blocked={asmBlocked||scenarioPending} canStepOut={Boolean(cpuState?.callStack.frames.length)} firmware={firmware} restoring={restoring} running={running} />
            <label>重放运行预算<input aria-label="重放运行预算" type="number" min="0" max="100000000" value={settings.maxSteps} disabled={running||restoring} onChange={event=>{
              const maxSteps=Number(event.target.value);if(Number.isSafeInteger(maxSteps)&&maxSteps>=0&&maxSteps<=100000000)updateSettings({...settingsRef.current,maxSteps});
            }} /></label>
            {asmBlocked&&<p className="asm-stale-warning">ASM 源码与固件须先在工作台重建验证，才能继续执行或重放。</p>}
            <InputScenarioPanel key={workspaceGeneration} scenario={settings.inputScenario} replay={replay} disabled={!firmware||restoring||asmBlocked} running={running}
              pending={scenarioPending} firmwareSha256={firmware?.sha256} onInstall={installScenario} onStart={startScenario} onCancel={cancelScenario}
              onClear={()=>postCommand({type:"ClearScenario"})} />
            <IoView
              firmware={firmware}
              portHistory={portHistory}
              portValues={portValues}
              cpuState={cpuState}
              sfrBytes={sfrBytes}
              serialOutput={serialOutput}
              restoring={restoring}
              inputLocked={replay.active}
              onPortInput={(port, value) => postCommand({ type: "SetPortInput", port, value })}
              onReceive={(bytes, ninthBit) => { for (const value of bytes) postCommand({ type: "ReceiveSerial", value, ninthBit }); }}
            />
          </>)}
        </main>
      </div>

      <AppFooter statusText={statusText} />
      {error && <div className="error-banner" role="alert">{error}<button aria-label="关闭错误" onClick={() => setError(undefined)}>×</button></div>}
      <MobileNav activeView={activeView} navigate={navigate} />

      {activeView !== "home" && (
        <button
          className="clear-workspace"
          onClick={() => void clearLocal()}
          disabled={!firmware && !settings.asmProject}
          title="删除此浏览器中的固件、CPU 快照和 ASM 草稿"
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
  stepOut: () => void;
}

function WorkbenchView({
  asmPanel, asmBlocked, sdccPanel, cdbFunctions,
  coverageReport, coverageReportPending, requestCoverageReport,
  coverage, coverageSample, readCoverage, setCoverageEnabled, clearCoverage,
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
  cdbFunctions?: CdbFunction[];
  sdccPanel: (onBrowseAddress: (address: number) => void) => ReactNode;
  asmPanel: (onBrowseAddress: (address: number) => void) => ReactNode;
  asmBlocked: boolean;
  coverageReport?: CoverageReport;
  coverageReportPending: boolean;
  requestCoverageReport: (download: boolean) => void;
  coverage?: CoverageSummary;
  coverageSample?: Extract<EmulatorEvent, { type: "CoverageData" }>;
  readCoverage: (addresses: number[]) => void;
  setCoverageEnabled: (enabled: boolean) => void;
  clearCoverage: () => void;
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
  const [instructionNavigation, setInstructionNavigation] = useState<{ address: number }>();
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
      <TerminalPanel className="sdcc-card" title="SDCC_SOURCE" bits={["LOCAL BUILD", "SDCC 4.5"]}>{sdccPanel(address => {
        setInstructionNavigation({ address });
        document.querySelector(".source-view")?.scrollIntoView({ block: "start" });
      })}</TerminalPanel>
      <TerminalPanel className="asm-card" title="ASM_WORKBENCH" bits={["LOCAL", "SINGLE FILE"]}>{asmPanel(address => {
        setInstructionNavigation({ address });
        document.querySelector(".source-view")?.scrollIntoView({ block: "start" });
      })}</TerminalPanel>
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
          <small>JSON 含固件、CPU、调试设置和 ASM 源码；恢复后须重建验证关联</small>
          <button onClick={() => document.querySelector(".asm-card")?.scrollIntoView({ block: "start" })}>编辑 ASM 源码</button>
          <button className="clear-inline" disabled={!firmware && !settings.asmProject} onClick={() => void clearLocal()}>CLEAR_LOCAL</button>
        </div>
      </TerminalPanel>

      <TerminalPanel className="source-view" title="BIN_INSPECTOR" bits={["READ", running ? "LIVE" : "IDLE"]} active={running}>
        {asmBlocked && <p className="asm-stale-warning" role="status">ASM 源码与当前固件尚未验证匹配，执行已锁定；请在 ASM 工作台重建并验证或加载新产物。</p>}
        <ControlStrip
          controls={controls}
          blocked={asmBlocked}
          canStepOut={Boolean(cpuState?.callStack.frames.length)}
          firmware={firmware}
          restoring={restoring}
          running={running}
        />
        {firmware ? <DisassemblyView key={`${firmware.sha256}:${firmware.loadedAt}`}
          browseRequest={instructionNavigation}
          program={firmware.bytes} pc={cpuState?.pc ?? 0}
          coverage={coverage} coverageSample={coverageSample} onReadCoverage={readCoverage}
          breakpoints={settings.debugger?.breakpoints ?? []}
          breakpointOptions={settings.debugger?.breakpointOptions}
          disabled={restoring} running={running} executionBlocked={asmBlocked} onRunTo={runToAddress}
          onToggleBreakpoint={(address) => {
            const config = settings.debugger ?? { breakpoints: [], watchpoints: [] };
            updateDebugConfig(config.breakpoints.includes(address)
              ? removeBreakpoint(config, address)
              : { ...config, breakpoints: [...config.breakpoints, address] });
          }} /> : <EmptyState>NO BINARY IMAGE LOADED</EmptyState>}
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

      <TerminalPanel className="coverage-card" title="INSTRUCTION_COVERAGE" bits={["SESSION ONLY"]}>
        <CoveragePanel summary={coverage} disabled={!firmware || restoring} onEnable={setCoverageEnabled} onClear={clearCoverage}
          report={coverageReport} pending={coverageReportPending} onSample={requestCoverageReport}
          onNavigate={address => setInstructionNavigation({ address })} />
      </TerminalPanel>

      <TerminalPanel className="debugger-config" title="DEBUGGER" bits={[`${settings.debugger?.breakpoints.length ?? 0} BP`, `${settings.debugger?.watchpoints.length ?? 0} WP`]}>
        <DebuggerPanel config={settings.debugger ?? { breakpoints: [], watchpoints: [] }} disabled={!firmware || restoring || running} onChange={updateDebugConfig} onRunTo={runToAddress} />
      </TerminalPanel>

      <TerminalPanel className="call-stack-panel" title="CALL_STACK" bits={[cpuState?.callStack.complete ? "TRACKED" : "PARTIAL / UNKNOWN"]}>
        <div className="call-stack-list" data-testid="call-stack">
          <p>{cpuState?.callStack.reason ?? (cpuState ? "从复位开始追踪；仅显示机器级调用帧" : "加载固件后开始追踪")}</p>
          {cpuState?.callStack.frames.length === 0 && <p>没有已知调用帧</p>}
          {cpuState?.callStack.frames.slice().reverse().map((frame) => {
            const named = cdbFunctions ? nameCallEntry(cdbFunctions, frame.entryAddress) : undefined;
            return <div key={frame.id} data-testid="call-frame">
            <strong>{frame.kind === "interrupt" ? `ISR ${frame.source}` : "CALL"} {hex16(frame.entryAddress)}</strong>
            {named && <span data-testid="frame-function">历史入口：{named.label}{named.definition && <button disabled={running || restoring} aria-label={`查看函数 ${named.definition.name} 入口汇编`} onClick={() => {
              setInstructionNavigation({ address: frame.entryAddress });
              document.querySelector(".source-view")?.scrollIntoView({ block: "start" });
            }}>入口汇编</button>}</span>}
            <span>来自 {hex16(frame.callAddress)} → 返回 {hex16(frame.returnAddress)} · SP {hex8(frame.stackSp)}</span>
          </div>; })}
          <small>名称仅注释历史机器入口；尾调用不会新增帧，中断向量不猜测 ISR 名称。历史仅保留于本次运行；刷新/导入后早期帧未知。跳出遵循执行预算，可暂停。</small>
        </div>
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
  blocked,
  controls,
  canStepOut,
  firmware,
  restoring,
  running,
}: {
  blocked: boolean;
  controls: ControlActions;
  canStepOut: boolean;
  firmware?: FirmwareState;
  restoring: boolean;
  running: boolean;
}) {
  return (
    <div className="control-strip">
      <button
        className="primary-command"
        disabled={!firmware || restoring || running || blocked}
        onClick={controls.run}
      >
        &gt; 运行
      </button>
      <button disabled={!running} onClick={controls.pause}>Ⅱ 暂停</button>
      <button disabled={!firmware || restoring || running || blocked} onClick={controls.step}>› 单步</button>
      <button disabled={!firmware || restoring || running || blocked} onClick={controls.stepOver}>» 步过</button>
      <button disabled={!firmware || restoring || running || blocked || !canStepOut} onClick={controls.stepOut}>↗ 跳出</button>
      <button disabled={!firmware || restoring || running} onClick={controls.reset}>↺ 复位</button>
    </div>
  );
}

function MemoryView({
  watchExpressions, watchSample, updateWatch, refreshWatch,
  chooseMemorySpace,
  cpuState,
  firmware,
  iramBytes,
  memoryAddress,
  memoryBytes,
  settings,
  updateMemoryAddress,
  running,
  writeMemory,
  restoring,
}: {
  watchExpressions: string[];
  watchSample?: Extract<EmulatorEvent, { type: "WatchResults" }>;
  updateWatch: (expressions: string[]) => void;
  refreshWatch: () => void;
  chooseMemorySpace: (space: MemorySpace) => void;
  cpuState?: CpuViewState;
  firmware?: FirmwareState;
  iramBytes: Uint8Array<ArrayBufferLike>;
  memoryAddress: number;
  memoryBytes: Uint8Array<ArrayBufferLike>;
  settings: WorkspaceSettings;
  updateMemoryAddress: (address: number) => void;
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
          <MemoryNavigation key={`${settings.selectedMemorySpace}:${memoryAddress}`}
            space={settings.selectedMemorySpace} address={memoryAddress}
            disabled={!firmware || restoring} onNavigate={updateMemoryAddress} />
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

      <TerminalPanel className="watch-card" title="WATCH" bits={[`${watchExpressions.length}/32`, "READ ONLY"]}>
        <WatchPanel expressions={watchExpressions} sample={watchSample} disabled={!firmware || restoring}
          onChange={updateWatch} onRefresh={refreshWatch} />
      </TerminalPanel>

      <TerminalPanel className="bank-card" title="REGISTER_BANK" bits={[cpuState ? `BANK${(cpuState.psw >> 3) & 3}` : "OFF"]}>
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
  inputLocked,
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
  inputLocked: boolean;
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
        <GpioControls cpuState={cpuState} disabled={!firmware || restoring || inputLocked} onInput={onPortInput} />
      </TerminalPanel>

      <TerminalPanel className="matrix-module serial-module" title="UART_CONSOLE" bits={["RX/TX"]}>
        <SerialControls cpuState={cpuState} disabled={!firmware || restoring || inputLocked} output={serialOutput} onReceive={onReceive} />
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
