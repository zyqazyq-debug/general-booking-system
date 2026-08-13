import { inject, provide, type InjectionKey, type Ref } from 'vue';

interface LibraryListContext {
  pageSizeOptions: number[];
  pageSize: Ref<number>;
  availabilityMap: Ref<Record<string, string>>;
  onEdit: (item: any) => void;
  onToggle: (item: any) => void;
  onPromote: (item: any) => void;
  onBook: (item: any) => void;
}

const LIBRARY_LIST_CONTEXT_KEY: InjectionKey<LibraryListContext> = Symbol('LIBRARY_LIST_CONTEXT_KEY');

export function provideLibraryListContext(context: LibraryListContext) {
  provide(LIBRARY_LIST_CONTEXT_KEY, context);
}

export function useLibraryListContext() {
  const context = inject(LIBRARY_LIST_CONTEXT_KEY);
  if (!context) {
    throw new Error('useLibraryListContext must be used within LibraryPanel');
  }
  return context;
}
