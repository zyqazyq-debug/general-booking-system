const LIBRARY_INVALIDATE_EVENT = 'library:invalidate';

export function emitLibraryInvalidation() {
  uni.$emit(LIBRARY_INVALIDATE_EVENT);
}

export function onLibraryInvalidation(listener: () => void) {
  uni.$on(LIBRARY_INVALIDATE_EVENT, listener);
}

export function offLibraryInvalidation(listener: () => void) {
  uni.$off(LIBRARY_INVALIDATE_EVENT, listener);
}
