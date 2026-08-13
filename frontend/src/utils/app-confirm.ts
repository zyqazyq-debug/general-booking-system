import { reactive } from 'vue';

type ConfirmResolver = (result: AppConfirmResult) => void;

export interface AppConfirmOptions {
  title?: string;
  content?: string;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  editable?: boolean;
  placeholderText?: string;
  confirmColor?: string;
}

export interface AppConfirmResult {
  confirm: boolean;
  cancel: boolean;
  content: string;
}

export const appConfirmState = reactive({
  visible: false,
  title: '',
  content: '',
  confirmText: '确定',
  cancelText: '取消',
  showCancel: true,
  editable: false,
  placeholderText: '',
  confirmColor: '#2563eb',
  inputValue: '',
  resolver: null as ConfirmResolver | null
});

export const showAppConfirm = (options: AppConfirmOptions = {}) => {
  console.log('[AppConfirm] showAppConfirm called', options);
  appConfirmState.title = options.title || '提示';
  appConfirmState.content = options.content || '';
  appConfirmState.confirmText = options.confirmText || '确定';
  appConfirmState.cancelText = options.cancelText || '取消';
  appConfirmState.showCancel = options.showCancel !== false;
  appConfirmState.editable = Boolean(options.editable);
  appConfirmState.placeholderText = options.placeholderText || '';
  appConfirmState.confirmColor = options.confirmColor || '#2563eb';
  appConfirmState.inputValue = '';
  appConfirmState.visible = true;
  console.log('[AppConfirm] state updated, visible:', appConfirmState.visible);

  return new Promise<AppConfirmResult>((resolve) => {
    appConfirmState.resolver = resolve;
  });
};

const resolveConfirm = (result: AppConfirmResult) => {
  const resolver = appConfirmState.resolver;
  appConfirmState.visible = false;
  appConfirmState.resolver = null;
  if (resolver) resolver(result);
};

export const confirmOk = () => {
  resolveConfirm({
    confirm: true,
    cancel: false,
    content: appConfirmState.inputValue
  });
};

export const confirmCancel = () => {
  resolveConfirm({
    confirm: false,
    cancel: true,
    content: appConfirmState.inputValue
  });
};
