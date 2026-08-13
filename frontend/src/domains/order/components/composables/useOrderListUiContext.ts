import { inject, provide, type InjectionKey, type Ref } from 'vue';

interface OrderListUiContext {
  currentTab: Ref<string>;
  scene: Ref<'default' | 'provider-manage'>;
  getTabName: () => string;
  formatStatus: (status: string) => string;
  getStatusClass: (status: string) => string;
  formatTimeRange: (start: string, end: string) => string;
  canCancel: (item: any) => boolean;
  canConsumerComplete: (item: any) => boolean;
  canProviderCancel: (item: any) => boolean;
  canProviderConfirm: (item: any) => boolean;
  canProviderNoShow: (item: any) => boolean;
  canComplete: (item: any) => boolean;
  canProviderComplete: (item: any) => boolean;
  canProviderDelete: (item: any) => boolean;
}

const ORDER_LIST_UI_CONTEXT_KEY: InjectionKey<OrderListUiContext> = Symbol('ORDER_LIST_UI_CONTEXT_KEY');

export function provideOrderListUiContext(context: OrderListUiContext) {
  provide(ORDER_LIST_UI_CONTEXT_KEY, context);
}

export function useOrderListUiContext() {
  const context = inject(ORDER_LIST_UI_CONTEXT_KEY);
  if (!context) {
    throw new Error('useOrderListUiContext must be used within OrderListComponent');
  }
  return context;
}
