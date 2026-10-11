import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AsmSourcePanel } from "../../src/components/AsmSourcePanel";
import { assemble, ASSEMBLER_VERSION, type AsmArtifact } from "../../src/core/assembler";
afterEach(cleanup);
const artifact=(source="; comment\nORG 10h\nENTRY:\nMOV A,#1\nDB 0\nINC A"):AsmArtifact => {
  const result=assemble(source);
  return {project:{name:"main.asm",source},bytes:result.bytes!.buffer,sourceMap:result.sourceMap!,labels:result.labels!,binding:{assembler:ASSEMBLER_VERSION,sourceSha256:"a".repeat(64),firmwareSha256:"b".repeat(64)}};
};
const props=()=>({artifact:artifact(),pc:16,disabled:false,config:{breakpoints:[16],watchpoints:[],breakpointOptions:[{address:16,enabled:false,hitCount:2,condition:"ACC==1"}]},onToggle:vi.fn(),onBrowse:vi.fn(),onRunTo:vi.fn(),onBrowseMemory:vi.fn()});
it("exposes exact instruction actions and disabled breakpoint state without mapping data or label-only lines",()=>{
  const p=props(); render(<AsmSourcePanel {...p}/>);
  expect(screen.getByTestId("asm-location")).toHaveTextContent("第 4 行");
  expect(screen.getByRole("button",{name:"切换 ASM 第 4 行断点"})).toHaveAttribute("aria-pressed","true");
  expect(screen.getByRole("button",{name:"切换 ASM 第 4 行断点"})).toHaveAttribute("title","地址断点已禁用");
  for(const line of [1,2,3,5]) expect(screen.getByRole("button",{name:`切换 ASM 第 ${line} 行断点`})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"切换 ASM 第 4 行断点"})); expect(p.onToggle).toHaveBeenCalledWith(16);
  fireEvent.click(screen.getByRole("button",{name:"查看 ASM 第 6 行汇编"})); expect(p.onBrowse).toHaveBeenCalledWith(19);
  fireEvent.click(screen.getByRole("button",{name:"运行至 ASM 第 6 行"})); expect(p.onRunTo).toHaveBeenCalledWith(19);
});
it.each([0,17,18])("does not highlight unmapped PC %i (hole, operand or DB)",pc=>{
  render(<AsmSourcePanel {...props()} pc={pc}/>);
  expect(screen.getByTestId("asm-location")).toHaveTextContent("无精确指令行映射");
  expect(screen.getByRole("button",{name:"定位当前 ASM 行"})).toBeDisabled();
});
it("bounds rendering and locates PC on another page while locking mutations during execution",()=>{
  const p=props(); render(<AsmSourcePanel {...p} artifact={artifact(Array(205).fill("NOP").join("\n"))} pc={204} disabled/>);
  expect(screen.getByTestId("asm-source-page")).toHaveTextContent("1 / 3");
  expect(document.querySelectorAll("[data-asm-line]")).toHaveLength(100);
  fireEvent.click(screen.getByRole("button",{name:"定位当前 ASM 行"}));
  expect(screen.getByTestId("asm-source-page")).toHaveTextContent("3 / 3");
  expect(screen.getByRole("button",{name:"运行至 ASM 第 205 行"})).toBeDisabled();
  expect(screen.getByRole("button",{name:"查看 ASM 第 205 行汇编"})).toBeDisabled();
  expect(screen.getByRole("button",{name:"切换 ASM 第 205 行断点"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"ASM 上一页"})); expect(screen.getByTestId("asm-source-page")).toHaveTextContent("2 / 3");
});
it("pages and filters CODE labels, navigates a pure definition and limits breakpoints to instruction starts",()=>{
  const source="ENTRY:\nALIAS: NOP\nTABLE: DB 1\nORG 10h\nHOLE:\n"+Array.from({length:102},(_,i)=>`L${i}: NOP`).join("\n");
  const p={...props(),artifact:artifact(source)};render(<AsmSourcePanel {...p}/>);
  expect(screen.getAllByTestId("asm-symbol")).toHaveLength(50);
  fireEvent.click(screen.getByRole("button",{name:"标签下一页"}));expect(screen.getAllByTestId("asm-symbol")[0]).toHaveTextContent("L46");
  fireEvent.change(screen.getByLabelText("筛选 ASM 标签"),{target:{value:"table"}});
  expect(screen.getAllByTestId("asm-symbol")).toHaveLength(1);
  expect(screen.getByRole("button",{name:"切换 ASM 标签 TABLE 断点"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"查看 ASM 标签 TABLE CODE"}));expect(p.onBrowseMemory).toHaveBeenCalledWith(1);
  fireEvent.change(screen.getByLabelText("筛选 ASM 标签"),{target:{value:"ENTRY"}});
  fireEvent.click(screen.getByRole("button",{name:"切换 ASM 标签 ENTRY 断点"}));expect(p.onToggle).toHaveBeenCalledWith(0);
});
