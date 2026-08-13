import { type Ref } from 'vue';
import { useOrderDisplay } from '../../composables/useOrderDisplay';
import { getOrderRoleLabel, getOrderStatusMeta } from '../../composables/useOrderScene';

export function useOrderListPanelDisplay(currentTab: Ref<string>) {
  const { formatTimeRangeCompact } = useOrderDisplay();
  const getTabName = () => getOrderRoleLabel(currentTab.value);
  const formatTimeRange = (start: string, end: string) => formatTimeRangeCompact(start, end);
  const getStatusClass = (status: string) => getOrderStatusMeta(status).className;
  const formatStatus = (status: string) => getOrderStatusMeta(status).label;

  return {
    getTabName,
    formatTimeRange,
    getStatusClass,
    formatStatus,
  };
}
