import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {SdccSymbolsPanel,symbolBindingToken} from "../../src/components/SdccSymbolsPanel";
import {parseCdbSymbols} from "../../src/core/cdb-symbols";
import {sdccFixture} from "../fixtures/sdcc-fixture";
afterEach(cleanup);
const data=sdccFixture("symbols","sdcc-symbols");
const verified={data,firmware:new ArrayBuffer(256),firmwareSha256:"a".repeat(64),locations:[],functions:[],symbols:parseCdbSymbols(data.cdb,"symbols",256)};
it("keeps ambiguous names qualified, unsupported rows unavailable and samples bound",()=>{
  const read=vi.fn(),browse=vi.fn();const p={verified,disabled:false,onRead:read,onBrowse:browse};
  const {rerender}=render(<SdccSymbolsPanel {...p}/>);
  const global=verified.symbols.find(symbol=>symbol.name==="shadow"&&!symbol.unavailable)!;
  const local=verified.symbols.find(symbol=>symbol.name==="shadow"&&symbol.unavailable)!;
  expect(screen.getByRole("button",{name:`观察 ${local.id}`})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:`观察 ${global.id}`}));expect(read).toHaveBeenCalledWith(global.id);
  const sample={id:global.id,token:"wrong",results:[{expression:"IRAM[11]",value:34}],pc:0,steps:100};
  rerender(<SdccSymbolsPanel {...p} sample={sample}/>);expect(screen.getByTestId("symbol-bytes")).toHaveTextContent("…");
  rerender(<SdccSymbolsPanel {...p} sample={{...sample,token:symbolBindingToken(verified)}}/>);expect(screen.getByTestId("symbol-bytes")).toHaveTextContent("22");
  fireEvent.click(screen.getByRole("button",{name:"刷新符号观察"}));expect(read).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button",{name:`导航 ${global.id}`}));expect(browse).toHaveBeenCalledWith(global.id);
  rerender(<SdccSymbolsPanel {...p} disabled/>);expect(screen.getByRole("button",{name:"刷新符号观察"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"取消符号观察"}));expect(screen.queryByTestId("symbol-bytes")).not.toBeInTheDocument();
});
it("bounds rendered declarations to 50 and filters case-insensitively without merging names",()=>{
  const symbols=Array.from({length:2048},(_,i)=>({...verified.symbols[0]!,id:`CDB::symbols::G$name${i}$0_0$0`,name:`name${i}`}));
  render(<SdccSymbolsPanel verified={{...verified,symbols}} disabled={false} onRead={vi.fn()} onBrowse={vi.fn()}/>);
  expect(screen.getAllByTestId("sdcc-symbol")).toHaveLength(50);
  fireEvent.click(screen.getByRole("button",{name:"符号下一页"}));expect(screen.getAllByTestId("sdcc-symbol")[0]).toHaveTextContent("name50");
  fireEvent.change(screen.getByLabelText("筛选 SDCC 符号"),{target:{value:"NAME2047"}});expect(screen.getAllByTestId("sdcc-symbol")).toHaveLength(1);
});
it("derives a storage integer from the same bound sample and hides stale source/firmware values",()=>{
  const symbol=verified.symbols.find(item=>item.name==="count16")!;
  const p={verified,disabled:false,onRead:vi.fn(),onBrowse:vi.fn()};
  const {rerender}=render(<SdccSymbolsPanel {...p}/>);
  fireEvent.click(screen.getByRole("button",{name:`观察 ${symbol.id}`}));
  expect(screen.getByTestId("symbol-integer")).toHaveTextContent("暂无完整有效采样");
  const sample={id:symbol.id,token:symbolBindingToken(verified),results:[
    {expression:`IRAM[${symbol.address}]`,value:255},{expression:`IRAM[${symbol.address!+1}]`,value:255},
  ],pc:0,steps:10};
  rerender(<SdccSymbolsPanel {...p} sample={sample}/>);
  expect(screen.getByTestId("symbol-integer")).toHaveTextContent("65535");
  expect(screen.getByTestId("symbol-bytes")).toHaveTextContent("FF FF");
  expect(screen.getByLabelText("CDB 存储整数视图")).toHaveTextContent("相同存储编码的枚举");
  const changed={...verified,data:{...verified.data,manifest:{...verified.data.manifest,files:{...verified.data.manifest.files,source:{...verified.data.manifest.files.source,sha256:"b".repeat(64)}}}}};
  rerender(<SdccSymbolsPanel {...p} verified={changed} sample={sample}/>);
  expect(screen.getByTestId("symbol-integer")).toHaveTextContent("暂无完整有效采样");
  rerender(<SdccSymbolsPanel {...p} verified={{...verified,firmwareSha256:"c".repeat(64)}} sample={sample}/>);
  expect(screen.getByTestId("symbol-integer")).toHaveTextContent("暂无完整有效采样");
  rerender(<SdccSymbolsPanel {...p} sample={{...sample,results:[{...sample.results[0]!,error:"采样失败"},sample.results[1]!]}}/>);
  expect(screen.getByTestId("symbol-integer")).toHaveTextContent("暂无完整有效采样");
  fireEvent.click(screen.getByRole("button",{name:"取消符号观察"}));
  expect(screen.queryByTestId("symbol-integer")).not.toBeInTheDocument();
});
