import { fireEvent, render, screen, act } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { InputScenarioPanel } from "../../src/components/InputScenarioPanel";
import { normalizeInputScenario } from "../../src/core/input-scenario";
import example from "../../src/examples/scenario-timer-uart.json";
const props=()=>({scenario:normalizeInputScenario(example),replay:{active:false,delivered:[]},disabled:false,running:false,pending:false,firmwareSha256:example.firmwareSha256,onInstall:vi.fn(),onStart:vi.fn(),onCancel:vi.fn(),onClear:vi.fn()});
it("cancels delayed file reads and ignores results after navigation",async()=>{
  const input=props();const view=render(<InputScenarioPanel {...input}/>);
  let resolve!:(text:string)=>void;
  const file={size:100,text:()=>new Promise<string>(done=>{resolve=done;})};
  fireEvent.change(screen.getByLabelText("导入场景 JSON"),{target:{files:[file]}});
  fireEvent.click(screen.getByRole("button",{name:"取消输入重放"}));
  await act(async()=>resolve(JSON.stringify(example)));expect(input.onInstall).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("导入场景 JSON"),{target:{files:[file]}});view.unmount();
  await act(async()=>resolve(JSON.stringify(example)));expect(input.onInstall).not.toHaveBeenCalled();
});
it("rejects oversize files before reading and bounds rendered events to 50",async()=>{
  const input=props();input.scenario.events=Array.from({length:1024},()=>({type:"gpio",cycle:0,port:0,value:255}));
  render(<InputScenarioPanel {...input}/>);expect(screen.getAllByTestId("scenario-event")).toHaveLength(50);
  const text=vi.fn();await act(async()=>fireEvent.change(screen.getByLabelText("导入场景 JSON"),{target:{files:[{size:131073,text}]}}));
  expect(text).not.toHaveBeenCalled();expect(screen.getByRole("alert")).toHaveTextContent("128 KiB");
  fireEvent.click(screen.getByRole("button",{name:"场景下一页"}));expect(screen.getAllByTestId("scenario-event")[0]).toHaveTextContent("#51");
});
