import { expect, test } from '@playwright/test';
for(const width of [1440,1280,820,390]) test(`中性工作台 ${width}px：导航、数据面板与窄屏不溢出`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  await page.goto('/#editor');
  await page.getByTestId('firmware-input').last().setInputFiles('tests/fixtures/firmware/testc51a.bin');
  await expect(page.getByTestId('register-PC')).toContainText('0000');
  const nav=page.getByRole('navigation',{name:width>820?'主导航':'移动端导航',exact:true});
  for(const [label,view] of (width>820?[['BIN_INSPECTOR','editor'],['SYS_MEM','memory'],['I/O_PORTS','io']]:[['CODE','editor'],['MEM','memory'],['I/O','io']])) {
    await nav.getByRole('button',{name:label,exact:true}).click();
    await expect(page.getByRole('main')).toHaveAttribute('data-view',view!);
    await expect(nav.getByRole('button',{name:label,exact:true})).toHaveAttribute('aria-current','page');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const panels=await page.locator('.terminal-panel').evaluateAll(nodes=>nodes.map(node=>{const b=node.getBoundingClientRect();return {left:b.left,right:b.right};}));
    expect(panels.every(p=>p.left>=0&&p.right<=width)).toBe(true);
    if(view==='memory') {
      await expect(page.locator('.memory-row').first()).toBeVisible();
      const dump=page.locator('.memory-dump');
      expect(await dump.evaluate(node=>getComputedStyle(node).overflowY)).toBe('auto');
      await expect(page.locator('.memory-row')).toHaveCount(16);
      if(width===390) expect(await dump.evaluate(node=>node.scrollWidth>node.clientWidth)).toBe(true);
    }
  }
});
test('侧栏键盘折叠保留编译草稿、导航与错误提示可关闭',async({page})=>{
  await page.goto('/#editor');
  const source=page.getByLabel('C 编译源码');
  await source.fill('void main(void) { for (;;) {} }\n');
  const toggle=page.getByRole('button',{name:'折叠侧栏'});
  await toggle.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'展开侧栏'})).toHaveAttribute('aria-expanded','false');
  await expect(page.getByRole('complementary',{name:'工作台侧栏'})).toBeHidden();
  await expect(source).toHaveValue('void main(void) { for (;;) {} }\n');
  await page.getByRole('button',{name:'展开侧栏'}).press('Enter');
  await expect(page.getByRole('complementary',{name:'工作台侧栏'})).toBeVisible();
  await expect(source).toHaveValue('void main(void) { for (;;) {} }\n');
  await source.focus();expect(await source.evaluate(node=>getComputedStyle(node).outlineStyle)).not.toBe('none');
  await page.getByLabel('导入 SDCC 构建文件').setInputFiles({name:'emuc51-browser.build.json',mimeType:'application/json',buffer:Buffer.from('{broken')});
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('alert').getByRole('button').click();await expect(page.getByRole('alert')).toBeHidden();
});
