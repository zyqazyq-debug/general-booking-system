# 前端工程规范

## SelectorQuery 使用指南

目标：在多端（H5/小程序/APP）环境下，实现稳定、可预测、低成本的布局测量，避免测量抖动与重入链路。

- 聚合查询一次 exec
  - 将同一时机需要的选择器（select、selectAll、boundingClientRect、scrollOffset 等）链式聚合在一次 query 上，并只调用一次 exec。
  - 避免为同一轮测量创建多个 query 或多次 exec，减少布局/样式计算开销。

- 禁止回调内再次 exec/复用同一 query
  - 不要在 exec 的回调中再次创建或执行新的 query；如需后续测量，开启新的时序（例如下一帧/下一个微任务）并新建 query。
  - 不要跨时序复用同一个 query 实例；每次测量独立创建、独立释放，避免脏状态与意外复用。

- 必要时分离 query + 防抖 + 互斥
  - 将「触发条件」与「执行测量」分离：触发只负责标记/节流，真正测量放到受控时序中执行。
  - 对高频触发源（滚动、窗口变化、内容异步加载）增加防抖/节流；同一时间只允许一个测量在飞行（互斥锁或最新优先取消旧任务）。
  - 如测量结果会导致状态更新，确保该更新不会再次立刻触发测量（打断重入链：状态 → 触发 → 测量 → 状态）。

- 避免在动画中频繁测量
  - 动画/过渡期间避免连续测量；必要时在动画稳定后的时间点一次性测量（如 setTimeout/transitionend/下一帧）。
  - 对首次展示（如 modal 打开）建议延时一次测量，等待布局稳定；后续内容异步变化再以防抖策略追加测量。

推荐模式（伪代码）：

```ts
let measuring = false;
let scheduled = false;

function scheduleMeasure(ctx: ComponentInstance) {
  if (measuring) {
    scheduled = true;
    return;
  }
  measuring = true;
  scheduled = false;

  // 建议在 nextTick/动画结束后进入
  nextTick(() => {
    const q = uni.createSelectorQuery().in(ctx);
    q.select('.container').boundingClientRect();
    q.select('.content').boundingClientRect();
    q.exec((res) => {
      // 只做纯计算 + 最小化状态更新，避免再次触发测量
      applyLayoutState(res);

      measuring = false;
      if (scheduled) scheduleMeasure(ctx);
    });
  });
}
```

适用边界：
- 用于需要测量高度/滚动容器的组件（Modal/Page/虚拟列表等）。
- 对外暴露测量触发 API 时，应明确其防抖/互斥行为，避免调用侧误用。

